/**
 * WaitingListToday — DIRECT Google Sheet ⇄ Oracle (JDBC) + Smart Queue feed
 *
 * Tabs written on every refresh (one Oracle connection):
 *   PENDING_TODAY  booked today, NOT yet seen (no VISIT_REC today)       → for you / reception
 *   QUEUE_TODAY    ALL of today's bookings (stable list)                  → source for Smart Queue app
 *
 * First time:
 *   1) Project Settings → Time zone = Africa/Cairo
 *   2) Run saveConfig()          → stores Oracle settings below + creates FEED_TOKEN (see log)
 *   3) Run diagnoseConnection()  → must show ✔ OK
 *   4) Reload sheet → menu Oracle → Install auto + mobile refresh
 *   5) (Smart Queue via Apps Script feed) Deploy → New deployment → Web app
 *        Execute as: Me · Who has access: Anyone → copy /exec URL
 * If your public IP changes: edit ORA_HOST and run saveConfig() again.
 */

/* ======== ORACLE SETTINGS (edit here only) ======== */
const ORA_HOST    = '41.237.169.69';   // public IP or DDNS name of the router
const ORA_PORT    = 15210;             // router external port → DRALIKOTB:1521
const ORA_SERVICE = 'orcl';
const ORA_USER_V  = 'clinics';
const ORA_PWD_V   = 'clinics';
/* ================================================== */

/* ======== CLINIC BY WEEKDAY (QUEUE_TODAY "العيادة") ======== */
// Must match clinic names/aliases in the Smart Queue app (مصر الجديدة / طوخ).
// Days not listed are left blank → ignored by the queue.
const CLINIC_BY_DAY = {
  SAT: 'مصر الجديدة', SUN: 'مصر الجديدة', TUE: 'مصر الجديدة',
  FRI: 'طوخ',
  MON: 'وادي النيل',            // not a queue clinic → ignored by the app
  WED: 'مصر الجديدة', THU: 'مصر الجديدة'
};
/* =========================================================== */

const ACTIVE_HOURS = [8, 23];          // auto-refresh window (Cairo). [0, 24] = all day
const EVERY_MIN    = 5;

const PENDING = {
  tab: 'PENDING_TODAY',
  headers: ['م', 'رقم الحجز', 'كود المريض', 'اسم المريض', 'التليفون', 'نوع الزيارة', 'تاريخ الحجز', 'FLAG'],
  widths:  [45, 90, 95, 240, 120, 90, 105, 60],
  textCols: [5, 7]                      // phone, date → plain text
};

const QUEUE = {
  tab: 'QUEUE_TODAY',
  headers: ['رقم الحجز', 'التاريخ', 'العيادة', 'اسم المريض', 'التليفون', 'نوع الكشف', 'الحالة', 'كود المريض'],
  widths:  [90, 105, 110, 240, 120, 90, 90, 95],
  textCols: [2, 5]                      // date, phone → plain text (no locale re-parsing)
};

const STATUS_CELL  = 'J1';             // on PENDING_TODAY
const REFRESH_CELL = 'L1';             // checkbox on PENDING_TODAY (mobile refresh)

// Today's bookings, all of them, with "seen" flag. No Arabic literals in SQL (charset-safe).
const SQL_TODAY =
  "SELECT l.NUMBER10, l.PATIENT_CODE, p.PATIENT_NAME, " +
  "       NULLIF(TRIM(p.TELE_NO),'none') AS TELE_NO, l.VISIT_KIND, " +
  "       TO_CHAR(l.VISIT_DATE,'DD/MM/YYYY') AS VDATE, l.FLAG, " +
  "       TO_CHAR(l.VISIT_DATE,'DY','NLS_DATE_LANGUAGE=AMERICAN') AS VDAY, " +
  "       CASE WHEN EXISTS (SELECT 1 FROM CLINICS.VISIT_REC v " +
  "                         WHERE v.PATIENT_CODE = l.PATIENT_CODE " +
  "                         AND v.VISIT_DATE >= TRUNC(SYSDATE) AND v.VISIT_DATE < TRUNC(SYSDATE) + 1) " +
  "            THEN 1 ELSE 0 END AS SEEN " +
  "FROM   CLINICS.VISITS_LIST l " +
  "LEFT JOIN CLINICS.PATIENT_REC p ON p.PATIENT_CODE = l.PATIENT_CODE " +
  "WHERE  l.VISIT_DATE >= TRUNC(SYSDATE) AND l.VISIT_DATE < TRUNC(SYSDATE) + 1 " +
  "ORDER  BY l.NUMBER10";

