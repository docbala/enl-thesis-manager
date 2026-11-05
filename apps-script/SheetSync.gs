/**
 * ENL Thesis Manager: copy-back to the Google Sheet + weekly backup.
 *
 * This is a SEPARATE Apps Script project. It does not change the old Thesis Manager script.
 * It only writes:
 *   - the old app's own columns (A..AG in Patient_Master, A..AD in Longitudinal_Visits), in the same format,
 *     for records that were added or changed in the new app;
 *   - new APP_ columns to the right of those, which the old app never reads.
 * It never renames, moves, reorders or deletes tabs, columns or rows.
 *
 * One-time setup: paste this file and appsscript.json into a new project at script.google.com, then run setup() once.
 *
 * Permissions are limited on purpose (see appsscript.json):
 *   - spreadsheets: read/write Google Sheets (needed for the thesis sheet; Google cannot limit this to one sheet)
 *   - drive.file: ONLY files this script creates itself (the backup folder and backups), not the rest of your Drive
 *   - script.external_request: talk to the study database
 *   - script.scriptapp: run on a timer
 *   - script.send_mail: send the backup email to you; it cannot read your Gmail
 */

var CFG = {
  SUPABASE_URL: 'https://pmqzhjzpututodtzovut.supabase.co',
  SUPABASE_KEY: 'sb_publishable_WNYWciJUVPMb8aK9lXPQfQ_bUJJBcoX',
  SYNC_SECRET: '__SYNC_SECRET__',
  SHEET_ID: '1tMhgrwS45rbdQ69YjXoz7UBEF5z6-qZsTiUAiGqRJyM',
  BACKUP_FOLDER: 'ENL Thesis Backups',
  EMAIL: 'happyneemtree@gmail.com',   // where backup emails go
  KEEP_WEEKLY: 12,
};

var P_COLS = ['cr_no', 'enrollment_date', 'uhid', 'opd_slip_no', 'patient_name', 'age', 'sex', 'relative_name',
  'initial_mdt_months', 'contact_no', 'leprosy_spectrum', 'mdt_status', 'baseline_bi', 'baseline_mi', 'diagnostic_status',
  'height_cm', 'weight_kg', 'bmi', 'address', 'family_history', 'socioeconomic_status', 'followups_completed',
  'b_hb', 'b_nlr', 'b_plr', 'b_agr', 'b_vit_d3', 'b_uric_acid', 'enl_developed', 'next_due_date', 'patient_status',
  'opd_slip_url', 'diagnostic_report_url'];                       // 33 columns = A..AG
var P_DATES = { enrollment_date: 1, next_due_date: 1 };
var P_APP = ['APP_Patient_UUID', 'APP_MDT_Start_Date', 'APP_MDT_Start_Confirmed', 'APP_Synced_At', 'APP_Followups_Completed'];
var P_KEEP_SHEET_VALUE = 21;   // Followups_Completed (column V) is a date-typed column in the sheet's table: never written

var V_COLS = ['visit_id', 'cr_no', 'visit_type', 'visit_date', 'hb', 'tlc', 'granulocyte_pct', 'lymphocyte_pct', 'platelets',
  'nlr', 'plr', 'total_protein', 'albumin', 'globulin', 'agr', 'vit_d3', 'vit_b12', 'uric_acid', 'creatinine', 'sgot', 'sgpt',
  'alp', 'esr', 'crp', 'enl_reaction', 'ess_score', 'clinical_notes', 'report_url', 'urea', 'hba1c'];   // 30 columns = A..AD
var V_DATES = { visit_date: 1 };
var V_APP = ['APP_Visit_UUID', 'APP_Unscheduled', 'APP_Prednisolone_mg', 'APP_Weight_kg', 'APP_Synced_At', 'APP_Deleted'];

// ---------------------------------------------------------------- setup

