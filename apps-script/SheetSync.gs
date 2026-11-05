/**
 * ENL Thesis Manager: copy-back to the Google Sheet + weekly backup.
 *
 * This is a SEPARATE Apps Script project. It does not change the old Thesis Manager script.
 * Every 10 minutes it (1) copies changes made in the new app into the sheet, then (2) sends rows that were
 * added or changed in the OLD app to the new app. The database cleans them with the same rules as the import,
 * applies only real differences, and puts records changed in both apps on the Review tab instead of overwriting.
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
  APP_URL: 'https://docbala.github.io/enl-thesis-manager',   // photo links in the sheet open here (sign-in needed)
};

var P_COLS = ['cr_no', 'enrollment_date', 'uhid', 'opd_slip_no', 'patient_name', 'age', 'sex', 'relative_name',
  'initial_mdt_months', 'contact_no', 'leprosy_spectrum', 'mdt_status', 'baseline_bi', 'baseline_mi', 'diagnostic_status',
  'height_cm', 'weight_kg', 'bmi', 'address', 'family_history', 'socioeconomic_status', 'followups_completed',
  'b_hb', 'b_nlr', 'b_plr', 'b_agr', 'b_vit_d3', 'b_uric_acid', 'enl_developed', 'next_due_date', 'patient_status',
  'opd_slip_url', 'diagnostic_report_url'];                       // 33 columns = A..AG
var P_DATES = { enrollment_date: 1, next_due_date: 1 };
var P_APP = ['APP_Patient_UUID', 'APP_MDT_Start_Date', 'APP_MDT_Start_Confirmed', 'APP_Synced_At', 'APP_Followups_Completed', 'APP_Profile_Photo'];
var P_KEEP_SHEET_VALUE = 21;   // Followups_Completed (column V) is a date-typed column in the sheet's table: never written

var V_COLS = ['visit_id', 'cr_no', 'visit_type', 'visit_date', 'hb', 'tlc', 'granulocyte_pct', 'lymphocyte_pct', 'platelets',
  'nlr', 'plr', 'total_protein', 'albumin', 'globulin', 'agr', 'vit_d3', 'vit_b12', 'uric_acid', 'creatinine', 'sgot', 'sgpt',
  'alp', 'esr', 'crp', 'enl_reaction', 'ess_score', 'clinical_notes', 'report_url', 'urea', 'hba1c'];   // 30 columns = A..AD
var V_DATES = { visit_date: 1 };
var V_APP = ['APP_Visit_UUID', 'APP_Unscheduled', 'APP_Prednisolone_mg', 'APP_Weight_kg', 'APP_Synced_At', 'APP_Deleted', 'APP_ESS_Items', 'APP_ESS_Band', 'APP_Lesion_Photos'];

// New data from the app gets its own tabs (the old app never reads them). Column: [header, field].
var ESS_KEYS = ['pain', 'fever', 'lesion_number', 'lesion_inflammation', 'lesion_extent', 'peripheral_oedema', 'bone_pain',
  'joint_inflammation', 'lymphadenopathy', 'nerve_tenderness'];
var APP_TABS = {
  enl_episodes: { tab: 'APP_ENL_Episodes', cols: [['ID', 'id'], ['CR_No', 'cr_no'], ['Onset_Date', 'onset_date'], ['End_Date', 'end_date'],
    ['Suggested_Type', 'suggested_type'], ['Days', 'days'], ['Trigger', 'trigger_cause'], ['Notes', 'notes']] },
  drug_doses: { tab: 'APP_Drug_Doses', cols: [['ID', 'id'], ['CR_No', 'cr_no'], ['Drug', 'drug'], ['From_Date', 'start_date'],
    ['mg_per_day', 'mg_per_day'], ['Recorded_At_Visit', 'source_visit'], ['Note', 'note']] },
  ess_assessments: { tab: 'APP_ESS_Items', cols: [['ID', 'id'], ['CR_No', 'cr_no'], ['Visit_ID', 'visit_code'], ['Visit_Date', 'visit_date']]
    .concat(ESS_KEYS.map(function (k) { return ['ESS_' + k, k]; }))
    .concat([['ESS_Total', 'total'], ['Items_Scored', 'items_scored'], ['Scale', 'scale_version']]) },
};
var APP_TAB_DATES = { onset_date: 1, end_date: 1, start_date: 1, visit_date: 1 };

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
    if (['syncNow', 'weeklyBackup', 'fridayDigest'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
  ScriptApp.newTrigger('fridayDigest').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).create();
  // 4. Run both once now
  var n = syncNow();
  weeklyBackup();
  Logger.log('Setup done. Copied %s change(s) to the sheet. Backup saved in Drive folder "%s".', n, CFG.BACKUP_FOLDER);
}

// ---------------------------------------------------------------- copy-back

function syncNow() {
  ensureDigestTrigger_();
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
          if (APP_TABS[it.table]) writeAppTab_(ss, it.table, it.record_id, it.row);      // row is null when deleted in the app
          else if (!it.row) { rpc_('sheet_ack', { p_secret: CFG.SYNC_SECRET, p_ids: it.queue_ids }); continue; }
          else if (it.table === 'patients') writePatient_(pSheet, pIdx, it.row);
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
    pullFromSheet_(pSheet, 'patients', P_COLS.length, 'APP_Patient_UUID');
    pullFromSheet_(vSheet, 'visits', V_COLS.length, 'APP_Visit_UUID');
  } finally {
    lock.releaseLock();
  }
  return done;
}

// ---------------------------------------------------------------- old app -> new app

// Sends rows that are new or changed since the last run. The first run sends every row; the database
// ignores rows that already match, so nothing it corrected during the import is undone.
function pullFromSheet_(sheet, kind, baseCols, uuidHeader) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var width = Math.max(sheet.getLastColumn(), baseCols);
  var all = sheet.getRange(1, 1, lastRow, width).getValues();
  var header = all[0].map(String);
  var uCol = header.indexOf(uuidHeader);
  var rows = readRows_(all, header, baseCols, uCol, kind);
  var snap = loadSnap_(kind), next = {}, send = [];
  rows.forEach(function (r) {
    next[r.key] = r.hash;
    if (snap[r.key] !== r.hash) send.push(r);
  });
  var failed = {}, summary = { inserted: 0, updated: 0, conflicts: 0, unchanged: 0, errors: [] };
  for (var i = 0; i < send.length; i += 100) {
    var chunk = send.slice(i, i + 100).map(function (r) { return { row: r.row, nth: r.nth, uuid: r.uuid, values: r.values }; });
    var res = rpc_('sheet_push', { p_secret: CFG.SYNC_SECRET, p_kind: kind, p_rows: chunk });
    ['inserted', 'updated', 'conflicts', 'unchanged'].forEach(function (k) { summary[k] += res[k] || 0; });
    (res.errors || []).forEach(function (e) { failed[String(e.row)] = 1; summary.errors.push(e); });
  }
  // rows that failed are retried next time; rows that left the sheet are flagged for review (never deleted)
  var failedKeys = failedKeys_(rows, failed);
  rows.forEach(function (r) { if (failed[String(r.row)]) delete next[r.key]; });
  var gone = Object.keys(snap).filter(function (k) { return !(k in next) && !(k in failedKeys); });
  if (Object.keys(snap).length && rows.length < Object.keys(snap).length * 0.5) {
    Logger.log('%s: sheet returned far fewer rows than last time (%s vs %s); not reporting removals this run.', kind, rows.length, Object.keys(snap).length);
    gone = [];
  }
  if (gone.length) {
    rpc_('sheet_removed', { p_secret: CFG.SYNC_SECRET, p_kind: kind, p_keys: gone.map(function (k) {
      var m = k.split('#'); return { key: m[0], nth: Number(m[1] || 1), uuid: null };
    }) });
  }
  saveSnap_(kind, next);
  if (send.length) Logger.log('%s from old app: %s', kind, JSON.stringify(summary));
}

function failedKeys_(rows, failed) {
  var out = {};
  rows.forEach(function (r) { if (failed[String(r.row)]) out[r.key] = 1; });
  return out;
}

// One entry per filled row: values keyed by the sheet's own header names (old columns only).
function readRows_(all, header, baseCols, uCol, kind) {
  var out = [], seen = {};
  for (var i = 1; i < all.length; i++) {
    var raw = all[i].slice(0, baseCols);
    if (raw.every(function (x) { return x === '' || x === null; })) continue;
    var values = {};
    for (var c = 0; c < baseCols; c++) {
      var x = raw[c];
      if (x instanceof Date) x = Utilities.formatDate(x, 'Asia/Kolkata', 'yyyy-MM-dd');
      values[header[c]] = x === '' ? null : x;
    }
    var id = String(raw[0]).trim();
    if (!id) continue;
    seen[id] = (seen[id] || 0) + 1;
    var nth = seen[id];
    var key = kind === 'patients' ? id : id + '#' + nth;
    var json = JSON.stringify(values);
    var hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, json));
    out.push({ row: i + 1, nth: nth, key: key, hash: hash, values: values, uuid: uCol >= 0 && all[i][uCol] ? String(all[i][uCol]) : null });
  }
  return out;
}

// Row fingerprints are kept in this script's properties, split into small chunks.
function loadSnap_(kind) {
  var props = PropertiesService.getScriptProperties(), n = Number(props.getProperty('SNAP_' + kind + '_N') || 0), map = {};
  for (var i = 0; i < n; i++) {
    var part = props.getProperty('SNAP_' + kind + '_' + i);
    if (part) { var o = JSON.parse(part); for (var k in o) map[k] = o[k]; }
  }
  return map;
}

function saveSnap_(kind, map) {
  var props = PropertiesService.getScriptProperties(), keys = Object.keys(map), old = Number(props.getProperty('SNAP_' + kind + '_N') || 0);
  var parts = {}, n = 0;
  for (var i = 0; i < keys.length; i += 100) {
    var o = {};
    keys.slice(i, i + 100).forEach(function (k) { o[k] = map[k]; });
    parts['SNAP_' + kind + '_' + n] = JSON.stringify(o); n++;
  }
  parts['SNAP_' + kind + '_N'] = String(n);
  props.setProperties(parts);
  for (var j = n; j < old; j++) props.deleteProperty('SNAP_' + kind + '_' + j);
}

// Run by hand to send old-app changes right away.
function pullNow() { syncNow(); }

function writePatient_(sheet, idx, p) {
  var row = findPatientRow_(idx, p);
  var vals = toPatientRow(p);
  var app = { APP_Patient_UUID: p.id, APP_MDT_Start_Date: asDate_(p.mdt_start_date),
    APP_MDT_Start_Confirmed: p.mdt_start_estimated ? 'N' : 'Y', APP_Synced_At: new Date(),
    APP_Followups_Completed: p.followups_completed === null || p.followups_completed === undefined ? '' : p.followups_completed,
    APP_Profile_Photo: p.profile_photo_id ? photoLink_(p.profile_photo_id) : '' };
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
    APP_Weight_kg: v.weight_kg, APP_Synced_At: new Date(), APP_Deleted: v.deleted_at ? 'Deleted in app' : '',
    APP_ESS_Items: v.ess_items ? ESS_KEYS.map(function (k) { var x = v.ess_items[k]; return x === null || x === undefined ? '-' : x; }).join(',') : '',
    APP_ESS_Band: v.ess_items ? (v.ess_items.total >= 9 ? 'Moderate-severe (>=9)' : 'Mild (<9)') : '',
    // one line per lesion photo: "Body site: link"
    APP_Lesion_Photos: (v.lesion_photos || []).map(function (x) { return (x.body_site || 'Lesion') + ': ' + photoLink_(x.id); }).join('\n') };
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

function writeAppTab_(ss, table, recordId, row) {
  var def = APP_TABS[table];
  var sh = ss.getSheetByName(def.tab);
  var header = def.cols.map(function (c) { return c[0]; }).concat(['Synced_At']);
  if (!sh) {
    sh = ss.insertSheet(def.tab);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#FFF2CC');
    sh.setFrozenRows(1);
  }
  var last = sh.getLastRow();
  var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var at = ids.indexOf(String(recordId));
  if (!row) { if (at >= 0) sh.deleteRow(at + 2); return; }                   // removed in the app
  var vals = def.cols.map(function (c) {
    var x = row[c[1]];
    if (APP_TAB_DATES[c[1]]) return asDate_(x);
    return x === null || x === undefined ? '' : x;
  }).concat([new Date()]);
  if (at >= 0) sh.getRange(at + 2, 1, 1, vals.length).setValues([vals]);
  else sh.appendRow(vals);
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

// ---------------------------------------------------------------- Friday reminder email

// Adds the Friday trigger once for setups made before it existed (no need to run setup again).
function ensureDigestTrigger_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DIGEST_TRIGGER')) return;
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'fridayDigest'; });
  if (!has) ScriptApp.newTrigger('fridayDigest').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).create();
  props.setProperty('DIGEST_TRIGGER', '1');
}

function hindiReminder_(name, isoDate) {
  var p = isoDate.split('-'), d = p[2] + '/' + p[1] + '/' + p[0];
  return 'नमस्ते ' + name + ' जी,\nयह एम.वाई. अस्पताल (M.Y. Hospital), इंदौर के त्वचा रोग विभाग से सूचना है। आपकी नियमित स्वास्थ्य एवं खून की जाँच का समय हो गया है।\n' +
    'फॉलो अप तिथि: ' + d + '\nसमय: सुबह 9:00 बजे, Dermatology OPD.\nपुरानी पर्ची एवं जाँच रिपोर्ट साथ लाएँ।';
}

// Friday 6 pm: email the list of patients due this Saturday, with one-tap WhatsApp links (Hindi message filled in).
function fridayDigest() {
  var res = rpc_('reminder_digest', { p_secret: CFG.SYNC_SECRET });
  var items = res.items || [], sat = res.saturday;
  if (!CFG.EMAIL) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var rows = items.map(function (it) {
    var ph = String(it.phone || '').replace(/\D/g, '').slice(-10);
    var wa = ph ? '<a href="https://wa.me/91' + ph + '?text=' + encodeURIComponent(hindiReminder_(it.name, sat)) + '">WhatsApp</a>' : 'no phone';
    var call = ph ? ' · <a href="tel:' + ph + '">' + ph + '</a>' : '';
    return '<tr><td style="padding:6px 10px"><b>' + esc(it.cr_no) + '</b></td><td style="padding:6px 10px">' + esc(it.name) + '</td>' +
      '<td style="padding:6px 10px">Month ' + it.month + '</td><td style="padding:6px 10px">' + wa + call + (it.reminded ? ' ✓ reminded' : '') + '</td></tr>';
  }).join('');
  var html = '<p>Follow-up patients for <b>Saturday ' + sat + '</b>: ' + items.length + '</p>' +
    (items.length ? '<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">' + rows + '</table>' : '<p>No follow-up month is open this Saturday.</p>') +
    '<p style="color:#666;font-size:12px">Tap WhatsApp to open the Hindi reminder for that patient. Sent by the ENL Sheet Sync script.</p>';
  MailApp.sendEmail({ to: CFG.EMAIL, subject: 'Saturday follow-up list (' + items.length + '): ' + sat, htmlBody: html,
    body: items.map(function (it) { return it.cr_no + '  ' + it.name + '  Month ' + it.month + '  ' + (it.phone || ''); }).join('\n') || 'No follow-ups this Saturday.' });
}

function photoLink_(id) { return CFG.APP_URL + '/photo/' + id; }

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
    var photos = '';
    try { photos = backupPhotos_(folder); } catch (pe) { photos = 'Photo copy FAILED: ' + (pe && pe.message || pe) + ' (it will retry next week)'; }
    if (to) MailApp.sendEmail(to, 'ENL Thesis backup done: ' + today_(),
      'Backup saved in Google Drive folder "' + CFG.BACKUP_FOLDER + '".\n\n' +
      'Patients: ' + dump.counts.patients + '\nVisits: ' + dump.counts.visits + '\nAudit entries: ' + dump.counts.audit_entries +
      (photos ? '\n\n' + photos : '') +
      (removed ? '\n\nOld backups removed (keeping the last ' + CFG.KEEP_WEEKLY + ' weeks and one per month): ' + removed : ''));
  } catch (e) {
    if (to) MailApp.sendEmail(to, 'ENL Thesis backup FAILED: ' + today_(), 'The weekly backup did not complete.\n\n' + (e && e.message || e));
    throw e;
  }
}

function backupNow() { weeklyBackup(); }

// Copies photos and scans added since the last run into "<backup folder>/Photos/<CR No>/".
// Picks up where it stopped if a run ends early (Apps Script allows about 6 minutes).
function backupPhotos_(root) {
  var props = PropertiesService.getScriptProperties();
  var since = props.getProperty('PHOTO_BACKUP_SINCE') || '1970-01-01';
  var folders = JSON.parse(props.getProperty('PHOTO_FOLDERS') || '{}');
  var photosRoot = folders.__root || (folders.__root = childFolder_(root, 'Photos'));
  var start = Date.now(), copied = 0, more = true, stopped = false;
  while (more && Date.now() - start < 4 * 60 * 1000) {
    var res = JSON.parse(UrlFetchApp.fetch(CFG.SUPABASE_URL + '/functions/v1/photo-backup', {
      method: 'post', contentType: 'application/json', headers: { apikey: CFG.SUPABASE_KEY },
      payload: JSON.stringify({ secret: CFG.SYNC_SECRET, since: since }), muteHttpExceptions: true }).getContentText());
    if (res.error) throw new Error(res.error);
    (res.items || []).forEach(function (it) {
      if (stopped || Date.now() - start > 5 * 60 * 1000) { stopped = true; return; }
      var cr = it.cr_no || 'unknown';
      var dir = folders[cr] || (folders[cr] = childFolder_(photosRoot, cr));
      var blob = UrlFetchApp.fetch(it.url).getBlob();
      var ext = it.mime_type === 'application/pdf' ? 'pdf' : 'jpg';
      var name = [cr, String(it.taken_at).slice(0, 10), it.kind, it.body_site || '', it.id.slice(0, 8)].filter(String).join('_').replace(/[\/\s]+/g, '-') + '.' + ext;
      Drive.Files.create({ name: name, parents: [dir], mimeType: it.mime_type }, blob.setName(name));
      since = it.created_at; copied++;
      props.setProperty('PHOTO_BACKUP_SINCE', since);
    });
    more = !!res.more || stopped;
    if (stopped) break;
  }
  props.setProperty('PHOTO_FOLDERS', JSON.stringify(folders));
  return copied ? 'Photos and scans copied: ' + copied + (more ? ' (more left; they continue next run)' : '') : 'No new photos this week.';
}

function childFolder_(parent, name) {
  var q = "'" + parent + "' in parents and name = '" + name.replace(/'/g, "\\'") + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  var f = (Drive.Files.list({ q: q, fields: 'files(id)' }).files || [])[0];
  return f ? f.id : Drive.Files.create({ name: name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }).id;
}

// Run by hand to copy photos now without the full backup.
function backupPhotosNow() { Logger.log(backupPhotos_(backupFolder_())); }

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
