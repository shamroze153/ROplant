/**
 * RO PLANT DAILY READINGS PORTAL — Google Apps Script backend
 * Disrupt.com · Workplace Services (Soft FM)
 *
 * Backend  : Google Sheet "RO Reading"
 * Frontend : Index.html (served by this script as a Web App)
 *
 * FIRST-TIME SETUP
 *   1. Open the "RO Reading" sheet → Extensions → Apps Script
 *   2. Paste Code.gs + Index.html (+ appsscript.json via Project Settings)
 *   3. Select function  setup  → Run → allow permissions
 *   4. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone → Deploy
 *   5. Share the Web app URL with technicians (add to phone home screen)
 */

const CONFIG = {
  SPREADSHEET_ID: '15jlMJrqX_OoA02zqbHEEx5XflU7K9VKPAj22RLTwfYY',
  SHEET_READINGS: 'Readings',
  SHEET_SETTINGS: 'Settings',
  SHEET_DASHBOARD: 'Dashboard',
  PHOTO_FOLDER_NAME: 'RO Plant - Reading Photos',
  BRAND: '#A51C30',
  BRAND_DARK: '#7E1424',
  TZ: 'Asia/Karachi',
  MAX_PHOTOS: 8
};

/** Numeric reading fields (order = sheet order). min/max are default alert limits (edit in Settings tab). */
const NUM_FIELDS = [
  { key: 'flowRate',          label: 'Flow Rate (gpm)',              min: '',  max: ''  },
  { key: 'concentrateFlow',   label: 'Concentrate Flow (gpm)',       min: '',  max: ''  },
  { key: 'inletPressure',     label: 'Inlet Pressure (psi)',         min: 10,  max: 80  },
  { key: 'pumpPressure',      label: 'Pump Pressure (psi)',          min: '',  max: 250 },
  { key: 'membranePressure',  label: 'Membrane Pressure (psi)',      min: '',  max: 250 },
  { key: 'temperature',       label: 'Temperature (°C)',             min: 5,   max: 40  },
  { key: 'tds',               label: 'Online TDS (ppm)',             min: '',  max: 150 },
  { key: 'electricalLoad',    label: 'Electrical Load (A)',          min: '',  max: ''  },
  { key: 'tankFillTime',      label: 'Raw Tank Fill Time 0→Full (min)', min: '', max: '' },
  { key: 'tankEmptyTime',     label: 'Raw Tank Empty Time (min)',    min: '',  max: ''  }
];
const RECOVERY = { key: 'recovery', label: 'Recovery (%)', min: 50, max: 85 };

const HEADERS = [
  'Entry ID', 'Submitted At', 'Reading Date', 'Reading Time', 'Site / Plant', 'Technician',
  'Flow Rate (gpm)', 'Concentrate Flow (gpm)', 'Recovery (%)',
  'Inlet Pressure (psi)', 'Pump Pressure (psi)', 'Membrane Pressure (psi)',
  'Temperature (°C)', 'Online TDS (ppm)', 'Electrical Load (A)',
  'Antiscalant (Y/N)', 'Cartridge Change (Y/N)',
  'Raw Tank Fill Time 0→Full (min)', 'Raw Tank Empty Time (min)',
  'Remarks', 'Status', 'Alerts', 'Entry Mode', 'Photos'
];
const COL = {}; HEADERS.forEach((h, i) => COL[h] = i + 1);
const KEY_TO_HEADER = {
  flowRate: 'Flow Rate (gpm)', concentrateFlow: 'Concentrate Flow (gpm)', recovery: 'Recovery (%)',
  inletPressure: 'Inlet Pressure (psi)', pumpPressure: 'Pump Pressure (psi)',
  membranePressure: 'Membrane Pressure (psi)', temperature: 'Temperature (°C)',
  tds: 'Online TDS (ppm)', electricalLoad: 'Electrical Load (A)',
  tankFillTime: 'Raw Tank Fill Time 0→Full (min)', tankEmptyTime: 'Raw Tank Empty Time (min)'
};

