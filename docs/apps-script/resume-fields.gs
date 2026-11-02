// Reads gender and home state/country from the resumes of the Final sheet's
// Selected candidates, for the Talent Pool's Selected breakdown charts. Run it in
// its OWN Apps Script project, so the Drive access never touches the 15-minute sync.
// Needs Services -> Drive API switched on.
//
// A resume's text never leaves Google: only the values below are sent to the app.
// Only what the resume states is taken. Gender is never worked out from a name.
//
//   previewResumeFields  tests 40 resumes, logs counts only, sends nothing
//   sendResumeFields     reads all of them, in batches, then stops by itself

var RF_SHEET_ID = "1z8clcWd3oMs_Ipm8UPpxzgz9ZyEdhinw5i7xdQ8Ek24"; // SIMATS Recruitment_New 15-04-2025
var RF_TAB = "Final "; // the tab name has a trailing space
var RF_URL = "https://api.malathi.io/api/v1/talent-pool/resume-fields";
var RF_PREVIEW_SIZE = 40;
var RF_RUN_LIMIT_MS = 4.5 * 60 * 1000; // Apps Script stops a run at 6 minutes

var RF_STATES = [
  [/\btamil\s*nadu\b/i, "Tamil Nadu"], [/\bkerala\b/i, "Kerala"], [/\bkarnataka\b/i, "Karnataka"],
  [/\bandhra\s*pradesh\b/i, "Andhra Pradesh"], [/\btelangana\b/i, "Telangana"], [/\bmaharashtra\b/i, "Maharashtra"],
  [/\bgoa\b/i, "Goa"], [/\bgujarat\b/i, "Gujarat"], [/\brajasthan\b/i, "Rajasthan"], [/\bpunjab\b/i, "Punjab"],
  [/\bharyana\b/i, "Haryana"], [/\bhimachal\s*pradesh\b/i, "Himachal Pradesh"], [/\buttarakhand\b/i, "Uttarakhand"],
  [/\buttar\s*pradesh\b/i, "Uttar Pradesh"], [/\bmadhya\s*pradesh\b/i, "Madhya Pradesh"],
  [/\bchhattisgarh\b/i, "Chhattisgarh"], [/\bbihar\b/i, "Bihar"], [/\bjharkhand\b/i, "Jharkhand"],
  [/\bodisha\b|\borissa\b/i, "Odisha"], [/\bwest\s*bengal\b/i, "West Bengal"], [/\bassam\b/i, "Assam"],
  [/\bsikkim\b/i, "Sikkim"], [/\bmanipur\b/i, "Manipur"], [/\bmeghalaya\b/i, "Meghalaya"], [/\bmizoram\b/i, "Mizoram"],
  [/\bnagaland\b/i, "Nagaland"], [/\btripura\b/i, "Tripura"], [/\barunachal\s*pradesh\b/i, "Arunachal Pradesh"],
  [/\bjammu\b|\bkashmir\b/i, "Jammu and Kashmir"], [/\bdelhi\b/i, "Delhi"], [/\bchandigarh\b/i, "Chandigarh"],
  [/\bpuducherry\b|\bpondicherry\b/i, "Puducherry"],
  [/\bchennai\b/i, "Tamil Nadu"], [/\bbengaluru\b|\bbangalore\b/i, "Karnataka"], [/\bhyderabad\b/i, "Telangana"],
  [/\bmumbai\b/i, "Maharashtra"], [/\bkolkata\b/i, "West Bengal"],
];