/* ---------- config ---------- */
function saveConfig() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    ORA_URL:  'jdbc:oracle:thin:@//' + ORA_HOST + ':' + ORA_PORT + '/' + ORA_SERVICE,
    ORA_USER: ORA_USER_V,
    ORA_PWD:  ORA_PWD_V
  });
  let feed = props.getProperty('FEED_TOKEN');
  if (!feed) {
    feed = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('FEED_TOKEN', feed);
  }
  Logger.log('Saved ORA_URL = jdbc:oracle:thin:@//' + ORA_HOST + ':' + ORA_PORT + '/' + ORA_SERVICE);
  Logger.log('FEED_TOKEN (= APPS_SCRIPT_FEED_TOKEN in Vercel) = ' + feed);
}

/* ---------- menu ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Oracle')
    .addItem('Refresh now', 'refreshPendingManual')
    .addItem('Test connection', 'testConnection')
    .addSeparator()
    .addItem('Install auto + mobile refresh', 'installTrigger')
    .addItem('Remove all triggers', 'removeTrigger')
    .addToUi();
}

/* ---------- entry points ---------- */
function refreshPendingManual() { refreshAll_(true); }
function refreshPendingAuto()   { refreshAll_(false); }

function testConnection() {
  const conn = connect_();
  try {
    const rs = conn.createStatement().executeQuery(
      "SELECT TO_CHAR(SYSDATE,'DD/MM/YYYY HH:MI:SS AM') FROM DUAL");
    rs.next();
    SpreadsheetApp.getUi().alert('Connected ✔\nOracle server time: ' + rs.getString(1));
  } finally { conn.close(); }
}

/* ---------- core ---------- */
function refreshAll_(manual, silent) {
  if (!manual) {
    const h = Number(Utilities.formatDate(new Date(), 'Africa/Cairo', 'H'));
    if (h < ACTIVE_HOURS[0] || h >= ACTIVE_HOURS[1]) return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;

  const pendingSh = getSheet_(PENDING);
  let conn;
  try {
    conn = connect_();
    const st = conn.createStatement();
    const rs = st.executeQuery(SQL_TODAY);

    const pending = [], queue = [];
    while (rs.next()) {
      const id    = num_(rs.getString(1));
      const code  = num_(rs.getString(2));
      const name  = rs.getString(3) || '— غير مسجل —';
      const phone = rs.getString(4) || '';
      const kind  = num_(rs.getString(5));
      const date  = rs.getString(6) || '';
      const flag  = num_(rs.getString(7));
      const day   = (rs.getString(8) || '').trim().toUpperCase();
      const seen  = rs.getString(9) === '1';

      queue.push([id, date, CLINIC_BY_DAY[day] || '', name, phone, kind, seen ? 'تم الكشف' : '', code]);
      if (!seen) pending.push([pending.length + 1, id, code, name, phone, kind, date, flag]);
    }
    rs.close(); st.close();

    writeRows_(pendingSh, PENDING, pending);
    writeRows_(getSheet_(QUEUE), QUEUE, queue);
    status_(pendingSh, 'Updated ' + now_() + ' — ' + pending.length + ' waiting / ' + queue.length + ' booked', false);
  } catch (err) {
    status_(pendingSh, 'ERROR ' + now_() + ': ' + (err && err.message || err), true);
    if (manual && !silent) throw err;
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
    lock.releaseLock();
  }
}

function writeRows_(sh, spec, rows) {
  const W = spec.headers.length;
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, W).clearContent();
  if (!rows.length) return;
  const need = rows.length + 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  spec.textCols.forEach(c => sh.getRange(2, c, rows.length, 1).setNumberFormat('@'));  // BEFORE values
  sh.getRange(2, 1, rows.length, W).setValues(rows);
}

/* ---------- triggers ---------- */
function installTrigger() {
  removeTrigger();
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('refreshPendingAuto').timeBased().everyMinutes(EVERY_MIN).create();
  ScriptApp.newTrigger('onEditRefresh').forSpreadsheet(ss).onEdit().create();
  setupRefreshCell_(getSheet_(PENDING));
  refreshAll_(true);
}

function removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['refreshPendingAuto', 'onEditRefresh'].indexOf(t.getHandlerFunction()) > -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// Installable onEdit (simple onEdit cannot use JDBC)
function onEditRefresh(e) {
  const r = e && e.range;
  if (!r || r.getSheet().getName() !== PENDING.tab || r.getA1Notation() !== REFRESH_CELL) return;
  if (r.getValue() !== true) return;
  r.getSheet().getRange(STATUS_CELL).setValue('⏳ جارى التحديث...').setFontColor('#e65100');
  SpreadsheetApp.flush();
  refreshAll_(true, true);
  r.setValue(false);
}