function setup() {
  // 1. Safety copy of the whole sheet before the first write
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SAFETY_COPY_ID')) {
    var copy = copySpreadsheet_(SpreadsheetApp.openById(CFG.SHEET_ID), 'HD_ENL_Thesis_Master (copy before app sync ' + today_() + ')');
    props.setProperty('SAFETY_COPY_ID', copy.getId());
  }
  // 2. One-time repair: HD-001 was only partly written by the first version of this script
  if (!props.getProperty('REPAIR_1_DONE')) {
    rpc_('sheet_requeue', { p_secret: CFG.SYNC_SECRET, p_cr_nos: ['HD-001'] });
    props.setProperty('REPAIR_1_DONE', 'yes');
  }
  // 3. Triggers: copy-back every 10 minutes, backup every Sunday night
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['syncNow', 'weeklyBackup'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
  // 4. Run both once now
  var n = syncNow();
  weeklyBackup();
  Logger.log('Setup done. Copied %s change(s) to the sheet. Backup saved in Drive folder "%s".', n, CFG.BACKUP_FOLDER);
}

// ---------------------------------------------------------------- copy-back

function syncNow() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 0;
  var done = 0;
  try {
    var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    var pSheet = ss.getSheetByName('Patient_Master'), vSheet = ss.getSheetByName('Longitudinal_Visits');
    for (var round = 0; round < 5; round++) {
      var items = rpc_('sheet_pull', { p_secret: CFG.SYNC_SECRET, p_limit: 100 });
      if (!items || !items.length) break;
      var pIdx = sheetIndex_(pSheet, P_COLS.length, P_APP);
      var vIdx = sheetIndex_(vSheet, V_COLS.length, V_APP);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        try {
          if (!it.row) { rpc_('sheet_ack', { p_secret: CFG.SYNC_SECRET, p_ids: it.queue_ids }); continue; }
          if (it.table === 'patients') writePatient_(pSheet, pIdx, it.row);
          else writeVisit_(vSheet, vIdx, it.row);
          SpreadsheetApp.flush();                                   // surfaces any refused write before it is marked done
          rpc_('sheet_ack', { p_secret: CFG.SYNC_SECRET, p_ids: it.queue_ids });
          done++;
        } catch (e) {
          rpc_('sheet_ack', { p_secret: CFG.SYNC_SECRET, p_ids: it.queue_ids, p_error: String(e && e.message || e) });
        }
      }
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
  return done;
}

function writePatient_(sheet, idx, p) {
  var row = findPatientRow_(idx, p);
  var vals = toPatientRow(p);
  var app = { APP_Patient_UUID: p.id, APP_MDT_Start_Date: asDate_(p.mdt_start_date),
    APP_MDT_Start_Confirmed: p.mdt_start_estimated ? 'N' : 'Y', APP_Synced_At: new Date(),
    APP_Followups_Completed: p.followups_completed === null || p.followups_completed === undefined ? '' : p.followups_completed };
  if (row) {
    vals[P_KEEP_SHEET_VALUE] = idx.data[row - 1][P_KEEP_SHEET_VALUE];   // leave the old app's value as it is
    sheet.getRange(row, 1, 1, vals.length).setValues([vals]);
  } else {
    vals[P_KEEP_SHEET_VALUE] = '';
    sheet.appendRow(padRow_(vals, idx));
    row = sheet.getLastRow();
    idx.data.push(sheet.getRange(row, 1, 1, idx.width).getValues()[0]);
  }
  writeApp_(sheet, idx, row, app);
}

function writeVisit_(sheet, idx, v) {
  var row = findVisitRow(idx, v);
  var vals = toVisitRow(v);
  var app = { APP_Visit_UUID: v.id, APP_Unscheduled: v.is_unscheduled ? 'Y' : 'N', APP_Prednisolone_mg: v.prednisolone_mg,
    APP_Weight_kg: v.weight_kg, APP_Synced_At: new Date(), APP_Deleted: v.deleted_at ? 'Deleted in app' : '' };
  if (row) {
    if (!v.deleted_at) sheet.getRange(row, 1, 1, vals.length).setValues([vals]);   // a deleted visit keeps its old values
  } else {
    if (v.deleted_at) return;                                                         // never existed in the sheet
    sheet.appendRow(padRow_(vals, idx));
    row = sheet.getLastRow();
    idx.data.push(sheet.getRange(row, 1, 1, idx.width).getValues()[0]);
  }
  writeApp_(sheet, idx, row, app);
}

// ---------------------------------------------------------------- pure helpers (also tested outside Apps Script)

function toPatientRow(p) {
  return P_COLS.map(function (c) {
    var x = p[c];
    if (c === 'enl_developed') return x === true ? 'Y' : x === false ? 'N' : '';
    if (c === 'contact_no' && /^\d+$/.test(String(x || ''))) return Number(x);   // number-typed column in the sheet
    if (P_DATES[c]) return asDate_(x);
    return x === null || x === undefined ? '' : x;
  });
}