// PIN code prefix -> state. Prefixes shared by two states are left out on purpose.
var RF_PIN3 = { 403: "Goa", 605: "Puducherry", 160: "Chandigarh", 737: "Sikkim" };
var RF_PIN2 = {
  11: "Delhi", 12: "Haryana", 13: "Haryana", 14: "Punjab", 15: "Punjab", 16: "Punjab", 17: "Himachal Pradesh",
  18: "Jammu and Kashmir", 19: "Jammu and Kashmir", 20: "Uttar Pradesh", 21: "Uttar Pradesh", 22: "Uttar Pradesh",
  23: "Uttar Pradesh", 25: "Uttar Pradesh", 27: "Uttar Pradesh", 28: "Uttar Pradesh", 30: "Rajasthan", 31: "Rajasthan",
  32: "Rajasthan", 33: "Rajasthan", 34: "Rajasthan", 36: "Gujarat", 37: "Gujarat", 38: "Gujarat", 39: "Gujarat",
  40: "Maharashtra", 41: "Maharashtra", 42: "Maharashtra", 43: "Maharashtra", 44: "Maharashtra", 45: "Madhya Pradesh",
  46: "Madhya Pradesh", 47: "Madhya Pradesh", 48: "Madhya Pradesh", 49: "Chhattisgarh", 50: "Telangana",
  51: "Andhra Pradesh", 52: "Andhra Pradesh", 53: "Andhra Pradesh", 56: "Karnataka", 57: "Karnataka", 58: "Karnataka",
  59: "Karnataka", 60: "Tamil Nadu", 61: "Tamil Nadu", 62: "Tamil Nadu", 63: "Tamil Nadu", 64: "Tamil Nadu",
  67: "Kerala", 68: "Kerala", 69: "Kerala", 70: "West Bengal", 71: "West Bengal", 72: "West Bengal", 73: "West Bengal",
  74: "West Bengal", 75: "Odisha", 76: "Odisha", 77: "Odisha", 78: "Assam", 80: "Bihar", 84: "Bihar", 85: "Bihar",
};

function rfStateIn_(text) {
  var earliest = null;
  RF_STATES.forEach(function (entry) {
    var match = text.match(entry[0]);
    if (match && (earliest === null || match.index < earliest.at)) earliest = { at: match.index, state: entry[1] };
  });
  if (earliest) return earliest.state;
  var pin = text.match(/(?:^|[^\d+])([1-8]\d{2})\s?\d{3}(?!\d)/);
  if (!pin) return null;
  return RF_PIN3[pin[1]] || RF_PIN2[pin[1].slice(0, 2)] || null;
}

// The few lines after an address label, stopping before the resume moves on, so a
// college named further down is not taken for the candidate's home.
function rfAddressLines_(text) {
  var kept = [];
  var lines = text.split("\n");
  for (var i = 0; i < lines.length && kept.length < 5; i++) {
    if (/education|objective|career|experience|qualification|profile|summary|universit|college|institut/i.test(lines[i])) break;
    if (lines[i].trim()) kept.push(lines[i]);
  }
  return kept.join("\n").slice(0, 200);
}

function rfHomeState_(text) {
  var labelled = text.match(/\b(?:permanent|home|native|residential)\s+address\b([\s\S]*)/i);
  if (labelled) return { state: rfStateIn_(rfAddressLines_(labelled[1])), via: "labelled" };
  // A bare "Address", but not a current, present, office or college one.
  var plain = /(^|[^a-z])(\w*\s*)address\b/gi;
  var match;
  while ((match = plain.exec(text))) {
    if (/current|present|office|official|college|institute|e-?mail|web|communication/i.test(match[2])) continue;
    return { state: rfStateIn_(rfAddressLines_(text.slice(plain.lastIndex))), via: "address" };
  }
  // Unlabelled contact details are left out on purpose: they often say where the
  // person lives or works now, and this chart is about home (user's choice, 2-Nov-2026).
  return { state: null, via: "none" };
}

function extractResumeFields_(text) {
  var gender = text.match(/\b(?:gender|sex)\b(?:\s*&\s*marital status)?[\s:\-–—]*(female|male)\b/i);
  var home = rfHomeState_(text);
  var state = home.state;
  var nationality = /\b(?:nationality|citizenship|citenship)\b[\s:\-–—]*indian?\b/i.test(text);
  return {
    gender: gender ? (gender[1].toLowerCase() === "female" ? "Female" : "Male") : null,
    state: state,
    country: state || nationality ? "India" : null,
    via: home.via,
  };
}

