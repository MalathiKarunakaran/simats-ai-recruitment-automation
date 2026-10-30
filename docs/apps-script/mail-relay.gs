/**
 * SIMATS mail relay -- a Google Apps Script project of its own (script.new),
 * deployed as a web app, that sends the app's emails from the deploying
 * saveetha.com account with Gmail.
 *
 * Why it exists (2026-10-30): saveetha.com has 2-Step Verification, and so
 * app passwords, switched off, so n8n cannot send over SMTP as a saveetha.com
 * address; and Google Cloud is off too, so n8n's Gmail sign-in is out. An
 * Apps Script runs inside Google as its owner and needs neither.
 *
 * n8n posts {secret, kind, to, ...} here (docs/n8n/send-otp-email.workflow.json).
 * The relay builds every message itself from a fixed template per `kind`;
 * there is no free-text subject or body, so even a leaked secret can only
 * send a sign-in code ("otp") or a password-reset link ("reset", added
 * 2026-10-30). Staff notices ("notice", same day) do carry the app's own
 * subject and body, so they are refused for any address outside
 * NOTICE_DOMAINS. Sending is also capped per recipient and per hour.
 *
 * Web apps cannot read request headers, so the secret travels in the body.
 * A web app always answers HTTP 200; the result is in the JSON ({sent: ...}).
 *
 * Setup: docs/n8n/email.md.
 */

var SENDER_NAME = "SIMATS Recruitment";
var APP_URL = "https://app.malathi.io";
var MAX_PER_RECIPIENT_PER_10_MIN = 5;
var MAX_PER_HOUR = 200;
// Staff notices ("notice") carry the app's own wording, so they may only go
// to these domains: a leaked secret still cannot email anyone outside SIMATS.
var NOTICE_DOMAINS = ["saveetha.com"];

function doPost(e) {
  var request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return reply_({ sent: false, detail: "body is not JSON" });
  }
  if (!secretMatches_(request.secret)) return reply_({ sent: false, detail: "bad secret" });

  var to = String(request.to || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || to.length > 320) {
    return reply_({ sent: false, detail: "bad recipient" });
  }

  var message;
  if (request.kind === "otp") message = otpMessage_(request);
  if (request.kind === "reset") message = resetMessage_(request);
  if (request.kind === "notice") message = noticeMessage_(request, to);
  if (!message) return reply_({ sent: false, detail: "unknown kind or bad fields" });

  var limited = overLimit_(to);
  if (limited) return reply_({ sent: false, detail: limited });

  MailApp.sendEmail({
    to: to,
    subject: message.subject,
    body: message.text,
    htmlBody: message.html,
    name: SENDER_NAME,
  });
  return reply_({ sent: true });
}

// A plain GET (someone opening the URL) learns nothing.
function doGet() {
  return reply_({ ok: true });
}

function otpMessage_(request) {
  var code = String(request.code || "");
  if (!/^\d{6}$/.test(code)) return null;
  var name = String(request.full_name || "").slice(0, 120);
  var hello = "Hello" + (name ? " " + name : "") + ",";
  return {
    subject: "Your SIMATS Recruitment sign-in code: " + code,
    text:
      hello + "\n\nYour sign-in code for SIMATS Recruitment is:\n\n    " + code +
      "\n\nIt works once and expires in 10 minutes.\n\n" +
      "If you did not try to sign in, you can ignore this email; nobody can sign in without the code.\n\n" +
      SENDER_NAME + "\n" + APP_URL,
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.5">' +
      "<p>" + escape_(hello) + "</p>" +
      "<p>Your sign-in code for <strong>SIMATS Recruitment</strong> is:</p>" +
      '<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">' + code + "</p>" +
      "<p>It works once and expires in <strong>10 minutes</strong>.</p>" +
      '<p style="color:#6b7280;font-size:13px">If you did not try to sign in, you can ignore this email; nobody can sign in without the code.</p>' +
      '<p style="color:#6b7280;font-size:13px">' + SENDER_NAME + ' &middot; <a href="' + APP_URL + '">app.malathi.io</a></p>' +
      "</div>",
  };
}

