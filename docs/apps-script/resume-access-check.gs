// One-off check: how many Selected candidates' resume links can this Google
// account open, and what kind of file are they? Run it in its OWN Apps Script
// project, so the Drive permission it asks for never touches the 15-minute sync.
//
// It logs counts only: no names, links or file contents. It opens no file's
// contents, changes nothing and sends nothing anywhere.

var CHECK_SHEET_ID = "1z8clcWd3oMs_Ipm8UPpxzgz9ZyEdhinw5i7xdQ8Ek24"; // SIMATS Recruitment_New 15-04-2025
var CHECK_TAB = "Final "; // the tab name has a trailing space
var CHECK_LIMIT_MS = 5 * 60 * 1000; // Apps Script stops a run at 6 minutes

function checkResumeAccess() {
  var started = Date.now();
  var values = SpreadsheetApp.openById(CHECK_SHEET_ID).getSheetByName(CHECK_TAB).getDataRange().getValues();
  var headers = values[1].map(function (h) { return String(h).trim(); }); // row 2 is the header
  var statusAt = headers.indexOf("Status");
  var linkAt = headers.indexOf("Google Link");
  if (statusAt < 0 || linkAt < 0) throw new Error("Status or Google Link column not found");

  var counts = { selected: 0, noLink: 0, noFileId: 0, cannotOpen: 0, canOpen: 0, notChecked: 0 };
  var kinds = {};
  for (var i = 2; i < values.length; i++) {
    if (String(values[i][statusAt]).trim() !== "Selected") continue;
    counts.selected++;
    var link = String(values[i][linkAt]).trim();
    if (!link) { counts.noLink++; continue; }
    var match = link.match(/[?&]id=([\w-]+)/) || link.match(/\/d\/([\w-]+)/);
    if (!match) { counts.noFileId++; continue; }
    if (Date.now() - started > CHECK_LIMIT_MS) { counts.notChecked++; continue; }
    try {
      var kind = DriveApp.getFileById(match[1]).getMimeType();
      kinds[kind] = (kinds[kind] || 0) + 1;
      counts.canOpen++;
    } catch (e) {
      counts.cannotOpen++;
    }
  }
  Logger.log(JSON.stringify(counts));
  Logger.log(JSON.stringify(kinds));
}