const GENERAL_DEFAULTS = [
  ['plantName',   'Plant name (portal title)',            'RO Plant'],
  ['sites',       'Sites / plants (comma separated)',      '140-H, 141-D'],
  ['technicians', 'Technicians (comma separated)',         'Technician 1, Technician 2'],
  ['alertEmails', 'Alert e-mails (comma separated)',       ''],
  ['emailAlerts', 'Send e-mail on out-of-range reading (Y/N)', 'N'],
  ['pin',         'Portal access PIN (blank = no PIN)',    '']
];

/* ============================== WEB ENTRY POINTS ============================== */

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action) return json_(apiRouter(action, e.parameter));
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('RO Plant · Daily Readings')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used when the portal is hosted outside Apps Script (e.g. Vercel). Body: {"action":"...","payload":{...}} */
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'Invalid JSON' }); }
  return json_(apiRouter(body.action, body.payload || {}));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Single router used by both google.script.run and HTTP. */
function apiRouter(action, payload) {
  try {
    switch (action) {
      case 'config': return { ok: true, data: getConfig_() };
      case 'recent': return { ok: true, data: getRecent_(Number((payload && payload.n) || 5)) };
      case 'submit': return { ok: true, data: submitReading_(payload || {}) };
      default: return { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    console.error(err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/* ============================== CONFIG / SETTINGS ============================== */

function ss_() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

/** Auto-creates the tabs if setup() was never run, so the portal still works. */
function ensureSetup_() {
  const ss = ss_();
  if (!ss.getSheetByName(CONFIG.SHEET_SETTINGS) || !ss.getSheetByName(CONFIG.SHEET_READINGS)) {
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try { if (!ss.getSheetByName(CONFIG.SHEET_SETTINGS) || !ss.getSheetByName(CONFIG.SHEET_READINGS)) setup(); }
    finally { lock.releaseLock(); }
  }
}

function readSettings_() {
  ensureSetup_();
  const sh = ss_().getSheetByName(CONFIG.SHEET_SETTINGS);
  const values = sh.getDataRange().getValues();
  const general = {}, thresholds = {};
  const numKeys = NUM_FIELDS.map(f => f.key).concat([RECOVERY.key]);
  values.forEach(r => {
    const key = String(r[0] || '').trim();
    if (!key) return;
    if (numKeys.indexOf(key) >= 0) {
      thresholds[key] = { min: r[2] === '' ? null : Number(r[2]), max: r[3] === '' ? null : Number(r[3]) };
    } else if (GENERAL_DEFAULTS.some(g => g[0] === key)) {
      general[key] = String(r[2] == null ? '' : r[2]).trim();
    }
  });
  return { general, thresholds };
}

function splitList_(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }

function getConfig_() {
  const { general, thresholds } = readSettings_();
  return {
    plantName: general.plantName || 'RO Plant',
    sites: splitList_(general.sites),
    technicians: splitList_(general.technicians),
    pinRequired: !!general.pin,
    thresholds: thresholds,
    recent: getRecent_(5),
    serverTime: Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd'T'HH:mm")
  };
}

function getRecent_(n) {
  ensureSetup_();
  const sh = ss_().getSheetByName(CONFIG.SHEET_READINGS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const count = Math.min(n, last - 1);
  const rows = sh.getRange(last - count + 1, 1, count, HEADERS.length).getValues().reverse();
  return rows.map(r => ({
    id: r[COL['Entry ID'] - 1],
    date: fmtDate_(r[COL['Reading Date'] - 1]),
    time: fmtTime_(r[COL['Reading Time'] - 1]),
    site: r[COL['Site / Plant'] - 1],
    technician: r[COL['Technician'] - 1],
    tds: r[COL['Online TDS (ppm)'] - 1],
    recovery: r[COL['Recovery (%)'] - 1],
    status: r[COL['Status'] - 1],
    alerts: r[COL['Alerts'] - 1]
  }));
}

function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'dd-MMM-yyyy') : String(v || ''); }
function fmtTime_(v) { return v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'HH:mm') : String(v || ''); }

/* ============================== SUBMIT ============================== */

function submitReading_(p) {
  const { general, thresholds } = readSettings_();

  if (general.pin && String(p.pin || '').trim() !== general.pin) throw new Error('Incorrect PIN.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) throw new Error('Reading date is required.');
  if (!p.technician) throw new Error('Technician name is required.');

  const num = {};
  NUM_FIELDS.forEach(f => {
    const v = p[f.key];
    if (v === '' || v == null) { num[f.key] = ''; return; }
    const n = Number(v);
    if (!isFinite(n) || n < 0) throw new Error(f.label + ' must be a positive number.');
    num[f.key] = n;
  });

  // Derived: recovery % = permeate / (permeate + concentrate)
  if (num.flowRate !== '' && num.concentrateFlow !== '' && (num.flowRate + num.concentrateFlow) > 0) {
    num.recovery = Math.round(num.flowRate / (num.flowRate + num.concentrateFlow) * 1000) / 10;
  } else num.recovery = '';

  // Alerts
  const alerts = [];
  const labelOf = k => (k === 'recovery' ? RECOVERY.label : NUM_FIELDS.filter(f => f.key === k)[0].label);
  Object.keys(thresholds).forEach(k => {
    const v = num[k], t = thresholds[k];
    if (v === '' || v == null) return;
    if (t.min != null && !isNaN(t.min) && v < t.min) alerts.push(labelOf(k) + ' ' + v + ' below min ' + t.min);
    if (t.max != null && !isNaN(t.max) && v > t.max) alerts.push(labelOf(k) + ' ' + v + ' above max ' + t.max);
  });
  const antiscalant = String(p.antiscalant || '').toUpperCase() === 'Y' ? 'Y' : 'N';
  const cartridge = String(p.cartridge || '').toUpperCase() === 'Y' ? 'Y' : 'N';
  if (antiscalant === 'N') alerts.push('Antiscalant not dosed');
  const status = alerts.length ? 'ALERT' : 'OK';

  const now = new Date();
  const id = 'RO-' + Utilities.formatDate(now, CONFIG.TZ, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100);

  // Photos → Drive
  const photoLinks = savePhotos_(p.photos || [], id, p.date);

  const readingDate = Utilities.parseDate(p.date, CONFIG.TZ, 'yyyy-MM-dd');
  const row = new Array(HEADERS.length).fill('');
  const set = (h, v) => row[COL[h] - 1] = v;
  set('Entry ID', id);
  set('Submitted At', now);
  set('Reading Date', readingDate);
  set('Reading Time', String(p.time || Utilities.formatDate(now, CONFIG.TZ, 'HH:mm')));
  set('Site / Plant', String(p.site || '').slice(0, 60));
  set('Technician', String(p.technician).slice(0, 60));
  Object.keys(KEY_TO_HEADER).forEach(k => set(KEY_TO_HEADER[k], num[k]));
  set('Antiscalant (Y/N)', antiscalant);
  set('Cartridge Change (Y/N)', cartridge);
  set('Remarks', String(p.remarks || '').slice(0, 1000));
  set('Status', status);
  set('Alerts', alerts.join('; '));
  set('Entry Mode', String(p.entryMode || 'Manual'));
  set('Photos', photoLinks.join('\n'));

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEET_READINGS);
    sh.appendRow(row);
    const r = sh.getLastRow();
    sh.getRange(r, COL['Submitted At']).setNumberFormat('dd-mmm-yyyy hh:mm');
    sh.getRange(r, COL['Reading Date']).setNumberFormat('dd-mmm-yyyy');
    sh.getRange(r, COL['Reading Time']).setNumberFormat('@');
  } finally {
    lock.releaseLock();
  }

  if (status === 'ALERT' && general.emailAlerts && general.emailAlerts.toUpperCase() === 'Y' && general.alertEmails) {
    try { sendAlertEmail_(general, id, p, num, alerts); } catch (err) { console.error('Email failed', err); }
  }

  return { id, status, alerts, recovery: num.recovery, photos: photoLinks.length };
}

function savePhotos_(photos, id, dateStr) {
  if (!photos.length) return [];
  const root = getPhotoFolder_();
  const month = String(dateStr || '').slice(0, 7) || Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM');
  const it = root.getFoldersByName(month);
  const folder = it.hasNext() ? it.next() : root.createFolder(month);
  return photos.slice(0, CONFIG.MAX_PHOTOS).map((ph, i) => {
    const m = String(ph.dataUrl || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!m) return null;
    const safe = String(ph.label || 'photo').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '_' + (i + 1) + '_' + safe + '.jpg');
    return folder.createFile(blob).getUrl();
  }).filter(Boolean);
}

function getPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const fid = props.getProperty('PHOTO_FOLDER_ID');
  if (fid) { try { return DriveApp.getFolderById(fid); } catch (e) { /* recreated below */ } }
  const f = DriveApp.createFolder(CONFIG.PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', f.getId());
  return f;
}

function sendAlertEmail_(general, id, p, num, alerts) {
  const rows = Object.keys(KEY_TO_HEADER).map(k =>
    '<tr><td style="padding:4px 10px;border:1px solid #ddd">' + KEY_TO_HEADER[k] + '</td>' +
    '<td style="padding:4px 10px;border:1px solid #ddd"><b>' + (num[k] === '' ? '—' : num[k]) + '</b></td></tr>').join('');
  const html =
    '<div style="font-family:Arial,sans-serif">' +
    '<h2 style="color:' + CONFIG.BRAND + ';margin:0 0 6px">⚠ RO Plant reading alert</h2>' +
    '<p>' + (general.plantName || 'RO Plant') + ' · ' + (p.site || '') + ' · ' + p.date + ' ' + (p.time || '') +
    ' · by <b>' + p.technician + '</b> · ' + id + '</p>' +
    '<ul style="color:#b00020">' + alerts.map(a => '<li>' + a + '</li>').join('') + '</ul>' +
    '<table style="border-collapse:collapse;font-size:13px">' + rows + '</table>' +
    (p.remarks ? '<p><b>Remarks:</b> ' + p.remarks + '</p>' : '') +
    '<p><a href="https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '">Open RO Reading sheet</a></p></div>';
  MailApp.sendEmail({
    to: general.alertEmails,
    subject: '[RO ALERT] ' + (p.site || '') + ' ' + p.date + ' — ' + alerts.length + ' issue(s)',
    htmlBody: html
  });
}

/* ============================== ONE-TIME SETUP ============================== */

/** Run once from the Apps Script editor. Safe to re-run: keeps existing data & settings. */
function setup() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone(CONFIG.TZ);
  setupReadings_(ss);
  setupSettings_(ss);
  setupDashboard_(ss);
  getPhotoFolder_();
  // Remove the default empty "Sheet1" if it is unused
  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  ss.setActiveSheet(ss.getSheetByName(CONFIG.SHEET_DASHBOARD));
  SpreadsheetApp.flush();
  Logger.log('Setup complete. Now: Deploy → New deployment → Web app.');
}

