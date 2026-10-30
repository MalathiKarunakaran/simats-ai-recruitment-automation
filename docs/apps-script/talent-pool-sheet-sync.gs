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

// Run once: replaces any earlier schedule with one every 15 minutes.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "syncTalentPool") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("syncTalentPool").timeBased().everyMinutes(15).create();
  console.log("Scheduled: syncTalentPool every 15 minutes.");
}

// Run to stop the schedule.
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "syncTalentPool") ScriptApp.deleteTrigger(trigger);
  });
  console.log("Schedule removed.");
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
