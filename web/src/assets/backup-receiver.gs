/**
 * AADI Academy – Google Sheets backup receiver.
 *
 * Setup (5 minutes, see README "Google Sheets backup"):
 *   1. Create a NEW Google Sheet (keep it private – it holds member details).
 *   2. Extensions -> Apps Script -> paste this whole file -> set SECRET below -> Save.
 *   3. Deploy -> New deployment -> type "Web app" -> Execute as: Me -> Who has access: Anyone -> Deploy.
 *   4. Copy the Web app URL (ends with /exec) into the app: Admin -> Backup, with the same secret.
 *
 * What it does with every batch the app sends:
 *   - one tab per table (Shooters, Fees, Match Scores ...): the row is added, or updated if it already exists
 *   - "Change Log" tab: one line per change (time, table, insert/update/delete, who/what changed)
 *   - deleted rows stay in their tab, marked in the "_deleted_at" column – nothing is ever removed
 */
var SECRET = 'CHANGE-THIS-TO-A-LONG-RANDOM-SECRET'; // must match the secret typed in the app
var LOG_SHEET = 'Change Log';
var LOG_HEADERS = ['Change #', 'Time (IST)', 'Table', 'Action', 'Record ID', 'Summary', 'Full row (JSON)'];
var MAX_CELL = 45000;

function doGet() { return json_({ ok: true, service: 'AADI backup receiver' }); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(50000);
    var body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SECRET || SECRET.indexOf('CHANGE-THIS') === 0) return json_({ ok: false, error: 'bad secret' });
    var rows = body.rows || [], ss = SpreadsheetApp.getActiveSpreadsheet();
    var byTable = {}, logLines = [];
    rows.forEach(function (r) {
      if (r.op === 'ping') { writeStatus_(ss, r); return; }
      (byTable[r.table] = byTable[r.table] || []).push(r);
      if (r.op !== 'snapshot') logLines.push(r);
    });
    Object.keys(byTable).forEach(function (t) { upsert_(ss, t, byTable[t]); });
    appendLog_(ss, logLines);
    writeStatus_(ss, { data: { sent_at: new Date().toISOString() } }, rows.length);
    return json_({ ok: true, count: rows.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// "match_scores" -> "Match Scores"
function tabName_(t) { return t.split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }

// Keep spreadsheet formulas from running: a value starting with = + - @ is stored as text.
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string') {
    if (v.length > MAX_CELL) v = v.slice(0, MAX_CELL) + '…';
    if (/^[=+\-@]/.test(v)) v = "'" + v;
  }
  return v;
}

function upsert_(ss, table, items) {
  var sh = ss.getSheetByName(tabName_(table)) || ss.insertSheet(tabName_(table));
  // Header row: id first, then every field seen so far; new fields are appended as new columns.
  var lastCol = sh.getLastColumn();
  var headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  if (!headers.length) { headers = ['id']; }
  var changed = false;
  items.forEach(function (it) {
    Object.keys(it.data || {}).forEach(function (k) { if (headers.indexOf(k) < 0 && k !== '_deleted_at') { headers.push(k); changed = true; } });
  });
  if (headers.indexOf('_deleted_at') < 0) { headers.push('_deleted_at'); changed = true; }
  if (changed || !lastCol) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#0b2850').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  var idCol = headers.indexOf('id') + 1, delCol = headers.indexOf('_deleted_at') + 1;
  var lastRow = sh.getLastRow(), index = {};
  if (lastRow > 1) sh.getRange(2, idCol, lastRow - 1, 1).getValues().forEach(function (v, i) { index[String(v[0])] = i + 2; });

  var appendRows = [], pending = {}; // pending: id -> position in appendRows (same record changed twice in one batch)
  items.forEach(function (it) {
    var d = it.data || {}, id = String(it.id || d.id || '');
    var line = headers.map(function (h) {
      if (h === '_deleted_at') return it.op === 'delete' ? it.at : '';
      return cell_(d[h]);
    });
    if (pending[id] !== undefined) { appendRows[pending[id]] = line; }
    else if (index[id]) { sh.getRange(index[id], 1, 1, headers.length).setValues([line]); }
    else { pending[id] = appendRows.length; appendRows.push(line); }
  });
  if (appendRows.length) sh.getRange(lastRow + 1, 1, appendRows.length, headers.length).setValues(appendRows);
}

function appendLog_(ss, items) {
  if (!items.length) return;
  var sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET, 0);
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold').setBackground('#0b2850').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  // A retried batch must not be logged twice: skip change numbers already in the last 3000 lines.
  var last = sh.getLastRow(), seen = {};
  if (last > 1) {
    var from = Math.max(2, last - 2999);
    sh.getRange(from, 1, last - from + 1, 1).getValues().forEach(function (v) { seen[String(v[0])] = true; });
  }
  var out = [];
  items.forEach(function (it) {
    if (seen[String(it.seq)]) return;
    var d = it.data || {};
    var label = d.full_name || d.title || d.name || d.shooter_code || d.rifle_code || d.status || '';
    var time = Utilities.formatDate(new Date(it.at), 'Asia/Kolkata', 'dd MMM yyyy HH:mm:ss');
    out.push([it.seq, time, tabName_(it.table), it.op, it.id || '', cell_(label), cell_(d)]);
  });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, LOG_HEADERS.length).setValues(out);
}

function writeStatus_(ss, r, count) {
  var sh = ss.getSheetByName('Backup Status') || ss.insertSheet('Backup Status');
  var d = r.data || {};
  sh.getRange('A1:B1').setValues([['Last backup received', Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy HH:mm:ss') + ' IST']]);
  if (count !== undefined) sh.getRange('A2:B2').setValues([['Rows in last batch', count]]);
  if (r.op === 'ping') sh.getRange('A3:B3').setValues([['Last test from app', Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy HH:mm:ss') + ' IST']]);
  sh.getRange('A1:A3').setFontWeight('bold'); sh.setColumnWidth(1, 190); sh.setColumnWidth(2, 240);
}