function setupRefreshCell_(sh) {
  const cb = sh.getRange(REFRESH_CELL);
  if (cb.getDataValidation() == null) cb.insertCheckboxes();
  cb.setValue(false).setHorizontalAlignment('center');
  sh.getRange('K1').setValue('🔄 تحديث').setFontWeight('bold').setHorizontalAlignment('center');
}

/* ---------- Smart Queue feed (SHEET_SOURCE=appsscript) ---------- */
// GET <exec URL>?token=FEED_TOKEN&tab=QUEUE_TODAY  → {ok, values:[[...]]} exactly as displayed
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('FEED_TOKEN');
  const p = (e && e.parameter) || {};
  if (!token || p.token !== token) return out_({ ok: false, error: 'forbidden' });
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(p.tab || QUEUE.tab);
  if (!sh) return out_({ ok: false, error: 'tab_not_found' });
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1) return out_({ ok: true, values: [] });
  return out_({ ok: true, values: sh.getRange(1, 1, lastRow, lastCol).getDisplayValues() });
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- helpers ---------- */
function connect_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('ORA_URL'), user = p.getProperty('ORA_USER'), pwd = p.getProperty('ORA_PWD');
  if (!url || !user || !pwd) throw new Error('Missing ORA_URL / ORA_USER / ORA_PWD — run saveConfig()');
  return Jdbc.getConnection(url, user, pwd);
}

function getSheet_(spec) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(spec.tab) || ss.insertSheet(spec.tab);
  ensureHeader_(sh, spec);
  return sh;
}

function ensureHeader_(sh, spec) {
  const W = spec.headers.length;
  const hdr = sh.getRange(1, 1, 1, W);
  if (hdr.getValues()[0].join('|') === spec.headers.join('|')) return;
  hdr.setValues([spec.headers])
     .setFontWeight('bold').setFontSize(11)
     .setBackground('#1f3b57').setFontColor('#ffffff')
     .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 30);
  sh.setFrozenRows(1);
  sh.setRightToLeft(true);
  spec.widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, 1, sh.getMaxRows(), W).setHorizontalAlignment('center');
  const nameCol = spec.headers.indexOf('اسم المريض') + 1;
  if (nameCol > 0) sh.getRange(2, nameCol, sh.getMaxRows() - 1, 1).setHorizontalAlignment('right');
}

function status_(sh, msg, isErr) {
  sh.getRange(STATUS_CELL).setValue(msg).setFontColor(isErr ? '#c62828' : '#2e7d32').setFontWeight('bold');
}

function num_(s) { return s == null || s === '' ? '' : (isNaN(s) ? s : Number(s)); }
function now_()  { return Utilities.formatDate(new Date(), 'Africa/Cairo', 'dd/MM/yyyy hh:mm a'); }

/* ---------- diagnostics ---------- */
function diagnoseConnection() {
  const p = PropertiesService.getScriptProperties();
  const url = (p.getProperty('ORA_URL') || '').trim();
  const user = (p.getProperty('ORA_USER') || '').trim();
  const pwd = p.getProperty('ORA_PWD') || '';
  const out = ['ORA_URL  = ' + (url || '(missing)'), 'ORA_USER = ' + (user || '(missing)') + ' | ORA_PWD length = ' + pwd.length];
  const t = Date.now();
  try {
    const c = Jdbc.getConnection(url, user, pwd); c.close();
    out.push('✔ OK (' + (Date.now() - t) + ' ms)');
  } catch (e) {
    const ms = Date.now() - t;
    out.push('✖ FAIL (' + ms + ' ms) ' + (ms > 8000 ? '→ TIMEOUT: router/firewall/IP changed' : '→ FAST: refused / service / password') + ' | ' + e.message);
  }
  Logger.log(out.join('\n'));
}

function debugPending() {
  const log = [];
  let conn;
  const step = (name, fn) => {
    try { const r = fn(); log.push('✔ ' + name + (r !== undefined ? ' → ' + r : '')); return r; }
    catch (e) { log.push('✖ ' + name + ' → ' + (e && e.message || e)); throw e; }
  };
  try {
    conn = step('1 connect', () => connect_());
    step('2 DB charset', () => {
      const r = conn.createStatement().executeQuery(
        "SELECT VALUE FROM NLS_DATABASE_PARAMETERS WHERE PARAMETER='NLS_CHARACTERSET'");
      r.next(); return r.getString(1);
    });
    const rs = step('3 executeQuery', () => conn.createStatement().executeQuery(SQL_TODAY));
    let n = 0;
    while (rs.next()) {
      n++;
      if (n <= 3) step('4 row ' + n, () => [1,2,3,4,5,6,7,8,9].map(c => rs.getString(c)).join(' | '));
    }
    log.push('Rows today: ' + n);
  } catch (e) {
  } finally {
    try { conn && conn.close(); } catch (e) {}
    Logger.log(log.join('\n'));
  }
}
