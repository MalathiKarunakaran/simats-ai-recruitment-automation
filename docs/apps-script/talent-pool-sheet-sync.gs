/**
 * SIMATS talent pool sheet sync -- a Google Apps Script project of its own
 * (script.new), reading the recruitment sheet "SIMATS Recruitment_New
 * 15-04-2025" by its ID.
 *
 * Does what docs/n8n/talent-pool-sheet-sync.workflow.json does, without n8n
 * or a Google Cloud project (saveetha.com has Google Cloud switched off):
 * every 15 minutes it posts the "Final " and "NTS" tabs, whole, to
 * POST https://api.malathi.io/api/v1/talent-pool/sync. The app works out
 * what changed (app/services/talent_pool_sync.py); this only reshapes the
 * grid.
 *
 * Kept OUT of the sheet's own Apps Script project on purpose: that project
 * already holds other people's scripts (setSelectedStatusBatch), and a
 * separate project can neither overwrite nor be broken by them.
 *
 * Setup (docs/apps-script/README.md):
 *   1. script.new (signed in as the sheet's owner), paste this file, save.
 *   2. Project Settings -> Script properties -> add
 *      TALENT_POOL_SYNC_SECRET = the value of that line in the server's .env.
 *   3. Run syncTalentPool once (authorise when asked) and read the log.
 *   4. Run installTrigger once. From then on it runs every 15 minutes.
 */

var SHEET_ID = "1z8clcWd3oMs_Ipm8UPpxzgz9ZyEdhinw5i7xdQ8Ek24"; // SIMATS Recruitment_New 15-04-2025
var SYNC_URL = "https://api.malathi.io/api/v1/talent-pool/sync";
var TABS = [
  { name: "Final ", sourceTab: "TEACHING_FINAL" }, // the tab name has a trailing space
  { name: "NTS", sourceTab: "NTS" },
];

// Same reshaping as the n8n workflow's Code nodes.
function buildSnapshot(values, tab) {
  var isFinal = tab === "TEACHING_FINAL";
  var headerIndex = isFinal ? 1 : 0; // Final: row 2 is the header (row 1 is "Last Date Update")
  var headers = (values[headerIndex] || []).map(function (h) { return h == null ? "" : String(h); });
  var width = headers.length;
  var rows = [];
  for (var i = headerIndex + 1; i < values.length; i++) {
    var raw = values[i] || [];
    // The grid runs on past the last candidate; a row with nothing in it is not sent.
    var empty = raw.every(function (c) { return String(c == null ? "" : c).trim() === ""; });
    if (empty) continue;
    var cells = [];
    for (var j = 0; j < width; j++) cells.push(raw[j] == null ? "" : String(raw[j]));
    rows.push({ row_number: i + 1, cells: cells });
  }
  var sheetLastUpdate = null;
  if (isFinal) {
    var first = values[0] || [];
    var parts = [first[2], first[3]]
      .map(function (v) { return String(v == null ? "" : v).trim(); })
      .filter(function (v) { return v; });
    sheetLastUpdate = parts.length ? parts.join(", ") : null;
  }
  return { source_tab: tab, sheet_last_update: sheetLastUpdate, headers: headers, rows: rows };
}

// The secret as saved, without the spaces or line breaks a paste can carry.
function readSecret() {
  return (PropertiesService.getScriptProperties().getProperty("TALENT_POOL_SYNC_SECRET") || "").trim();
}

function syncTalentPool() {
  var secret = readSecret();
  if (!secret) throw new Error("Set the TALENT_POOL_SYNC_SECRET script property first (Project Settings).");
  var spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  var failures = [];

  TABS.forEach(function (tab) {
    var sheet = spreadsheet.getSheetByName(tab.name);
    if (!sheet) {
      failures.push('No tab named "' + tab.name + '"');
      return;
    }
    // Display values: dates and numbers exactly as the sheet shows them.
    var snapshot = buildSnapshot(sheet.getDataRange().getDisplayValues(), tab.sourceTab);
    var response = UrlFetchApp.fetch(SYNC_URL, {
      method: "post",
      contentType: "application/json",
      headers: { "X-Talent-Pool-Sync-Secret": secret },
      payload: JSON.stringify(snapshot),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    if (code !== 200) {
      failures.push(tab.sourceTab + ": HTTP " + code + " " + body.slice(0, 300));
      return;
    }
    var result = JSON.parse(body);
    console.log(
      tab.sourceTab + " synced: " + JSON.stringify(result.counts) +
        (result.unmapped_departments.length ? " | unmapped departments: " + result.unmapped_departments.join(", ") : "") +
        (result.missing_headers.length ? " | missing headers: " + result.missing_headers.join(", ") : "")
    );
  });

  // Throwing marks the run as failed, so a scheduled run that fails is
  // emailed to the script's owner instead of failing silently.
  if (failures.length) throw new Error("Talent pool sync failed -- " + failures.join(" ; "));
}

// Run once: replaces any earlier schedule with one every 15 minutes that
// syncs all four tabs (syncAll). Re-run it after updating this script.
function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger("syncAll").timeBased().everyMinutes(15).create();
  console.log("Scheduled: syncAll every 15 minutes.");
}

// Run to stop the schedule.
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var name = trigger.getHandlerFunction();
    if (name === "syncTalentPool" || name === "syncAll") ScriptApp.deleteTrigger(trigger);
  });
  console.log("Schedule removed.");
}

// What the schedule runs: the talent pool (Final, NTS), then New Joinees and
// Pro App Order. One failing does not stop the others; the run still fails
// at the end, so Google emails the owner.
function syncAll() {
  var errors = [];
  [syncTalentPool, syncJoineeSheets].forEach(function (fn) {
    try {
      fn();
    } catch (err) {
      errors.push(String(err && err.message ? err.message : err));
    }
  });
  if (errors.length) throw new Error(errors.join(" || "));
}