function toVisitRow(v) {
  return V_COLS.map(function (c) {
    var x = v[c];
    if (c === 'visit_id') return String(x).split('__dup')[0];
    if (c === 'vit_b12') return x === null || x === undefined ? '' : (v.vit_b12_flag ? v.vit_b12_flag + x : x);
    if (c === 'enl_reaction') return x === true ? 'Y' : x === false ? 'N' : '';
    if (c === 'clinical_notes') return x || 'Saved from new app';
    if (V_DATES[c]) return asDate_(x);
    return x === null || x === undefined ? '' : x;
  });
}

function findPatientRow_(idx, p) {
  var u = idx.col.APP_Patient_UUID, d = idx.data, i;
  for (i = 1; i < d.length; i++) if (d[i][u] === p.id) return i + 1;
  for (i = 1; i < d.length; i++) if (String(d[i][0]).trim() === p.cr_no) return i + 1;
  if (p.old_cr_no) for (i = 1; i < d.length; i++) if (String(d[i][0]).trim() === p.old_cr_no) return i + 1;
  return 0;
}

// Imported visits are matched by Visit_ID; duplicates in the old sheet (HD-011, HD-049) by their original row.
function findVisitRow(idx, v) {
  var u = idx.col.APP_Visit_UUID, d = idx.data, i;
  for (i = 1; i < d.length; i++) if (d[i][u] === v.id) return i + 1;
  var parts = String(v.visit_id).split('__dup'), base = parts[0], nth = parts[1] ? parseInt(parts[1], 10) : 1;
  if (v.sheet_row && d[v.sheet_row - 1] && String(d[v.sheet_row - 1][0]).trim() === base && !d[v.sheet_row - 1][u]) return v.sheet_row;
  var seen = 0;
  for (i = 1; i < d.length; i++) {
    if (String(d[i][0]).trim() === base && !d[i][u]) { seen++; if (seen === nth) return i + 1; }
  }
  return 0;
}

// Reads the sheet once; adds any missing APP_ headers to the right of the old columns.
function sheetIndex_(sheet, baseCols, appHeaders) {
  var lastCol = Math.max(sheet.getLastColumn(), baseCols);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  appHeaders.forEach(function (h) {
    var at = header.indexOf(h);
    if (at === -1) {
      at = Math.max(header.length, baseCols);
      sheet.getRange(1, at + 1).setValue(h).setFontWeight('bold').setBackground('#FFF2CC');
      header[at] = h;
    }
    col[h] = at;
  });
  var width = header.length;
  var data = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, sheet.getLastRow(), width).getValues() : [header];
  return { col: col, width: width, data: data };
}

function writeApp_(sheet, idx, row, app) {
  Object.keys(app).forEach(function (h) {
    var v = app[h];
    sheet.getRange(row, idx.col[h] + 1).setValue(v === null || v === undefined ? '' : v);
    if (idx.data[row - 1]) idx.data[row - 1][idx.col[h]] = v;
  });
}

function padRow_(vals, idx) {
  var out = vals.slice();
  while (out.length < idx.width) out.push('');
  return out;
}

function asDate_(iso) {
  if (!iso) return '';
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : iso;
}

// ---------------------------------------------------------------- weekly backup

function weeklyBackup() {
  var to = CFG.EMAIL;
  try {
    var dump = rpc_('backup_dump', { p_secret: CFG.SYNC_SECRET });
    var folder = backupFolder_();
    var name = 'ENL Backup ' + today_();
    var ss = SpreadsheetApp.create(name);
    writeTable_(ss.getSheets()[0].setName('patients'), dump.patients);
    writeTable_(ss.insertSheet('visits'), dump.visits);
    writeTable_(ss.insertSheet('members'), dump.members);
    moveToFolder_(ss.getId(), folder);
    Drive.Files.create({ name: name + '.json', parents: [folder], mimeType: 'application/json' },
      Utilities.newBlob(JSON.stringify(dump), 'application/json', name + '.json'));
    var removed = pruneBackups_(folder);
    if (to) MailApp.sendEmail(to, 'ENL Thesis backup done: ' + today_(),
      'Backup saved in Google Drive folder "' + CFG.BACKUP_FOLDER + '".\n\n' +
      'Patients: ' + dump.counts.patients + '\nVisits: ' + dump.counts.visits + '\nAudit entries: ' + dump.counts.audit_entries +
      (removed ? '\n\nOld backups removed (keeping the last ' + CFG.KEEP_WEEKLY + ' weeks and one per month): ' + removed : ''));
  } catch (e) {
    if (to) MailApp.sendEmail(to, 'ENL Thesis backup FAILED: ' + today_(), 'The weekly backup did not complete.\n\n' + (e && e.message || e));
    throw e;
  }
}

