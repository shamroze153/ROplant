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
  { key: 'tankEmptyTime',     label: 'Raw Tank Empty Time (min)',    min: '',  max: ''  },
  { key: 'voltage',           label: 'Voltage (V)',                  min: '',  max: ''  }
];
const RECOVERY = { key: 'recovery', label: 'Recovery (%)', min: 50, max: 85 };

const HEADERS = [
  'Entry ID', 'Submitted At', 'Reading Date', 'Reading Time', 'Site / Plant', 'Technician',
  'Flow Rate (gpm)', 'Concentrate Flow (gpm)', 'Recovery (%)',
  'Inlet Pressure (psi)', 'Pump Pressure (psi)', 'Membrane Pressure (psi)',
  'Temperature (°C)', 'Online TDS (ppm)', 'Electrical Load (A)',
  'Antiscalant (Y/N)', 'Cartridge Change (Y/N)',
  'Raw Tank Fill Time 0→Full (min)', 'Raw Tank Empty Time (min)',
  'Remarks', 'Status', 'Alerts', 'Entry Mode', 'Photos',
  'Voltage (V)'
];
const COL = {}; HEADERS.forEach((h, i) => COL[h] = i + 1);
const KEY_TO_HEADER = {
  flowRate: 'Flow Rate (gpm)', concentrateFlow: 'Concentrate Flow (gpm)', recovery: 'Recovery (%)',
  inletPressure: 'Inlet Pressure (psi)', pumpPressure: 'Pump Pressure (psi)',
  membranePressure: 'Membrane Pressure (psi)', temperature: 'Temperature (°C)',
  tds: 'Online TDS (ppm)', electricalLoad: 'Electrical Load (A)',
  tankFillTime: 'Raw Tank Fill Time 0→Full (min)', tankEmptyTime: 'Raw Tank Empty Time (min)',
  voltage: 'Voltage (V)'
};

const MANAGER_EMAILS = 'shamroze.nasir@disrupt.com, kamran.haider@disrupt.com';
const PORTAL_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbzFyilnViSbd_Ga4mVeXgfyIV1EcngThFXlRftMgISZEGZv6As2BRRcXjwL4L3ubH03/exec';

/** [key, label, default, note] */
const GENERAL_DEFAULTS = [
  ['plantName',     'Plant name (portal title)',                 'RO Plant',   'Shown as the portal header title'],
  ['sites',         'Sites / plants (comma separated)',          '140-H, 141-D', 'Dropdown on the portal. Daily reminder checks every site listed here'],
  ['technicians',   'Technicians (comma separated)',             'Technician 1, Technician 2', 'Dropdown on the portal (technician can also type a new name)'],
  ['alertEmails',   'Alert e-mails (comma separated)',           MANAGER_EMAILS, 'Receives out-of-range reading alerts'],
  ['emailAlerts',   'Send e-mail on out-of-range reading (Y/N)', 'N',          ''],
  ['pin',           'Portal access PIN (blank = no PIN)',        '',           'Optional. Technicians must enter this PIN to submit'],
  ['reportEmails',  'Manager report & reminder e-mails (comma separated)', MANAGER_EMAILS, 'Performance reports + daily reminders go here'],
  ['weeklyReport',  'Weekly performance report every Monday 9 AM (Y/N)', 'Y', 'Last 7 days + lifetime performance'],
  ['dailyReminder', 'Daily missed-reading reminder (Y/N)',       'Y',          'E-mail if a site has no reading by the check time'],
  ['reminderHour',  'Daily reminder check time (hour 0–23)',     '11',         'Pakistan time. Re-run installEmailTriggers after changing'],
  ['cartridgeDays', 'Cartridge change due after (days)',         '30',         'Reminder e-mail when the last cartridge change is older than this'],
  ['monthlyReport', 'Monthly performance report on the 1st (Y/N)', 'Y',        'Last month + lifetime performance, 1st at 9 AM'],
  ['adminPassword', 'Admin panel password (portal → Admin)',     'CHANGE_ME',  'Unlocks QR generator + send-report buttons in the portal'],
  ['portalUrl',     'Portal link (used in e-mails & QR)',        PORTAL_URL_DEFAULT, 'Change if you move the portal (e.g. to Vercel)']
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
      case 'admin':  return { ok: true, data: adminApi_(payload || {}) };
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
    ensureHeaders_(sh);
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

/** Adds any new columns (e.g. Voltage) to the header row without touching existing data. */
function ensureHeaders_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol >= HEADERS.length) return;
  sh.getRange(1, lastCol + 1, 1, HEADERS.length - lastCol).setValues([HEADERS.slice(lastCol)])
    .setBackground(CONFIG.BRAND).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
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
    out.push([g[0], g[1], (prev && String(prev[2]).trim() !== '') ? prev[2] : g[2], '', g[3] || '']);
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
    .addSeparator()
    .addItem('Turn on daily reminder + monthly report', 'installEmailTriggers')
    .addItem('Send test: daily reminder', 'testDailyReminder')
    .addItem('Send performance report now (last 30 days)', 'sendReportNow')
    .addToUi();
}