// Run to compare the saved secret with the server's without showing it:
// on the server, the same two figures come from
//   f=$(grep "^TALENT_POOL_SYNC_SECRET=" /opt/simats/app/.env | cut -d= -f2)
//   echo ${#f} $(printf %s "$f" | sha256sum | cut -c1-12)
function checkSecret() {
  var secret = readSecret();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret, Utilities.Charset.UTF_8);
  var hex = digest.map(function (b) { return ("0" + ((b + 256) % 256).toString(16)).slice(-2); }).join("");
  console.log("Saved secret: length " + secret.length + ", fingerprint " + hex.slice(0, 12));
}


// ---------------------------------------------------------------------------
// New Joinees + Pro App Order (docs/specs/joinee-order-sync.md, added
// 2026-10-31). Spreadsheet "NEW JOINEE LIST FROM JULY 01-07-2024".
//
// PRIVACY: New Joinees holds salary, bank and other personal columns that
// must never leave Google. This code reads the header row, picks the
// allowlisted columns BY NAME, and then reads only those columns, one by
// one. Every other column -- including any added to the sheet later -- is
// never read, so it cannot be sent, logged or stored anywhere.
// ---------------------------------------------------------------------------

var JOINEE_SHEET_ID = "1uYmjS-Wu4OlflinrGCmftDr_nXP01eVItCqqXfXi7pU";
var SHEET_SYNC_URL = "https://api.malathi.io/api/v1/sheet-sync/";

var JOINEE_TABS = [
  {
    source: "NEW_JOINEES",
    tab: "New Joinees",
    headerRow: 2, // row 1 holds a stray value, not headers
    columns: [
      "BIO ID", "New BIoID", "Staff ID", "App No", "Name", "Employee Type", "College", "Status",
      "Joined On", "Interview Date", "Provisional Appointment Order Given Date", "Designation",
      "Department", "Dept New", "Reporting to...", "Relieving Order Submitted", "Original Submitted",
      "Appointment Order", "send date", "Received date", "Mobile No.",
    ],
  },
  {
    source: "PRO_APP_ORDER",
    tab: "Pro App Order",
    headerRow: 1,
    columns: [
      "Order Date", "BioID", "EMPID", "Name", "Provision Order", "Probation Period", "ID Card", "Food App",
      "Arms", "360 App", "File Submitted to ADFA", "Room Allotted", "After Probation Received AO",
    ],
  },
];

// Case, spaces and punctuation do not matter ("send date " = "send date").
function headerKey_(text) {
  return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Reads only the allowlisted columns of one tab.
function readAllowlisted_(sheet, headerRow, columns) {
  var lastColumn = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  var headerCells = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0];
  var wanted = {};
  columns.forEach(function (name) { wanted[headerKey_(name)] = true; });

  var picked = []; // {index, header}
  headerCells.forEach(function (header, i) {
    var key = headerKey_(header);
    if (wanted[key] && !picked.some(function (p) { return headerKey_(p.header) === key; })) {
      picked.push({ index: i, header: String(header).trim() });
    }
  });

  var bodyRows = Math.max(lastRow - headerRow, 0);
  var columnsData = picked.map(function (p) {
    return bodyRows ? sheet.getRange(headerRow + 1, p.index + 1, bodyRows, 1).getDisplayValues() : [];
  });

  var rows = [];
  for (var r = 0; r < bodyRows; r++) {
    var cells = columnsData.map(function (col) { return col[r][0]; });
    if (cells.every(function (c) { return String(c).trim() === ""; })) continue;
    rows.push({ row_number: headerRow + 1 + r, cells: cells });
  }
  return { headers: picked.map(function (p) { return p.header; }), rows: rows };
}

function postSheetSync_(source, snapshot, dryRun, secret) {
  var body = { headers: snapshot.headers, rows: snapshot.rows, dry_run: !!dryRun };
  var response = UrlFetchApp.fetch(SHEET_SYNC_URL + source, {
    method: "post",
    contentType: "application/json",
    headers: { "X-Talent-Pool-Sync-Secret": secret },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  return { code: response.getResponseCode(), body: response.getContentText() };
}

function runJoineeSheets_(dryRun) {
  var secret = readSecret();
  if (!secret) throw new Error("Set the TALENT_POOL_SYNC_SECRET script property first (Project Settings).");
  var spreadsheet = SpreadsheetApp.openById(JOINEE_SHEET_ID);
  var failures = [];
  JOINEE_TABS.forEach(function (t) {
    var sheet = spreadsheet.getSheetByName(t.tab);
    if (!sheet) {
      failures.push('No tab named "' + t.tab + '"');
      return;
    }
    var result = postSheetSync_(t.source, readAllowlisted_(sheet, t.headerRow, t.columns), dryRun, secret);
    if (result.code !== 200) {
      failures.push(t.source + ": HTTP " + result.code + " " + result.body.slice(0, 300));
      return;
    }
    var parsed = JSON.parse(result.body);
    console.log(
      (dryRun ? "[DRY RUN] " : "") + t.source + ": " + JSON.stringify(parsed.counts) +
        (parsed.missing_headers.length ? " | missing headers: " + parsed.missing_headers.join(", ") : "")
    );
  });
  if (failures.length) throw new Error("Joinee sheet sync failed -- " + failures.join(" ; "));
}

// Syncs New Joinees and Pro App Order (also run by syncAll on the schedule).
function syncJoineeSheets() {
  runJoineeSheets_(false);
}

// Shows what a sync WOULD do -- counts and flagged rows -- and changes
// nothing. The preview also appears on the app's Data Sync Status page.
function previewJoineeSheets() {
  runJoineeSheets_(true);
}