function setupReadings_(ss) {
  let sh = ss.getSheetByName(CONFIG.SHEET_READINGS);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_READINGS, 0);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setBackground(CONFIG.BRAND).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 46);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(4);
  const widths = { 'Entry ID': 150, 'Submitted At': 130, 'Reading Date': 105, 'Reading Time': 70, 'Site / Plant': 90,
    'Technician': 130, 'Remarks': 240, 'Status': 70, 'Alerts': 260, 'Entry Mode': 90, 'Photos': 220 };
  HEADERS.forEach((h, i) => sh.setColumnWidth(i + 1, widths[h] || 95));
  const maxR = sh.getMaxRows();
  sh.getRange(2, COL['Submitted At'], maxR - 1, 1).setNumberFormat('dd-mmm-yyyy hh:mm');
  sh.getRange(2, COL['Reading Date'], maxR - 1, 1).setNumberFormat('dd-mmm-yyyy');
  sh.getRange(2, COL['Reading Time'], maxR - 1, 1).setNumberFormat('@');
  sh.getRange(2, COL['Flow Rate (gpm)'], maxR - 1, COL['Electrical Load (A)'] - COL['Flow Rate (gpm)'] + 1).setHorizontalAlignment('center');
  sh.getRange(2, COL['Antiscalant (Y/N)'], maxR - 1, 4).setHorizontalAlignment('center');

  // Conditional formatting: status + Y/N
  const statusRange = sh.getRange(2, COL['Status'], maxR - 1, 1);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ALERT').setBackground('#FDE2E4').setFontColor('#B00020').setBold(true).setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK').setBackground('#E3F4E8').setFontColor('#1B7F3B').setBold(true).setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('N').setFontColor('#B00020').setRanges([sh.getRange(2, COL['Antiscalant (Y/N)'], maxR - 1, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Y').setBackground('#FFF4D6').setRanges([sh.getRange(2, COL['Cartridge Change (Y/N)'], maxR - 1, 1)]).build()
  ];
  sh.setConditionalFormatRules(rules);
  if (!sh.getBandings().length && sh.getLastRow() < 2) {
    // light banding for readability (header excluded)
    sh.getRange(1, 1, maxR, HEADERS.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
      .setHeaderRowColor(CONFIG.BRAND);
  }
}