function showPortalLink_() {
  const url = ScriptApp.getService().getUrl();
  const html = HtmlService.createHtmlOutput(url
    ? '<p style="font-family:Arial">Portal URL:</p><p><a target="_blank" href="' + url + '">' + url + '</a></p>'
    : '<p style="font-family:Arial">Not deployed yet. In Apps Script: Deploy → New deployment → Web app.</p>').setWidth(460).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, 'RO Plant Portal');
}

/* ============================== E-MAIL AUTOMATION ============================== */

/** Run ONCE (or after changing reminderHour). Creates the daily + monthly e-mail schedule. */
function installEmailTriggers() {
  const { general } = readSettings_();
  const handlers = ['dailyCheck', 'monthlyReport', 'weeklyReport'];
  ScriptApp.getProjectTriggers().forEach(t => { if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  const hour = Math.min(23, Math.max(0, parseInt(general.reminderHour, 10) || 11));
  ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(hour).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('monthlyReport').timeBased().onMonthDay(1).atHour(9).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone(CONFIG.TZ).create();
  const msg = 'E-mail schedule ON → daily check ' + hour + ':00, weekly report Monday 9:00, monthly report 1st 9:00 (Asia/Karachi). Recipients: ' + recipients_(general);
  Logger.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, 'RO Portal', 8); } catch (e) {}
}

function recipients_(general) {
  return general.reportEmails || general.alertEmails || Session.getEffectiveUser().getEmail();
}
function portalUrl_(general) { return general.portalUrl || PORTAL_URL_DEFAULT; }

/** All reading rows as objects. */
function readingRows_() {
  const sh = ss_().getSheetByName(CONFIG.SHEET_READINGS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.length).getValues()
    .filter(r => r[0] && r[COL['Reading Date'] - 1] instanceof Date)
    .map(r => { const o = {}; HEADERS.forEach((h, i) => o[h] = r[i]); return o; });
}
const dkey_ = d => Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd');
const nice_ = d => Utilities.formatDate(d, CONFIG.TZ, 'dd-MMM-yyyy');

function mailBox_(title, bodyHtml, general) {
  return '<div style="font-family:Arial,sans-serif;max-width:640px">' +
    '<div style="background:' + CONFIG.BRAND + ';color:#fff;padding:14px 18px;border-radius:10px 10px 0 0">' +
    '<div style="font-size:12px;opacity:.85">' + (general.plantName || 'RO Plant') + ' · Workplace Services</div>' +
    '<div style="font-size:19px;font-weight:bold">' + title + '</div></div>' +
    '<div style="border:1px solid #eee;border-top:0;padding:16px 18px;border-radius:0 0 10px 10px;font-size:14px;color:#222">' + bodyHtml +
    '<p style="margin-top:18px"><a href="' + portalUrl_(general) + '" style="background:' + CONFIG.BRAND + ';color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;font-weight:bold">Open RO portal</a>' +
    ' &nbsp; <a href="https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '">Open sheet</a></p></div></div>';
}

