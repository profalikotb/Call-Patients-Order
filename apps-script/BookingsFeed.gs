/**
 * Prof Ali Kotb – Bookings → Smart Queue  (READ-ONLY feed)
 * ---------------------------------------------------------------
 * Gives the queue app, for one clinic date:  patient code → WhatsApp phone + booked time.
 * Reads the AllEvents2025 sheet (tab "AllEvent") and NEVER writes anything.
 * Install in a NEW, separate Apps Script project (script.google.com → New project),
 * so your booking pages (UpdateCalendlyGoogle) stay untouched.
 *
 * 1) Paste this file → Save.
 * 2) Run  setupFeed  once (allow access) → the log shows the TOKEN.
 * 3) Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → Deploy → copy the /exec URL.
 * 4) Vercel: BOOKINGS_FEED_URL = that URL, BOOKINGS_FEED_TOKEN = the token → Redeploy.
 *
 * Test in the browser:  <exec URL>?token=TOKEN&date=2026-11-10
 */
const SHEET_ID  = '1m_QfjGJCglye4XQvg_Z7T4INFvVgPxcbCZyfMEmuscA';   // AllEvents2025
const TAB       = 'AllEvent';
const TZ        = 'Africa/Cairo';

function setupFeed() {
  const p = PropertiesService.getScriptProperties();
  let t = p.getProperty('FEED_TOKEN');
  if (!t) { t = Utilities.getUuid().replace(/-/g, ''); p.setProperty('FEED_TOKEN', t); }
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  Logger.log('TOKEN = ' + t);
  Logger.log(sh ? 'Sheet OK: ' + (sh.getLastRow() - 1) + ' rows' : 'ERROR: tab "' + TAB + '" not found');
}

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('FEED_TOKEN');
  const q = (e && e.parameter) || {};
  if (!token || q.token !== token) return out_({ ok: false, error: 'forbidden' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  if (!sh) return out_({ ok: false, error: 'tab_not_found' });
  const rng = sh.getDataRange();
  const v = rng.getValues();
  const dv = rng.getDisplayValues();            // times exactly as shown in the sheet (avoids 1899 time-zone shifts)
  const h = v[0].map(function (x) { return String(x).trim(); });
  const c = { code: h.indexOf('Patient Code'), name: h.indexOf('Patient Name'), date: h.indexOf('TaskDate'),
              time: h.indexOf('TimeSlot'), phone: h.indexOf('FPhone'), proc: h.indexOf('Procedure') };
  if (c.code < 0 || c.date < 0 || c.phone < 0) return out_({ ok: false, error: 'columns_not_found', headers: h });

  const rows = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    if (isoDate_(r[c.date]) !== date) continue;
    const code = String(r[c.code]).trim();               // a real code (662619) or a label (NewLink, الهوارى …)
    rows.push({
      code: code,
      phone: waPhone_(r[c.phone]),                          // 2010xxxxxxxx (WhatsApp format) or ''
      time: c.time >= 0 ? String(dv[i][c.time]).trim() : '',
      procedure: c.proc >= 0 ? String(r[c.proc]).trim() : '',
      name: c.name >= 0 ? String(r[c.name]).trim() : '',
    });
  }
  return out_({ ok: true, date: date, count: rows.length, rows: rows });
}

// TaskDate may be a real date or text like 11/8/2026 (month/day/year)
function isoDate_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, TZ, 'yyyy-MM-dd');
  const s = String(x).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

// "+20 10 14151508" / "+201063360407" / "01063360407" → "201063360407"
function waPhone_(x) {
  let d = String(x).replace(/\D/g, '');
  if (/^01\d{9}$/.test(d)) d = '2' + d;
  if (/^1\d{9}$/.test(d)) d = '20' + d;
  return /^201\d{9}$/.test(d) ? d : '';
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
