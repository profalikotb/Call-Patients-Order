/**
 * Optional read-only feed for SHEET_SOURCE=appsscript (no Google Cloud service account needed).
 * Deploy: Extensions ▸ Apps Script (inside the booking spreadsheet) ▸ paste ▸
 *   Project Settings ▸ Script properties: FEED_TOKEN = <same as APPS_SCRIPT_FEED_TOKEN>
 *   Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone ▸ copy /exec URL.
 * Uses getDisplayValues() so dates/times arrive exactly as shown (dd/MM/yyyy, 7:30 PM) –
 * avoids Apps Script's 1899 time-zone serialisation bug for time-only cells.
 */
function doGet(e) {
  var token = PropertiesService.getScriptProperties().getProperty('FEED_TOKEN');
  if (!token || !e || !e.parameter || e.parameter.token !== token) return out_({ ok: false, error: 'forbidden' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = e.parameter.tab ? ss.getSheetByName(e.parameter.tab) : ss.getSheets()[0];
  if (!sh) return out_({ ok: false, error: 'tab_not_found' });
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1) return out_({ ok: true, values: [] });
  return out_({ ok: true, values: sh.getRange(1, 1, lastRow, lastCol).getDisplayValues() });
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