/** Daily: e-mail if any site has no reading today, or a cartridge change is overdue. */
function dailyCheck(e, forceSend) {
  const force = forceSend === true;
  const { general } = readSettings_();
  if (!force && String(general.dailyReminder || 'Y').toUpperCase() !== 'Y') return;
  const sites = splitList_(general.sites);
  const rows = readingRows_();
  const today = dkey_(new Date());
  const dueDays = parseInt(general.cartridgeDays, 10) || 0;

  const missing = sites.filter(s => !rows.some(r => String(r['Site / Plant']) === s && dkey_(r['Reading Date']) === today));
  const overdue = [];
  if (dueDays > 0) sites.forEach(s => {
    const siteRows = rows.filter(r => String(r['Site / Plant']) === s);
    if (!siteRows.length) return;
    const changes = siteRows.filter(r => r['Cartridge Change (Y/N)'] === 'Y').map(r => r['Reading Date'].getTime());
    const since = changes.length ? Math.max.apply(null, changes) : null;
    if (since == null) { overdue.push({ site: s, text: 'no cartridge change recorded yet' }); return; }
    const days = Math.floor((Date.now() - since) / 86400000);
    if (days > dueDays) overdue.push({ site: s, text: 'last changed ' + nice_(new Date(since)) + ' (' + days + ' days ago, limit ' + dueDays + ')' });
  });

  if (!missing.length && !overdue.length && !force) return;
  let html = '';
  if (missing.length) html += '<p style="color:#B00020;font-weight:bold">⏰ No reading logged today (' + nice_(new Date()) + ') for:</p><ul>' +
    missing.map(s => '<li><b>' + s + '</b></li>').join('') + '</ul><p>Please ask the technician to submit the daily RO reading.</p>';
  if (overdue.length) html += '<p style="color:#B45309;font-weight:bold">🔧 Cartridge change due:</p><ul>' +
    overdue.map(o => '<li><b>' + o.site + '</b> — ' + o.text + '</li>').join('') + '</ul>';
  if (!html) html = '<p>✅ All sites have today\'s reading and no cartridge change is due.</p>';
  const subj = missing.length ? '[RO REMINDER] Reading missing today — ' + missing.join(', ')
    : overdue.length ? '[RO REMINDER] Cartridge change due — ' + overdue.map(o => o.site).join(', ')
    : '[RO] Daily check — all good';
  MailApp.sendEmail({ to: recipients_(general), subject: subj, htmlBody: mailBox_('Daily RO reading check', html, general) });
}
function testDailyReminder() { dailyCheck(null, true); }


/* ============================== ADMIN (portal → Admin, password protected) ============================== */

function adminApi_(p) {
  const { general } = readSettings_();
  const pw = String(general.adminPassword || '');
  if (String(p.pw || '') !== pw) throw new Error('Wrong admin password.');
  switch (p.op) {
    case 'login': {
      const rows = readingRows_().filter(r => String(r['Site / Plant']) !== 'TEST');
      const last = rows.length ? rows[rows.length - 1] : null;
      const d30 = Date.now() - 30 * 86400000;
      return {
        portalUrl: portalUrl_(general), plantName: general.plantName || 'RO Plant', sites: splitList_(general.sites),
        recipients: recipients_(general),
        stats: {
          total: rows.length,
          last: last ? nice_(last['Reading Date']) + ' ' + fmtTime_(last['Reading Time']) + ' · ' + last['Technician'] : '—',
          alerts30: rows.filter(r => r['Status'] === 'ALERT' && r['Reading Date'].getTime() >= d30).length,
          sheetUrl: 'https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID
        }
      };
    }
    case 'sendReport': { const r = sendReportNow(); return { message: 'Performance report sent to ' + r }; }
    case 'testReminder': { dailyCheck(null, true); return { message: 'Daily check e-mail sent to ' + recipients_(general) }; }
    default: throw new Error('Unknown admin action');
  }
}

/* ============================== PERFORMANCE REPORT (manager e-mail) ============================== */