function backupNow() { weeklyBackup(); }

function writeTable_(sheet, rows) {
  if (!rows || !rows.length) { sheet.getRange(1, 1).setValue('(empty)'); return; }
  var keys = [];
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); }); });
  var out = [keys].concat(rows.map(function (r) {
    return keys.map(function (k) { var v = r[k]; return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); });
  }));
  sheet.getRange(1, 1, out.length, keys.length).setValues(out);
  sheet.setFrozenRows(1);
}

// Keep the newest KEEP_WEEKLY backups plus the first backup of every month; move the rest to Trash.
function pruneBackups_(folder) {
  var files = [], token;
  do {
    var page = Drive.Files.list({ q: "'" + folder + "' in parents and trashed = false", fields: 'nextPageToken, files(id, name)', pageSize: 200, pageToken: token });
    (page.files || []).forEach(function (f) {
      var m = f.name.match(/^ENL Backup (\d{4}-\d{2}-\d{2})(\.json)?$/);
      if (m) files.push({ id: f.id, date: m[1] });
    });
    token = page.nextPageToken;
  } while (token);
  var dates = files.map(function (x) { return x.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort().reverse();
  var keep = {};
  dates.slice(0, CFG.KEEP_WEEKLY).forEach(function (d) { keep[d] = 1; });
  var firstOfMonth = {};
  dates.slice().sort().forEach(function (d) { var mo = d.slice(0, 7); if (!firstOfMonth[mo]) firstOfMonth[mo] = d; });
  Object.keys(firstOfMonth).forEach(function (mo) { keep[firstOfMonth[mo]] = 1; });
  var removed = 0;
  files.forEach(function (x) { if (!keep[x.date]) { Drive.Files.update({ trashed: true }, x.id); removed++; } });
  return removed;
}

// The backup folder is created by this script, so the limited drive.file permission covers it. Returns its ID.
function backupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try { if (!Drive.Files.get(id, { fields: 'trashed' }).trashed) return id; } catch (e) { /* recreate below */ }
  }
  id = Drive.Files.create({ name: CFG.BACKUP_FOLDER, mimeType: 'application/vnd.google-apps.folder' }).id;
  props.setProperty('BACKUP_FOLDER_ID', id);
  return id;
}

// If the move is ever refused, the file simply stays in My Drive; the backup itself is still saved.
function moveToFolder_(fileId, folderId) {
  try {
    var parents = (Drive.Files.get(fileId, { fields: 'parents' }).parents || []).join(',');
    Drive.Files.update({}, fileId, null, { addParents: folderId, removeParents: parents });
  } catch (e) {
    Logger.log('Could not move %s into the backup folder (%s); it is in My Drive instead.', fileId, e && e.message || e);
  }
}

// Copies every tab (values, formulas and formatting) into a new spreadsheet inside the backup folder.
function copySpreadsheet_(src, name) {
  var dest = SpreadsheetApp.create(name);
  var blank = dest.getSheets()[0];
  src.getSheets().forEach(function (sh) { sh.copyTo(dest).setName(sh.getName()); });
  dest.deleteSheet(blank);
  moveToFolder_(dest.getId(), backupFolder_());
  return dest;
}

// ---------------------------------------------------------------- helpers

function rpc_(fn, body) {
  var res = UrlFetchApp.fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: CFG.SUPABASE_KEY }, payload: JSON.stringify(body),
  });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error(fn + ' failed (' + code + '): ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

function today_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); }

// Shows how many changes are waiting, without writing anything.
function status() {
  var items = rpc_('sheet_pull', { p_secret: CFG.SYNC_SECRET, p_limit: 500 });
  Logger.log('%s change(s) waiting to be copied to the sheet.', items.length);
}
