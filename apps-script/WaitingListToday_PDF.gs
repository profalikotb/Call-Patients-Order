/**
 * WaitingListToday — Oracle JDBC -> Google Sheets (FINAL)
 *
 * PENDING_TODAY : today's pending bookings (VW_PENDING_TODAY), FLAG=2 excluded.
 * رقم النداء / م : position of the booking in TODAY's VISITS_LIST ordered by NUMBER10
 *                 (1, 2, 3 … exactly like the Access list). Seen patients keep their number.
 * QUEUE_TODAY   : ALL of today's bookings → source for the Smart Queue app (optional).
 * doGet         : read-only JSON feed of QUEUE_TODAY for Smart Queue (SHEET_SOURCE=appsscript).
 *
 * Script Properties (Project settings → Script properties) — kept from the old project:
 *   ORA_URL   jdbc:oracle:thin:@//41.237.169.69:15210/orcl
 *   ORA_USER  clinics
 *   ORA_PWD   ********
 *   FEED_TOKEN  (only for Smart Queue; created by setupFeed())
 *
 * Install: paste whole file → Save → run installTrigger() once.
 */

/* ===================== SETTINGS ===================== */
const TZ            = 'Africa/Cairo';
const EVERY_MIN     = 1;                // 1, 5, 10, 15 or 30
const ACTIVE_HOURS  = [0, 24];          // [0,24] = all day. e.g. [8,24] saves quota (see notes)
const ENABLE_QUEUE  = true;             // false = do not build QUEUE_TODAY

const TAB          = 'PENDING_TODAY';
const QUEUE_TAB    = 'QUEUE_TODAY';
const STATUS_CELL  = 'J1';
const REFRESH_CELL = 'L1';

const HEADERS = ['م', 'رقم الحجز', 'كود المريض', 'اسم المريض', 'التليفون', 'نوع الزيارة', 'تاريخ الحجز', 'FLAG'];
const W = HEADERS.length;

// 'رقم النداء' = the SAME fixed number as column م in PENDING_TODAY → Smart Queue uses it as the queue number
const QUEUE_HEADERS = ['رقم النداء', 'رقم الحجز', 'التاريخ', 'العيادة', 'اسم المريض', 'التليفون', 'نوع الكشف', 'الحالة', 'كود المريض'];

// Clinic per weekday (Oracle has no clinic column). Must match Smart Queue clinic names.
const CLINIC_BY_DAY = {
  SAT: 'مصر الجديدة', SUN: 'مصر الجديدة', TUE: 'مصر الجديدة',
  WED: 'مصر الجديدة', THU: 'مصر الجديدة',
  FRI: 'طوخ',
  MON: 'وادي النيل'                    // not a queue clinic → ignored by the app
};
// VISIT_KIND → label shown in QUEUE_TODAY «نوع الكشف» (same as Access)
const VISIT_KIND_LABEL = { 1: 'كشف', 2: 'استشارة' };
/* ==================================================== */

// Pending list (view already = today, no VISIT_REC today). NULL flags included.
const SQL_PENDING =
  "SELECT NUMBER10, PATIENT_CODE, PATIENT_NAME, TELE_NO, VISIT_KIND, " +
  "       TO_CHAR(VISIT_DATE,'DD/MM/YYYY') AS VISIT_DATE, FLAG " +
  "FROM CLINICS.VW_PENDING_TODAY " +
  "WHERE (FLAG IS NULL OR FLAG <> 2) " +
  "ORDER BY NUMBER10";

// All of today's bookings for Smart Queue. No Arabic literals in SQL (charset-safe on 10g).
const SQL_QUEUE =
  "SELECT l.NUMBER10, TO_CHAR(l.VISIT_DATE,'DD/MM/YYYY') AS VDATE, " +
  "       TO_CHAR(l.VISIT_DATE,'DY','NLS_DATE_LANGUAGE=AMERICAN') AS VDAY, " +
  "       p.PATIENT_NAME, NULLIF(TRIM(p.TELE_NO),'none') AS TELE_NO, l.VISIT_KIND, " +
  "       CASE WHEN EXISTS (SELECT 1 FROM CLINICS.VISIT_REC v WHERE v.PATIENT_CODE = l.PATIENT_CODE " +
  "            AND v.VISIT_DATE >= TRUNC(SYSDATE) AND v.VISIT_DATE < TRUNC(SYSDATE) + 1) THEN 1 ELSE 0 END AS SEEN, " +
  "       l.PATIENT_CODE, " +
  "       ROW_NUMBER() OVER (ORDER BY l.NUMBER10) AS CALL_NO " +
  "FROM CLINICS.VISITS_LIST l " +
  "LEFT JOIN CLINICS.PATIENT_REC p ON p.PATIENT_CODE = l.PATIENT_CODE " +
  "WHERE l.VISIT_DATE >= TRUNC(SYSDATE) AND l.VISIT_DATE < TRUNC(SYSDATE) + 1 " +
  "ORDER BY l.NUMBER10";

