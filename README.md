# RO Plant – Daily Readings Portal (Disrupt.com · Workplace Services)

Mobile portal for technicians → readings saved to the **RO Reading** Google Sheet.

## Folder
| Path | What |
|---|---|
| `index.html` | The portal (Vercel serves this). Already connected to the Apps Script backend via `RO_API_URL`. |
| `vercel.json`, `.vercelignore` | Vercel config (backend code is NOT published on the website). |
| `apps-script/` | Backend: paste into the RO Reading sheet → Extensions → Apps Script. |
| `qr/` | Printable QR sticker (A5), poster (A4), QR PNG. |

## Deploy on Vercel (via GitHub)
1. Create a **private** GitHub repo, upload everything in this folder (keep `index.html` at the repo root).
2. vercel.com → Add New → Project → import the repo → Framework: **Other** → Deploy (no build step).
3. Open the Vercel link → make one test entry → check the **Readings** tab.

## Backend (Apps Script) — must be on the latest version
1. Sheet → Extensions → Apps Script: paste `apps-script/Code.gs` (and `Index.html`) → Save.
2. Run `setup` once, then `installEmailTriggers` once (Allow permissions).
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (same link stays).
   Every time Code.gs changes, repeat step 3 — otherwise the website keeps using the old backend.

## Admin panel
Portal → 🔒 (top-right) → password from Settings tab → `adminPassword`.
QR sticker generator · Send performance report now · Send daily check e-mail.

## E-mails (to Settings → reportEmails)
Daily missed-reading / cartridge reminder (11:00) · Weekly report (Mon 9:00) · Monthly report (1st, 9:00).
