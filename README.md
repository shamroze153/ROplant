# RO Plant – Daily Readings Portal

**Live portal (technicians):** https://script.google.com/macros/s/AKfycbzFyilnViSbd_Ga4mVeXgfyIV1EcngThFXlRftMgISZEGZv6As2BRRcXjwL4L3ubH03/exec
**Sheet:** https://docs.google.com/spreadsheets/d/15jlMJrqX_OoA02zqbHEEx5XflU7K9VKPAj22RLTwfYY

Mobile-first portal for technicians to log daily RO plant readings in under a minute.
Every submission is written to the **RO Reading** Google Sheet (tab `Readings`).

## What's inside
| File | Purpose |
|---|---|
| `apps-script/Code.gs` | Backend: writes readings to the sheet, checks alert limits, saves photos to Drive, emails alerts, builds the Dashboard |
| `apps-script/Index.html` | The portal (served by Apps Script) |
| `apps-script/appsscript.json` | Project manifest (timezone Asia/Karachi, permissions, web-app settings) |
| `web/index.html` | Optional copy for hosting on Vercel/any static host |

## Features
- **Manual entry** or **Scan with camera** (OCR runs on the phone, no API key needed)
  - Camera icon beside each field → scans that single value
  - "Scan a display / panel" → reads all numbers from one photo; technician assigns each to a field
  - Scanned photos are kept as evidence and saved to Google Drive, linked in the sheet
- All log-sheet parameters: Flow, Concentrate Flow, Inlet / Pump / Membrane Pressure, Temperature, Online TDS, Electrical Load, Antiscalant Y/N, Cartridge Change Y/N, Remarks
- **New:** Raw water tank **fill time (0 → full)** and **empty time**, with a built-in stopwatch that keeps running even if the phone closes the page
- **Recovery %** auto-calculated = Flow ÷ (Flow + Concentrate)
- Live limit checks (red field + message), confirmation screen before saving, OK / ALERT status stored per reading
- Optional e-mail alerts and optional access PIN
- Offline safe: if the network drops, the reading is saved on the phone and synced automatically
- Remembers the technician and site; autosaves the draft
- Sheet gets a formatted `Readings` tab, a `Settings` tab and a `Dashboard` tab (KPIs, last 10 readings, 4 trend charts)

## Setup (about 5 minutes)
1. Open the **RO Reading** sheet → **Extensions → Apps Script**.
2. Delete the sample code in `Code.gs` and paste the contents of `apps-script/Code.gs`.
3. Click **+ → HTML**, name it exactly `Index`, and paste `apps-script/Index.html`.
4. **Project Settings (⚙) → tick "Show appsscript.json manifest file"**, open `appsscript.json` in the editor, replace its contents with `apps-script/appsscript.json`.
5. Save. From the function dropdown pick **`setup`** → **Run** → **Review permissions** → choose your account → **Advanced → Go to project → Allow**.
   This creates the `Readings`, `Settings` and `Dashboard` tabs and a Drive folder **"RO Plant - Reading Photos"**.
6. **Deploy → New deployment → ⚙ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (technicians without Google accounts) or **Anyone within Disrupt** (only disrupt.com logins)
   - **Deploy** → copy the **Web app URL**.
7. Share the URL with technicians. On the phone, open it in Chrome → ⋮ → **Add to Home screen**.

## Configure (sheet → `Settings` tab, yellow cells)
- Plant name, sites, technician names, alert e-mails, e-mail alerts Y/N, PIN
- **Alert limits (MIN / MAX)** per reading. Defaults are generic — set them from your RO plant OEM datasheet / commissioning report.
Changes apply immediately, no redeploy needed.

## Updating the code later
After editing code: **Deploy → Manage deployments → ✏ → Version: New version → Deploy** (the URL stays the same).

## OCR notes
- Works best on **digital displays** (TDS meter, flow meter, HMI, VFD amps). Hold the phone straight, fill the frame, avoid glare.
- **Analog dial gauges** (needle pressure gauges) cannot be read by OCR — type those values; the photo can still be attached as evidence.
- Technicians always see and can edit what OCR filled (green "OCR" tag) before saving.

## Updating the live portal (keep the same link)
1. Paste the new `Code.gs` / `Index.html` into Apps Script → Save.
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**
   (Don't use "New deployment" for updates — that creates a new link.)

## Optional: host on Vercel instead
`web/index.html` is already connected to your live web app URL (RO_API_URL is set).
Upload the `web` folder to Vercel (New Project → import / drag & drop) — no build step needed.
If you ever create a new Apps Script deployment, update `RO_API_URL` in `web/index.html`.
(Web app access must be **Anyone** for this mode.)
