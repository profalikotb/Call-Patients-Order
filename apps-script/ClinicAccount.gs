/**
 * Prof Ali Kotb – Smart Queue → Google Sheet «DailyClinicAcount»
 * ---------------------------------------------------------------
 * Storage for the daily clinic closing (تقفيل العيادة): ONE row per clinic per day.
 * Saving the closing on the website writes/updates its row here automatically.
 *
 * Install (inside THIS spreadsheet):
 * 1) Extensions → Apps Script → paste this file → Save.
 * 2) Run  setupAccount  once (allow access) → the log (View → Logs / Execution log) shows the TOKEN.
 * 3) Deploy → New deployment → ⚙ Web app → Execute as: Me · Who has access: Anyone → Deploy → copy the /exec URL.
 * 4) Vercel → Environment Variables:  ACCOUNT_SHEET_URL = the /exec URL,  ACCOUNT_SHEET_TOKEN = the token → Redeploy.
 * 5) Website → الإعدادات → «⇪ إرسال كل التقفيلات إلى Google Sheet» once (copies the days already saved).
 */
const ACC_TAB = 'DailyClinicAcount';
const ACC_HEAD = ['Date of Work', 'Clinic', 'No of Cases', 'Fees Back', 'Net Number', 'Fees', 'NetFees',
  'Mohamed Day', 'Mohamed Salary', 'Mohamed Clean', 'Naser Clean', 'Bawab and Mentainace', 'Parking',
  'Electricity and Gas', 'Running Cost', 'Tukh', 'Others', 'NotesofOther', 'Notes', 'Total Expenses', 'Grand Net',
  'Cash', 'InstaPay', 'Refunded', 'Consultations', 'DailyReport', 'Saved By', 'Saved At', 'Key'];

function setupAccount() {
  const p = PropertiesService.getScriptProperties();
  let t = p.getProperty('ACC_TOKEN');
  if (!t) { t = Utilities.getUuid().replace(/-/g, ''); p.setProperty('ACC_TOKEN', t); }
  accSheet_();
  Logger.log('TOKEN = ' + t);
}

function accSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ACC_TAB) || ss.insertSheet(ACC_TAB);
  const first = sh.getRange(1, 1, 1, ACC_HEAD.length).getValues()[0];
  if (first.join('|') !== ACC_HEAD.join('|')) {
    sh.getRange(1, 1, 1, ACC_HEAD.length).setValues([ACC_HEAD])
      .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff').setVerticalAlignment('middle').setWrap(true);
    sh.setFrozenRows(1); sh.setFrozenColumns(2); sh.setRowHeight(1, 36);
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy');
    sh.getRange('C:Q').setNumberFormat('#,##0');
    sh.getRange('T:Y').setNumberFormat('#,##0');
    sh.getRange('AB:AB').setNumberFormat('dd/MM/yyyy hh:mm AM/PM');
    sh.getRange('U:U').setFontWeight('bold').setBackground('#fef08a');
    sh.getRange('G:G').setFontWeight('bold').setFontColor('#047857');
    sh.getRange('T:T').setFontColor('#be123c');
    sh.setColumnWidth(1, 95); sh.setColumnWidth(2, 120); sh.setColumnWidth(26, 420);
    sh.hideColumns(ACC_HEAD.length);                       // Key (clinic|yyyy-mm-dd) – used to update the same day
  }
  return sh;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!b.token || b.token !== PropertiesService.getScriptProperties().getProperty('ACC_TOKEN')) return accOut_({ ok: false, error: 'forbidden' });
    const rows = b.rows || (b.row ? [b.row] : []);
    lock.waitLock(20000);
    const sh = accSheet_();
    const last = sh.getLastRow();
    const keys = last > 1 ? sh.getRange(2, ACC_HEAD.length, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    let added = 0, updated = 0;
    rows.forEach(function (r) {
      const key = r.clinic_id + '|' + r.date;
      const p = r.date.split('-');
      const vals = [new Date(+p[0], +p[1] - 1, +p[2]), r.clinic, r.no_cases, r.fees_back, r.net_number, r.fees, r.net_fees,
        r.mohamed_day, r.mohamed_salary, r.mohamed_clean, r.naser_clean, r.bawab, r.parking,
        r.electricity, r.running, r.tukh, r.others, r.notes_other || '', r.notes || '', r.exp, r.grand_net,
        r.cash, r.instapay, r.refund, r.istishara, r.report, r.saved_by || '', r.saved_at ? new Date(r.saved_at) : new Date(), key];
      const i = keys.indexOf(key);
      if (i >= 0) { sh.getRange(i + 2, 1, 1, ACC_HEAD.length).setValues([vals]); updated++; }
      else { sh.appendRow(vals); keys.push(key); added++; }
    });
    if (added) {                                         // keep the sheet sorted by date, then clinic
      const n = sh.getLastRow() - 1;
      if (n > 1) sh.getRange(2, 1, n, ACC_HEAD.length).sort([{ column: 1, ascending: true }, { column: 2, ascending: true }]);
    }
    return accOut_({ ok: true, added: added, updated: updated });
  } catch (err) {
    return accOut_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet() { return accOut_({ ok: true, service: 'DailyClinicAcount' }); }
function accOut_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