/* ===================== MENU ===================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Oracle')
    .addItem('Refresh now', 'refreshPendingManual')
    .addItem('Test Oracle connection', 'testConnection')
    .addSeparator()
    .addItem('Install ' + EVERY_MIN + '-minute auto-refresh', 'installTrigger')
    .addItem('Remove auto-refresh triggers', 'removeTrigger')
    .addToUi();
}

function refreshPendingManual() { refreshPending_(true); }
function refreshPendingAuto()   { refreshPending_(false); }

/* ===================== TRIGGERS ===================== */
/** Run ONCE after pasting this entire file. Replaces existing matching triggers. */
function installTrigger() {
  removeTrigger();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open Apps Script from the target Google Sheet (Extensions > Apps Script).');
  setupRefreshCell_(getSheet_());
  ScriptApp.newTrigger('refreshPendingAuto').timeBased().everyMinutes(EVERY_MIN).create();
  ScriptApp.newTrigger('onEditRefresh').forSpreadsheet(ss).onEdit().create();
  Logger.log('Installed ' + EVERY_MIN + '-minute refresh and checkbox trigger.');
  refreshPending_(true);
}

function removeTrigger() {
  const names = ['refreshPendingAuto', 'onEditRefresh'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (names.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}

/** Installed onEdit trigger: the L1 checkbox works on desktop and mobile. */
function onEditRefresh(e) {
  const r = e && e.range;
  if (!r || r.getSheet().getName() !== TAB || r.getA1Notation() !== REFRESH_CELL) return;
  if (r.getValue() !== true) return;
  try {
    r.getSheet().getRange(STATUS_CELL).setValue('جارى التحديث...').setFontColor('#e65100');
    SpreadsheetApp.flush();
    refreshPending_(true);
  } finally {
    r.setValue(false);
  }
}

/* ===================== CORE ===================== */
function refreshPending_(manual) {
  if (!manual) {
    const h = Number(Utilities.formatDate(new Date(), TZ, 'H'));
    if (h < ACTIVE_HOURS[0] || h >= ACTIVE_HOURS[1]) return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('Previous refresh still running; skipped.'); return; }

  let conn = null, sh = null;
  try {
    sh = getSheet_();
    conn = connect_();

    /* ---- (1) ALL of today's bookings → calling number = position by NUMBER10 ---- */
    const callNo = Object.create(null);          // booking → رقم النداء
    const q = [];
    let st = conn.createStatement();
    let rs = st.executeQuery(SQL_QUEUE);
    while (rs.next()) {
      const booking = String(rs.getString(1) || '').trim();
      const n = Number(rs.getString(9));
      callNo[booking] = n;
      const kind = num_(rs.getString(6));
      q.push([
        n,
        num_(booking),
        rs.getString(2) || '',
        CLINIC_BY_DAY[String(rs.getString(3) || '').trim().toUpperCase()] || '',
        rs.getString(4) || '— غير مسجل —',
        rs.getString(5) || '',
        VISIT_KIND_LABEL[kind] || kind,
        rs.getString(7) === '1' ? 'تم الكشف' : '',
        num_(rs.getString(8))
      ]);
    }
    rs.close(); st.close();

    /* ---- (2) PENDING_TODAY (not seen, FLAG<>2) with the SAME numbers ---- */
    const out = [];
    let extra = q.length;                        // safety: booking not in today's list (should not happen)
    st = conn.createStatement();
    rs = st.executeQuery(SQL_PENDING);
    while (rs.next()) {
      const booking = String(rs.getString(1) || '').trim();
      const flagRaw = rs.getString(7);
      if (flagRaw !== null && flagRaw !== '' && Number(flagRaw) === 2) continue;
      const n = callNo[booking] || ++extra;
      out.push([n, num_(booking), num_(rs.getString(2)), rs.getString(3) || '— غير مسجل —',
                rs.getString(4) || '', num_(rs.getString(5)), rs.getString(6) || '', num_(flagRaw)]);
    }
    rs.close(); st.close();
    out.sort((x, y) => x[0] - y[0]);

    writeBlock_(sh, W, out, [5, 7]);                                  // phone + date as text
    let qCount = 0;
    if (ENABLE_QUEUE) {
      writeBlock_(getQueueSheet_(), QUEUE_HEADERS.length, q, [3, 6]);  // date + phone as text
      qCount = q.length;
    }

    status_(sh, 'Updated ' + now_() + ' — ' + out.length + ' waiting' +
                (ENABLE_QUEUE ? ' / ' + qCount + ' booked' : ''), false);
    SpreadsheetApp.flush();
    Logger.log('Refresh OK: ' + out.length + ' pending, ' + qCount + ' booked; ' + now_());
  } catch (err) {
    const msg = 'ERROR ' + now_() + ': ' + (err && err.message ? err.message : String(err));
    if (sh) status_(sh, msg, true);
    Logger.log(msg);
    throw err;                          // failed runs stay visible in Executions
  } finally {
    try { if (conn) conn.close(); } catch (e) {}
    lock.releaseLock();
  }
}

/** Clear old rows (keep header) and write new block; textCols formatted '@' BEFORE values. */
function writeBlock_(sh, width, rows, textCols) {
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (!rows.length) return;
  const need = rows.length + 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  textCols.forEach(c => sh.getRange(2, c, rows.length, 1).setNumberFormat('@'));
  sh.getRange(2, 1, rows.length, width).setValues(rows);
}

/* ===================== SMART QUEUE FEED ===================== */
/** Run once if you use Smart Queue with SHEET_SOURCE=appsscript; copy token to Vercel. */
function setupFeed() {
  const p = PropertiesService.getScriptProperties();
  let t = p.getProperty('FEED_TOKEN');
  if (!t) {
    t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    p.setProperty('FEED_TOKEN', t);
  }
  Logger.log('FEED_TOKEN (= APPS_SCRIPT_FEED_TOKEN in Vercel) = ' + t);
}

/** GET <exec URL>?token=FEED_TOKEN[&tab=QUEUE_TODAY] → {ok, values} as displayed. */
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('FEED_TOKEN');
  const p = (e && e.parameter) || {};
  if (!token || p.token !== token) return json_({ ok: false, error: 'forbidden' });
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(p.tab || QUEUE_TAB);
  if (!sh) return json_({ ok: false, error: 'tab_not_found' });
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1) return json_({ ok: true, values: [] });
  return json_({ ok: true, values: sh.getRange(1, 1, lr, lc).getDisplayValues() });
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== SHEETS & HELPERS ===================== */
function connect_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('ORA_URL'), user = p.getProperty('ORA_USER'), pwd = p.getProperty('ORA_PWD');
  if (!url || !user || !pwd) {
    throw new Error('Set ORA_URL, ORA_USER and ORA_PWD in Project settings > Script properties.');
  }
  return Jdbc.getConnection(url, user, pwd);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet. Use a sheet-bound Apps Script project.');
  const sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  ensureHeader_(sh, HEADERS, [45, 90, 95, 240, 120, 90, 105, 60], 4);
  return sh;
}

function getQueueSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(QUEUE_TAB) || ss.insertSheet(QUEUE_TAB);
  ensureHeader_(sh, QUEUE_HEADERS, [70, 90, 105, 110, 240, 120, 90, 90, 95], 5);
  return sh;
}

function ensureHeader_(sh, headers, widths, nameCol) {
  const hdr = sh.getRange(1, 1, 1, headers.length);
  if (hdr.getValues()[0].join('|') === headers.join('|')) return;
  hdr.setValues([headers])
    .setFontWeight('bold').setFontSize(11)
    .setBackground('#1f3b57').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 30);
  sh.setFrozenRows(1);
  sh.setRightToLeft(true);
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, 1, sh.getMaxRows(), headers.length).setHorizontalAlignment('center');
  sh.getRange(2, nameCol, sh.getMaxRows() - 1, 1).setHorizontalAlignment('right');
}

function setupRefreshCell_(sh) {
  const cb = sh.getRange(REFRESH_CELL);
  if (!cb.getDataValidation()) cb.insertCheckboxes();
  cb.setValue(false).setHorizontalAlignment('center');
  sh.getRange('K1').setValue('🔄 تحديث').setFontWeight('bold').setHorizontalAlignment('center');
}

function status_(sh, message, error) {
  sh.getRange(STATUS_CELL).setValue(message)
    .setFontColor(error ? '#c62828' : '#2e7d32').setFontWeight('bold');
}

function num_(s) { return s === null || s === '' ? '' : (isNaN(Number(s)) ? s : Number(s)); }
function now_()  { return Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy hh:mm:ss a'); }

/* ===================== DIAGNOSTICS ===================== */
function testConnection() {
  let conn = null;
  try {
    conn = connect_();
    const rs = conn.createStatement().executeQuery("SELECT TO_CHAR(SYSDATE,'DD/MM/YYYY HH:MI:SS AM') FROM DUAL");
    rs.next();
    const msg = 'Oracle connection OK. Server time: ' + rs.getString(1);
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}   // no UI when run from editor/trigger
  } finally {
    try { if (conn) conn.close(); } catch (e) {}
  }
}

function diagnoseConnection() {
  const p = PropertiesService.getScriptProperties();
  Logger.log('URL: ' + (p.getProperty('ORA_URL') || '(missing)'));
  Logger.log('User configured: ' + Boolean(p.getProperty('ORA_USER')) + ' | Password configured: ' + Boolean(p.getProperty('ORA_PWD')));
  const t = Date.now();
  try { testConnection(); }
  catch (e) {
    const ms = Date.now() - t;
    Logger.log('✖ FAIL (' + ms + ' ms) ' + (ms > 8000 ? 'TIMEOUT: router/firewall/IP changed' : 'FAST: refused/service/password') + ' | ' + e.message);
  }
}

function debugPending() { refreshPendingManual(); }