function weeklyReport() {
  const { general } = readSettings_();
  if (String(general.weeklyReport || 'Y').toUpperCase() !== 'Y') return;
  const end = new Date(); const start = new Date(end.getTime() - 7 * 86400000);
  sendPerformanceReport_(start, end, 'Weekly', general);
}
function monthlyReport() {
  const { general } = readSettings_();
  if (String(general.monthlyReport || 'Y').toUpperCase() !== 'Y') return;
  const now = new Date();
  const y = Number(Utilities.formatDate(now, CONFIG.TZ, 'yyyy')), m = Number(Utilities.formatDate(now, CONFIG.TZ, 'M'));
  sendPerformanceReport_(new Date(y, m - 2, 1), new Date(y, m - 1, 0, 23, 59, 59), 'Monthly', general);
}
/** Manual / admin button: last 30 days + lifetime. Returns recipients. */
function sendReportNow() {
  const { general } = readSettings_();
  const end = new Date(); const start = new Date(end.getTime() - 30 * 86400000);
  sendPerformanceReport_(start, end, 'On-demand', general);
  return recipients_(general);
}
function testMonthlyReport() { sendReportNow(); }

/** Metric catalogue. worse: 'up' | 'down' | '' (neutral). */
const REPORT_METRICS = [
  { k: 'tds',   h: 'Online TDS (ppm)',              name: 'Online TDS',           unit: 'ppm', dec: 0, worse: 'up' },
  { k: 'recovery', h: 'Recovery (%)',               name: 'Recovery',             unit: '%',   dec: 1, worse: 'down' },
  { k: 'dp',    h: '__dp',                          name: 'Membrane ΔP (Pump − Membrane)', unit: 'psi', dec: 0, worse: 'up' },
  { k: 'flowRate', h: 'Flow Rate (gpm)',            name: 'Permeate flow',        unit: 'gpm', dec: 1, worse: 'down' },
  { k: 'concentrateFlow', h: 'Concentrate Flow (gpm)', name: 'Concentrate flow',  unit: 'gpm', dec: 1, worse: '' },
  { k: 'temperature', h: 'Temperature (°C)',        name: 'Water temperature',    unit: '°C',  dec: 1, worse: '' },
  { k: 'pumpPressure', h: 'Pump Pressure (psi)',    name: 'Pump pressure',        unit: 'psi', dec: 0, worse: '' },
  { k: 'membranePressure', h: 'Membrane Pressure (psi)', name: 'Membrane pressure', unit: 'psi', dec: 0, worse: '' },
  { k: 'electricalLoad', h: 'Electrical Load (A)',  name: 'Motor current',        unit: 'A',   dec: 1, worse: 'up' },
  { k: 'voltage', h: 'Voltage (V)',                 name: 'Supply voltage',       unit: 'V',   dec: 0, worse: '' },
  { k: 'inletPressure', h: 'Inlet Pressure (psi)',  name: 'Inlet (feed) pressure', unit: 'psi', dec: 0, worse: 'down' },
  { k: 'tankFillTime', h: 'Raw Tank Fill Time 0→Full (min)', name: 'Raw tank fill time (0→full)', unit: 'min', dec: 0, worse: 'up' },
  { k: 'tankEmptyTime', h: 'Raw Tank Empty Time (min)', name: 'Raw tank empty time', unit: 'min', dec: 0, worse: '' }
];
const REPORT_PARTS = [
  { title: 'Membrane & Water Quality', icon: '💧', metrics: ['tds', 'recovery', 'dp', 'flowRate', 'concentrateFlow', 'temperature'] },
  { title: 'High-Pressure Pump & Electrical', icon: '⚙️', metrics: ['pumpPressure', 'membranePressure', 'electricalLoad', 'voltage'] },
  { title: 'Pre-treatment & Cartridge Filter', icon: '🧰', metrics: ['inletPressure'], extra: 'cartridge' },
  { title: 'Chemical Dosing (Antiscalant)', icon: '🧪', metrics: [], extra: 'antiscalant' },
  { title: 'Raw Water Tank', icon: '🛢️', metrics: ['tankFillTime', 'tankEmptyTime'] },
  { title: 'Reading Discipline', icon: '📋', metrics: [], extra: 'coverage' }
];

