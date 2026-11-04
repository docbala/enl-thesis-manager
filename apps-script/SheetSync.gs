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
 * One-time setup: paste this file into a new project at script.google.com, then run setup() once.
 */

var CFG = {
  SUPABASE_URL: 'https://pmqzhjzpututodtzovut.supabase.co',
  SUPABASE_KEY: 'sb_publishable_WNYWciJUVPMb8aK9lXPQfQ_bUJJBcoX',
  SYNC_SECRET: '__SYNC_SECRET__',
  SHEET_ID: '1tMhgrwS45rbdQ69YjXoz7UBEF5z6-qZsTiUAiGqRJyM',
  BACKUP_FOLDER: 'ENL Thesis Backups',
  KEEP_WEEKLY: 12,
};

var P_COLS = ['cr_no', 'enrollment_date', 'uhid', 'opd_slip_no', 'patient_name', 'age', 'sex', 'relative_name',
  'initial_mdt_months', 'contact_no', 'leprosy_spectrum', 'mdt_status', 'baseline_bi', 'baseline_mi', 'diagnostic_status',
  'height_cm', 'weight_kg', 'bmi', 'address', 'family_history', 'socioeconomic_status', 'followups_completed',
  'b_hb', 'b_nlr', 'b_plr', 'b_agr', 'b_vit_d3', 'b_uric_acid', 'enl_developed', 'next_due_date', 'patient_status',
  'opd_slip_url', 'diagnostic_report_url'];                       // 33 columns = A..AG
var P_DATES = { enrollment_date: 1, next_due_date: 1 };
var P_APP = ['APP_Patient_UUID', 'APP_MDT_Start_Date', 'APP_MDT_Start_Confirmed', 'APP_Synced_At'];

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
    var copy = DriveApp.getFileById(CFG.SHEET_ID).makeCopy('HD_ENL_Thesis_Master (copy before app sync ' + today_() + ')', backupFolder_());
    props.setProperty('SAFETY_COPY_ID', copy.getId());
  }
  // 2. Triggers: copy-back every 10 minutes, backup every Sunday night
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['syncNow', 'weeklyBackup'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
  // 3. Run both once now
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
    APP_MDT_Start_Confirmed: p.mdt_start_estimated ? 'N' : 'Y', APP_Synced_At: new Date() };
  if (row) {
    sheet.getRange(row, 1, 1, vals.length).setValues([vals]);
    sheet.getRange(row, 22).setNumberFormat('0');           // Followups_Completed is a count, not a date
  } else {
    sheet.appendRow(padRow_(vals, idx));
    row = sheet.getLastRow();
    sheet.getRange(row, 22).setNumberFormat('0');
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
  var to = Session.getEffectiveUser().getEmail();
  try {
    var dump = rpc_('backup_dump', { p_secret: CFG.SYNC_SECRET });
    var folder = backupFolder_();
    var name = 'ENL Backup ' + today_();
    var ss = SpreadsheetApp.create(name);
    writeTable_(ss.getSheets()[0].setName('patients'), dump.patients);
    writeTable_(ss.insertSheet('visits'), dump.visits);
    writeTable_(ss.insertSheet('members'), dump.members);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    folder.createFile(name + '.json', JSON.stringify(dump), 'application/json');
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
  var files = [], it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next(), m = f.getName().match(/^ENL Backup (\d{4}-\d{2}-\d{2})(\.json)?$/);
    if (m) files.push({ f: f, date: m[1], json: !!m[2] });
  }
  var dates = files.map(function (x) { return x.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort().reverse();
  var keep = {};
  dates.slice(0, CFG.KEEP_WEEKLY).forEach(function (d) { keep[d] = 1; });
  var firstOfMonth = {};
  dates.slice().sort().forEach(function (d) { var mo = d.slice(0, 7); if (!firstOfMonth[mo]) firstOfMonth[mo] = d; });
  Object.keys(firstOfMonth).forEach(function (mo) { keep[firstOfMonth[mo]] = 1; });
  var removed = 0;
  files.forEach(function (x) { if (!keep[x.date]) { x.f.setTrashed(true); removed++; } });
  return removed;
}

function backupFolder_() {
  var it = DriveApp.getFoldersByName(CFG.BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CFG.BACKUP_FOLDER);
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