function rfSelectedFileIds_() {
  var values = SpreadsheetApp.openById(RF_SHEET_ID).getSheetByName(RF_TAB).getDataRange().getValues();
  var headers = values[1].map(function (h) { return String(h).trim(); }); // row 2 is the header
  var statusAt = headers.indexOf("Status");
  var linkAt = headers.indexOf("Google Link");
  if (statusAt < 0 || linkAt < 0) throw new Error("Status or Google Link column not found");
  var seen = {};
  for (var i = 2; i < values.length; i++) {
    if (String(values[i][statusAt]).trim() !== "Selected") continue;
    var link = String(values[i][linkAt]);
    var match = link.match(/[?&]id=([\w-]+)/) || link.match(/\/d\/([\w-]+)/);
    if (match) seen[match[1]] = true;
  }
  return Object.keys(seen).sort();
}

// Google turns a PDF into text by converting a temporary copy, deleted straight after.
function rfReadText_(fileId) {
  var copy = Drive.Files.copy({ name: "resume-read-temp", mimeType: "application/vnd.google-apps.document" }, fileId);
  try {
    return DocumentApp.openById(copy.id).getBody().getText();
  } finally {
    Drive.Files.remove(copy.id);
  }
}

function previewResumeFields() {
  var ids = rfSelectedFileIds_();
  var step = Math.max(1, Math.floor(ids.length / RF_PREVIEW_SIZE));
  var counts = { resumes: ids.length, tested: 0, unreadable: 0, gender: 0, state: 0, country: 0 };
  var states = {};
  var stateVia = {};
  for (var i = 0; i < ids.length && counts.tested < RF_PREVIEW_SIZE; i += step) {
    counts.tested++;
    try {
      var fields = extractResumeFields_(rfReadText_(ids[i]));
      if (fields.gender) counts.gender++;
      if (fields.country) counts.country++;
      if (fields.state) {
        counts.state++;
        states[fields.state] = (states[fields.state] || 0) + 1;
        stateVia[fields.via] = (stateVia[fields.via] || 0) + 1;
      }
    } catch (e) {
      counts.unreadable++;
    }
  }
  Logger.log(JSON.stringify(counts));
  Logger.log(JSON.stringify(states));
  Logger.log(JSON.stringify(stateVia));
}

function sendResumeFields() {
  var props = PropertiesService.getScriptProperties();
  var secret = (props.getProperty("TALENT_POOL_SYNC_SECRET") || "").trim();
  if (!secret) throw new Error("Set the TALENT_POOL_SYNC_SECRET script property first (Project Settings).");
  rfSetTrigger_(true);

  var started = Date.now();
  var ids = rfSelectedFileIds_();
  var next = Number(props.getProperty("RF_NEXT") || 0);
  var items = [];
  var unreadable = 0;
  while (next < ids.length && Date.now() - started < RF_RUN_LIMIT_MS) {
    try {
      var fields = extractResumeFields_(rfReadText_(ids[next]));
      if (fields.gender || fields.state || fields.country) {
        items.push({ file_id: ids[next], gender: fields.gender, state: fields.state, country: fields.country });
      }
    } catch (e) {
      unreadable++;
    }
    next++;
  }

  var response = UrlFetchApp.fetch(RF_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "X-Talent-Pool-Sync-Secret": secret },
    payload: JSON.stringify({ items: items }),
    muteHttpExceptions: true,
  });
  Logger.log("HTTP " + response.getResponseCode() + " " + response.getContentText());
  if (response.getResponseCode() !== 200) throw new Error("The app refused this batch; it will be read again.");

  props.setProperty("RF_NEXT", String(next));
  Logger.log("Read " + next + " of " + ids.length + ", unreadable this batch " + unreadable);
  if (next >= ids.length) {
    props.deleteProperty("RF_NEXT");
    rfSetTrigger_(false);
    Logger.log("Finished.");
  }
}

function rfSetTrigger_(on) {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === "sendResumeFields"; });
  if (on && existing.length === 0) ScriptApp.newTrigger("sendResumeFields").timeBased().everyMinutes(10).create();
  if (!on) existing.forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