function metricVal_(r, m) {
  if (m.h === '__dp') { const a = r['Pump Pressure (psi)'], b = r['Membrane Pressure (psi)']; return (a === '' || b === '' || a == null || b == null) ? null : Number(a) - Number(b); }
  const v = r[m.h]; return (v === '' || v == null || isNaN(v)) ? null : Number(v);
}
function mstats_(rows, m) {
  const v = rows.map(r => metricVal_(r, m)).filter(x => x != null);
  if (!v.length) return null;
  return { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v), last: v[v.length - 1] };
}

function sendPerformanceReport_(start, end, kind, general) {
  const { thresholds } = readSettings_();
  const all = readingRows_().filter(r => String(r['Site / Plant']) !== 'TEST')
    .sort((a, b) => a['Reading Date'] - b['Reading Date'] || String(a['Reading Time']).localeCompare(String(b['Reading Time'])));
  const label = kind + ' · ' + nice_(start) + ' → ' + nice_(end);
  const sites = splitList_(general.sites).filter(s => all.some(r => String(r['Site / Plant']) === s));
  all.forEach(r => { const s = String(r['Site / Plant']); if (s && sites.indexOf(s) < 0) sites.push(s); });

  const C = { ok: '#15803D', okBg: '#E7F6EC', warn: '#B45309', warnBg: '#FEF3C7', bad: '#B91C1C', badBg: '#FEE2E2', na: '#6B7280', naBg: '#F3F4F6' };
  const pill = st => { const t = { ok: 'HEALTHY', warn: 'WATCH', bad: 'ACTION', na: 'NO DATA' }[st];
    return '<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:bold;letter-spacing:.04em;color:' + C[st] + ';background:' + C[st + 'Bg'] + '">' + t + '</span>'; };
  const fmt = (v, d) => v == null ? '—' : Number(v).toFixed(d);
  const rank = { na: 0, ok: 1, warn: 2, bad: 3 };
  const worst = arr => arr.reduce((a, b) => rank[b] > rank[a] ? b : a, 'na');
  const TD = 'padding:7px 8px;border-bottom:1px solid #EEF0F3;font-size:12.5px;';
  const TH = 'padding:7px 8px;font-size:10.5px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;text-align:left;border-bottom:2px solid #E5E7EB;';

  let body = '', overall = [];
  const now = Date.now();
  sites.forEach(site => {
    const S = all.filter(r => String(r['Site / Plant']) === site);
    const P = S.filter(r => r['Reading Date'] >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) && r['Reading Date'] <= end);
    const W7 = S.filter(r => r['Reading Date'].getTime() >= now - 7 * 86400000);
    const D30 = S.filter(r => r['Reading Date'].getTime() >= now - 30 * 86400000);
    const first = S.length ? S[0]['Reading Date'] : null;
    const opDays = first ? Math.max(1, Math.round((now - first.getTime()) / 86400000) + 1) : 0;

    // coverage in period
    const dayset = {}; P.forEach(r => dayset[dkey_(r['Reading Date'])] = 1);
    const pStart = new Date(Math.max(start.getTime(), first ? first.getTime() : start.getTime()));
    const missed = []; let periodDays = 0;
    for (let t = new Date(pStart.getFullYear(), pStart.getMonth(), pStart.getDate()); t <= end; t = new Date(t.getTime() + 86400000)) {
      periodDays++; if (!dayset[dkey_(t)]) missed.push(Utilities.formatDate(t, CONFIG.TZ, 'dd MMM'));
    }
    const coverage = periodDays ? Math.round((periodDays - missed.length) / periodDays * 100) : 0;
    const pAlerts = P.filter(r => r['Status'] === 'ALERT');

    // metric rows
    const metricStatus = {};
    const metricRow = m => {
      const L = mstats_(S, m), w = mstats_(W7, m), d = mstats_(D30, m);
      let st = 'na', trend = '—';
      if (L) {
        st = 'ok';
        const t = thresholds[m.k] || {};
        if ((t.max != null && !isNaN(t.max) && L.last > t.max) || (t.min != null && !isNaN(t.min) && L.last < t.min)) st = 'bad';
        if (w && L.avg) {
          const ch = (w.avg - L.avg) / Math.abs(L.avg) * 100;
          const arrow = Math.abs(ch) < 3 ? '→' : ch > 0 ? '↑' : '↓';
          const bad = (m.worse === 'up' && ch > 10) || (m.worse === 'down' && ch < -10);
          trend = '<span style="color:' + (bad ? C.warn : Math.abs(ch) < 3 ? C.na : '#1F2937') + ';font-weight:bold">' + arrow + ' ' + (ch > 0 ? '+' : '') + ch.toFixed(0) + '%</span>';
          if (bad && st === 'ok') st = 'warn';
        }
      }
      metricStatus[m.k] = st;
      const dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + C[st] + ';margin-right:6px"></span>';
      return '<tr><td style="' + TD + '">' + dot + m.name + ' <span style="color:#9CA3AF">(' + m.unit + ')</span></td>' +
        '<td style="' + TD + 'font-weight:bold">' + fmt(L && L.last, m.dec) + '</td>' +
        '<td style="' + TD + '">' + fmt(w && w.avg, m.dec) + '</td>' +
        '<td style="' + TD + '">' + fmt(d && d.avg, m.dec) + '</td>' +
        '<td style="' + TD + '">' + fmt(L && L.avg, m.dec) + '</td>' +
        '<td style="' + TD + 'color:#6B7280">' + (L ? fmt(L.min, m.dec) + ' – ' + fmt(L.max, m.dec) : '—') + '</td>' +
        '<td style="' + TD + '">' + trend + '</td></tr>';
    };
    const head = '<tr><th style="' + TH + '">Metric</th><th style="' + TH + '">Latest</th><th style="' + TH + '">7-day</th><th style="' + TH + '">30-day</th><th style="' + TH + '">Lifetime</th><th style="' + TH + '">Min – Max</th><th style="' + TH + '">Trend*</th></tr>';

    // extras
    const cartDates = S.filter(r => r['Cartridge Change (Y/N)'] === 'Y').map(r => r['Reading Date']);
    const lastCart = cartDates.length ? cartDates[cartDates.length - 1] : null;
    const cartAge = lastCart ? Math.floor((now - lastCart.getTime()) / 86400000) : null;
    const dueDays = parseInt(general.cartridgeDays, 10) || 30;
    const cartSt = !S.length ? 'na' : lastCart == null ? 'warn' : cartAge > dueDays ? 'bad' : cartAge > dueDays * 0.8 ? 'warn' : 'ok';
    const antiP = P.length ? Math.round(P.filter(r => r['Antiscalant (Y/N)'] === 'Y').length / P.length * 100) : null;
    const antiL = S.length ? Math.round(S.filter(r => r['Antiscalant (Y/N)'] === 'Y').length / S.length * 100) : null;
    const antiSt = antiP == null ? 'na' : antiP === 100 ? 'ok' : antiP >= 90 ? 'warn' : 'bad';
    const covSt = !periodDays ? 'na' : coverage >= 95 ? 'ok' : coverage >= 80 ? 'warn' : 'bad';
    const kv = (k, v) => '<tr><td style="' + TD + 'color:#374151">' + k + '</td><td style="' + TD + 'font-weight:bold" colspan="6">' + v + '</td></tr>';

    let partsHtml = '';
    const partSt = [];
    REPORT_PARTS.forEach(part => {
      const rowsHtml = part.metrics.map(k => metricRow(REPORT_METRICS.filter(m => m.k === k)[0])).join('');
      let extra = '', exSt = [];
      if (part.extra === 'cartridge') {
        extra = kv('Last cartridge change', lastCart ? nice_(lastCart) + ' · <span style="color:' + C[cartSt] + '">' + cartAge + ' days ago</span> (due every ' + dueDays + ' days)' : 'Not recorded yet') +
                kv('Cartridge changes (lifetime)', cartDates.length);
        exSt.push(cartSt);
      }
      if (part.extra === 'antiscalant') {
        extra = kv('Dosing compliance — this period', antiP == null ? '—' : '<span style="color:' + C[antiSt] + '">' + antiP + '%</span> of readings') +
                kv('Dosing compliance — lifetime', antiL == null ? '—' : antiL + '%') +
                kv('Readings without antiscalant (period)', P.filter(r => r['Antiscalant (Y/N)'] === 'N').length);
        exSt.push(antiSt);
      }
      if (part.extra === 'coverage') {
        extra = kv('Days logged this period', (periodDays - missed.length) + ' / ' + periodDays + ' · <span style="color:' + C[covSt] + '">' + coverage + '%</span>') +
                kv('Missed days', missed.length ? missed.join(', ') : 'None ✅') +
                kv('Technicians active (period)', splitList_(P.map(r => r['Technician']).join(',')).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—') +
                kv('Total readings (lifetime)', S.length + ' over ' + opDays + ' days');
        exSt.push(covSt);
      }
      const st = worst(part.metrics.map(k => metricStatus[k]).concat(exSt));
      partSt.push(st);
      partsHtml += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;border:1px solid #E5E7EB;border-radius:12px;border-collapse:separate;overflow:hidden">' +
        '<tr><td style="padding:11px 14px;background:#FAFAFB;border-bottom:1px solid #E5E7EB"><span style="font-size:15px;font-weight:bold;color:#111827">' + part.icon + ' ' + part.title + '</span>' +
        '<span style="float:right">' + pill(st) + '</span></td></tr><tr><td style="padding:4px 8px 8px">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' + (rowsHtml ? head + rowsHtml : '') + extra + '</table></td></tr></table>';
    });
    const siteSt = worst(partSt); overall.push(siteSt);

    // KPI tiles
    const tds = mstats_(S, REPORT_METRICS[0]), rec = mstats_(P, REPORT_METRICS[1]);
    const tile = (v, l, col) => '<td width="25%" style="padding:6px"><div style="background:#fff;border:1px solid #F1E4E7;border-radius:12px;padding:12px 8px;text-align:center">' +
      '<div style="font-size:22px;font-weight:bold;color:' + (col || CONFIG.BRAND_DARK) + '">' + v + '</div><div style="font-size:10.5px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-top:3px">' + l + '</div></div></td>';
    const tiles = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      tile(tds ? fmt(tds.last, 0) : '—', 'Latest TDS (ppm)') + tile(rec ? fmt(rec.avg, 1) + '%' : '—', 'Avg recovery (period)') +
      tile(coverage + '%', 'Reading coverage', C[covSt]) + tile(pAlerts.length, 'Alerts (period)', pAlerts.length ? C.bad : C.ok) + '</tr><tr>' +
      tile(S.length, 'Readings (lifetime)') + tile(opDays, 'Days in operation') + tile(cartAge == null ? '—' : cartAge + 'd', 'Since cartridge change', C[cartSt]) +
      tile(antiP == null ? '—' : antiP + '%', 'Antiscalant compliance', C[antiSt]) + '</tr></table>';

    // recent alerts
    const recentAlerts = S.filter(r => r['Status'] === 'ALERT').slice(-8).reverse();
    const alertsHtml = recentAlerts.length ? '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px">' +
      recentAlerts.map(r => '<tr><td style="' + TD + 'white-space:nowrap;color:#6B7280">' + nice_(r['Reading Date']) + '</td><td style="' + TD + 'color:' + C.bad + '">' + r['Alerts'] + '</td><td style="' + TD + 'color:#6B7280">' + r['Technician'] + '</td></tr>').join('') + '</table>'
      : '<p style="color:' + C.ok + ';margin:6px 0">No alerts recorded ✅</p>';

    body += '<div style="margin-top:22px"><div style="font-size:18px;font-weight:bold;color:#111827">📍 ' + site + ' &nbsp;' + pill(siteSt) + '</div>' + tiles + partsHtml +
      '<div style="margin-top:16px;font-size:15px;font-weight:bold;color:#111827">🚨 Recent alerts</div>' + alertsHtml + '</div>';
  });
  if (!sites.length) body = '<p style="color:#B91C1C">No readings recorded yet.</p>';

  // Charts from the Dashboard tab → inline images
  const inline = {}; let chartsHtml = '';
  try {
    const dash = ss_().getSheetByName(CONFIG.SHEET_DASHBOARD);
    (dash ? dash.getCharts() : []).forEach((c, i) => {
      const blob = c.getAs('image/png').setName('chart' + i + '.png');
      inline['chart' + i] = blob;
      chartsHtml += '<img src="cid:chart' + i + '" width="600" style="width:100%;max-width:600px;border:1px solid #E5E7EB;border-radius:10px;margin-top:10px" alt="chart">';
    });
  } catch (e) { console.error('Charts', e); }

  const ov = worst(overall);
  const ovText = { ok: 'All systems healthy', warn: 'Some parameters need watching', bad: 'Action required', na: 'No data yet' }[ov];
  const html =
    '<div style="background:#F4F5F7;padding:20px 0;font-family:Segoe UI,Arial,sans-serif;color:#16181D">' +
    '<table role="presentation" align="center" width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB">' +
    '<tr><td style="background:linear-gradient(135deg,#A51C30,#7E1424);background-color:#A51C30;padding:24px 26px;color:#fff">' +
    '<div style="font-size:12px;opacity:.85;letter-spacing:.08em;text-transform:uppercase">Disrupt.com · Workplace Services · Soft FM</div>' +
    '<div style="font-size:24px;font-weight:bold;margin-top:4px">' + (general.plantName || 'RO Plant') + ' — Performance Report</div>' +
    '<div style="font-size:13px;opacity:.9;margin-top:4px">' + label + '</div></td></tr>' +
    '<tr><td style="padding:16px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C[ov + 'Bg'] + ';border-radius:12px"><tr><td style="padding:14px 16px">' +
    '<div style="font-size:11px;color:' + C[ov] + ';font-weight:bold;letter-spacing:.06em;text-transform:uppercase">Overall status</div>' +
    '<div style="font-size:19px;font-weight:bold;color:' + C[ov] + ';margin-top:2px">' + ovText + '</div></td></tr></table></td></tr>' +
    '<tr><td style="padding:0 22px 8px">' + body +
    (chartsHtml ? '<div style="margin-top:22px;font-size:15px;font-weight:bold;color:#111827">📈 Trends (from Dashboard)</div>' + chartsHtml : '') +
    '<p style="font-size:11.5px;color:#6B7280;margin-top:16px">*Trend = last 7-day average vs lifetime average. <b style="color:' + C.warn + '">WATCH</b> = moving the wrong way by more than 10%. <b style="color:' + C.bad + '">ACTION</b> = latest reading outside the limits in the Settings tab, cartridge overdue, antiscalant compliance below 90% or reading coverage below 80%.</p>' +
    '<p style="margin:18px 0 6px"><a href="https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '" style="background:#A51C30;color:#fff;padding:10px 16px;border-radius:9px;text-decoration:none;font-weight:bold;font-size:13px">Open full dashboard</a>' +
    ' &nbsp; <a href="' + portalUrl_(general) + '" style="color:#A51C30;font-weight:bold;font-size:13px;text-decoration:none">Open RO portal →</a></p>' +
    '</td></tr><tr><td style="padding:14px 22px;background:#FAFAFB;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF">Automated report · generated ' + nice_(new Date()) + ' ' + Utilities.formatDate(new Date(), CONFIG.TZ, 'HH:mm') + ' PKT · RO Reading Google Sheet</td></tr>' +
    '</table></div>';

  const emoji = { ok: '🟢', warn: '🟠', bad: '🔴', na: '⚪' }[ov];
  MailApp.sendEmail({
    to: recipients_(general),
    subject: emoji + ' RO Plant ' + kind + ' Performance Report — ' + ovText + ' (' + nice_(start) + ' → ' + nice_(end) + ')',
    htmlBody: html, inlineImages: inline, name: 'RO Plant Portal'
  });
  return html;
}