function setupSettings_(ss) {
  let sh = ss.getSheetByName(CONFIG.SHEET_SETTINGS);
  const existing = {};
  if (sh) sh.getDataRange().getValues().forEach(r => { if (r[0]) existing[r[0]] = r; });
  else sh = ss.insertSheet(CONFIG.SHEET_SETTINGS);
  sh.clear();

  const out = [];
  out.push(['KEY', 'GENERAL SETTINGS', 'VALUE', '', 'NOTES']);
  GENERAL_DEFAULTS.forEach(g => {
    const prev = existing[g[0]];
    out.push([g[0], g[1], prev ? prev[2] : g[2], '', '']);
  });
  out.push(['', '', '', '', '']);
  out.push(['KEY', 'ALERT LIMITS (per reading)', 'MIN', 'MAX', 'NOTES']);
  NUM_FIELDS.concat([RECOVERY]).forEach(f => {
    const prev = existing[f.key];
    out.push([f.key, f.label, prev ? prev[2] : f.min, prev ? prev[3] : f.max,
      f.key === 'recovery' ? 'Auto-calculated = Flow ÷ (Flow + Concentrate)' : 'Leave blank = no limit']);
  });
  sh.getRange(1, 1, out.length, 5).setValues(out);

  const hdrRows = [1, GENERAL_DEFAULTS.length + 3];
  hdrRows.forEach(r => sh.getRange(r, 1, 1, 5).setBackground(CONFIG.BRAND).setFontColor('#fff').setFontWeight('bold'));
  sh.getRange(1, 1, out.length, 1).setFontColor('#999999').setFontSize(9);
  sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 300); sh.setColumnWidth(3, 260); sh.setColumnWidth(4, 90); sh.setColumnWidth(5, 300);
  sh.getRange(2, 3, GENERAL_DEFAULTS.length, 1).setBackground('#FFF9E6');
  sh.getRange(hdrRows[1] + 1, 3, NUM_FIELDS.length + 1, 2).setBackground('#FFF9E6').setHorizontalAlignment('center');
  sh.getRange(2, 5).setValue('Shown as the portal header title');
  sh.getRange(3, 5).setValue('Dropdown on the portal');
  sh.getRange(4, 5).setValue('Dropdown on the portal (technician can also type a new name)');
  sh.getRange(7, 5).setValue('Optional. Technicians must enter this PIN to submit');
  sh.getRange(out.length + 2, 2).setValue('⚠ Set the alert limits as per your RO plant OEM / design datasheet. Defaults are generic.').setFontColor('#B00020').setFontStyle('italic');
  sh.setFrozenRows(0);
}