// The token goes after "#" so it never reaches a server log or a Referer
// header; the reset page reads it from the fragment.
function resetMessage_(request) {
  var token = String(request.token || "");
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  var link = APP_URL + "/reset-password#token=" + token;
  var name = String(request.full_name || "").slice(0, 120);
  var hello = "Hello" + (name ? " " + name : "") + ",";
  return {
    subject: "Reset your SIMATS Recruitment password",
    text:
      hello + "\n\nSomeone asked to reset the password for your SIMATS Recruitment account.\n" +
      "To choose a new password, open this link:\n\n" + link +
      "\n\nThe link works once and expires in 30 minutes. Resetting signs you out everywhere.\n\n" +
      "If you did not ask for this, ignore this email; your password stays as it is.\n\n" +
      SENDER_NAME + "\n" + APP_URL,
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.5">' +
      "<p>" + escape_(hello) + "</p>" +
      "<p>Someone asked to reset the password for your <strong>SIMATS Recruitment</strong> account.</p>" +
      '<p style="margin:20px 0"><a href="' + link + '" style="background:#1D4ED8;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Choose a new password</a></p>' +
      "<p>The link works once and expires in <strong>30 minutes</strong>. Resetting signs you out everywhere.</p>" +
      '<p style="color:#6b7280;font-size:13px">If you did not ask for this, ignore this email; your password stays as it is.</p>' +
      '<p style="color:#6b7280;font-size:13px">' + SENDER_NAME + ' &middot; <a href="' + APP_URL + '">app.malathi.io</a></p>' +
      "</div>",
  };
}

// A workflow notification for a staff member (2026-10-30). Subject and body
// are the app's text, shown as plain text inside a fixed frame; HTML in them
// is escaped, never rendered.
function noticeMessage_(request, to) {
  var domain = to.split("@")[1].toLowerCase();
  if (NOTICE_DOMAINS.indexOf(domain) === -1) return null;
  var subject = String(request.subject || "").replace(/[\r\n]+/g, " ").trim();
  var body = String(request.body || "").trim();
  if (!subject || subject.length > 200 || !body || body.length > 3000) return null;
  return {
    subject: "[SIMATS Recruitment] " + subject,
    text:
      body + "\n\nOpen SIMATS Recruitment: " + APP_URL + "\n\n" +
      "You get this email because of your role in SIMATS Recruitment.",
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.5">' +
      '<p style="font-size:17px;font-weight:bold;margin:0 0 12px">' + escape_(subject) + "</p>" +
      "<p>" + escape_(body).replace(/\n/g, "<br>") + "</p>" +
      '<p style="margin:20px 0"><a href="' + APP_URL + '" style="background:#1D4ED8;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open SIMATS Recruitment</a></p>' +
      '<p style="color:#6b7280;font-size:13px">You get this email because of your role in SIMATS Recruitment.</p>' +
      "</div>",
  };
}

function secretMatches_(given) {
  var expected = (PropertiesService.getScriptProperties().getProperty("RELAY_SECRET") || "").trim();
  given = String(given || "");
  if (!expected || given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Returns a reason when a cap is hit, else counts this send and returns "".
function overLimit_(to) {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var hourKey = "hour:" + Utilities.formatDate(new Date(), "UTC", "yyyyMMddHH");
    var recipientKey = "to:" + to.toLowerCase();
    var hour = Number(cache.get(hourKey) || 0);
    var recipient = Number(cache.get(recipientKey) || 0);
    if (hour >= MAX_PER_HOUR) return "hourly limit reached";
    if (recipient >= MAX_PER_RECIPIENT_PER_10_MIN) return "too many codes for this address; wait 10 minutes";
    cache.put(hourKey, String(hour + 1), 3600);
    cache.put(recipientKey, String(recipient + 1), 600);
    return "";
  } finally {
    lock.releaseLock();
  }
}

function escape_(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor, before deploying: Google asks for permission to
// send email as you, and a test code goes to your own address.
function testSendToMe() {
  var me = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: me,
    subject: "SIMATS mail relay test",
    body: "The relay can send email as " + me + ". Remaining quota today: " + MailApp.getRemainingDailyQuota(),
    name: SENDER_NAME,
  });
  console.log("Test email sent to " + me + "; remaining daily quota " + MailApp.getRemainingDailyQuota());
}