function setupDashboard_(ss) {
  let sh = ss.getSheetByName(CONFIG.SHEET_DASHBOARD);
  if (sh) { sh.getCharts().forEach(c => sh.removeChart(c)); sh.clear(); }
  else sh = ss.insertSheet(CONFIG.SHEET_DASHBOARD, 0);

  const R = CONFIG.SHEET_READINGS;
  const L = h => colLetter_(COL[h]);
  const rng = h => R + '!' + L(h) + '2:' + L(h);
  const D = rng('Reading Date');

  sh.getRange('A1:H1').merge().setValue('RO PLANT — PERFORMANCE DASHBOARD')
    .setBackground(CONFIG.BRAND).setFontColor('#fff').setFontSize(16).setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(1, 42);
  sh.getRange('A2:H2').merge().setFormula('="Last reading: "&IFERROR(TEXT(MAX(' + D + '),"dd-mmm-yyyy"),"—")&"   ·   Updated live from Readings tab"')
    .setFontColor('#666').setFontStyle('italic');

  const kpis = [
    ['Total readings', '=COUNTA(' + rng('Entry ID') + ')', '0'],
    ['Readings (last 7 days)', '=COUNTIFS(' + D + ',">="&TODAY()-6)', '0'],
    ['Alerts (last 30 days)', '=COUNTIFS(' + rng('Status') + ',"ALERT",' + D + ',">="&TODAY()-29)', '0'],
    ['Avg TDS 7d (ppm)', '=IFERROR(AVERAGEIFS(' + rng('Online TDS (ppm)') + ',' + D + ',">="&TODAY()-6),"—")', '0.0'],
    ['Avg Recovery 7d (%)', '=IFERROR(AVERAGEIFS(' + rng('Recovery (%)') + ',' + D + ',">="&TODAY()-6),"—")', '0.0'],
    ['Avg Tank Fill 7d (min)', '=IFERROR(AVERAGEIFS(' + rng('Raw Tank Fill Time 0→Full (min)') + ',' + D + ',">="&TODAY()-6),"—")', '0.0'],
    ['Avg Tank Empty 7d (min)', '=IFERROR(AVERAGEIFS(' + rng('Raw Tank Empty Time (min)') + ',' + D + ',">="&TODAY()-6),"—")', '0.0'],
    ['Last cartridge change', '=IFERROR(IF(MAXIFS(' + D + ',' + rng('Cartridge Change (Y/N)') + ',"Y")=0,"—",TEXT(MAXIFS(' + D + ',' + rng('Cartridge Change (Y/N)') + ',"Y"),"dd-mmm-yyyy")),"—")', '@']
  ];
  kpis.forEach((k, i) => {
    const c = i + 1;
    sh.getRange(4, c).setValue(k[0]).setFontSize(9).setFontColor('#666').setWrap(true).setHorizontalAlignment('center');
    sh.getRange(5, c).setFormula(k[1]).setFontSize(18).setFontWeight('bold').setFontColor(CONFIG.BRAND_DARK)
      .setHorizontalAlignment('center').setNumberFormat(k[2]);
  });
  sh.getRange(4, 1, 2, 8).setBackground('#FAF5F6').setBorder(true, true, true, true, true, false, '#E8D3D7', SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(5, 44);
  for (let c = 1; c <= 8; c++) sh.setColumnWidth(c, 135);

  // Recent readings table (last 10)
  sh.getRange('A7').setValue('LAST 10 READINGS').setFontWeight('bold').setFontColor(CONFIG.BRAND);
  const cols = ['Reading Date', 'Reading Time', 'Technician', 'Online TDS (ppm)', 'Recovery (%)', 'Membrane Pressure (psi)', 'Status', 'Alerts'];
  const sel = cols.map(h => 'Col' + COL[h]).join(',');
  sh.getRange('A8').setFormula('=IFERROR(QUERY({' + R + '!A2:' + colLetter_(HEADERS.length) + '},"select ' + sel +
    ' where Col1 is not null order by Col2 desc limit 10 label ' + cols.map(h => 'Col' + COL[h] + " '" + h + "'").join(', ') + '",0),"No readings yet")');
  sh.getRange('A8:H8').setBackground('#F1E4E7').setFontWeight('bold');
  sh.getRange('A9:A18').setNumberFormat('dd-mmm-yyyy');

  // Charts (read full columns so they grow with data)
  const rs = ss.getSheetByName(R);
  const colR = h => rs.getRange(1, COL[h], 1000, 1);
  const chart = (title, headers, row, colPos) => {
    let b = sh.newChart().setChartType(Charts.ChartType.LINE).addRange(colR('Reading Date'));
    headers.forEach(h => b = b.addRange(colR(h)));
    b = b.setNumHeaders(1).setPosition(row, colPos, 0, 0)
      .setOption('title', title).setOption('legend', { position: 'bottom' })
      .setOption('width', 540).setOption('height', 290).setOption('pointSize', 4)
      .setOption('hAxis', { format: 'dd-MMM' })
      .setOption('colors', ['#A51C30', '#1F6FB2', '#2E8B57', '#E08E0B']);
    sh.insertChart(b.build());
  };
  chart('Online TDS (ppm)', ['Online TDS (ppm)'], 21, 1);
  chart('Pressures (psi)', ['Inlet Pressure (psi)', 'Pump Pressure (psi)', 'Membrane Pressure (psi)'], 21, 5);
  chart('Flows (gpm) & Recovery', ['Flow Rate (gpm)', 'Concentrate Flow (gpm)', 'Recovery (%)'], 37, 1);
  chart('Raw water tank — fill / empty time (min)', ['Raw Tank Fill Time 0→Full (min)', 'Raw Tank Empty Time (min)'], 37, 5);
}

function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** TEST: run from the editor. Writes one sample reading to the Readings tab and logs the result. */
function testWrite() {
  const today = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
  const r = apiRouter('submit', {
    date: today, time: '09:00', site: 'TEST', technician: 'TEST ENTRY - delete me',
    flowRate: 10, concentrateFlow: 5, inletPressure: 30, pumpPressure: 150, membranePressure: 140,
    temperature: 28, tds: 40, electricalLoad: 12, tankFillTime: 45, tankEmptyTime: 120,
    antiscalant: 'Y', cartridge: 'N', remarks: 'testWrite() from Apps Script editor', entryMode: 'Test'
  });
  Logger.log(JSON.stringify(r));
  if (!r.ok) throw new Error(r.error);
}

/** Adds a menu in the sheet for quick access. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('RO Portal')
    .addItem('Run / repair setup', 'setup')
    .addItem('Open portal link', 'showPortalLink_')
    .addToUi();
}

function showPortalLink_() {
  const url = ScriptApp.getService().getUrl();
  const html = HtmlService.createHtmlOutput(url
    ? '<p style="font-family:Arial">Portal URL:</p><p><a target="_blank" href="' + url + '">' + url + '</a></p>'
    : '<p style="font-family:Arial">Not deployed yet. In Apps Script: Deploy → New deployment → Web app.</p>').setWidth(460).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, 'RO Plant Portal');
}
