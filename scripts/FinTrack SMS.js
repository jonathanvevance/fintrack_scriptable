// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: comment-dollar;

// Run from a Shortcuts "Message" automation with the message Content as the parameter.
// No network calls: parses, stores, and posts a notification.

const { capture } = importModule("fintrack/lib/capture.js");

function inputText() {
  const p = args.shortcutParameter;
  if (typeof p === "string") return p;
  if (p && typeof p === "object") return p.text || p.content || p.body || JSON.stringify(p);
  return (args.plainTexts && args.plainTexts[0]) || "";
}

const result = await capture(inputText(), new Date());

if (result.status !== "duplicate") {
  const n = new Notification();
  n.title = result.status === "saved" ? "FinTrack" : "FinTrack: not recognised";
  n.body = result.summary;
  n.openURL = "scriptable:///run?scriptName=" + encodeURIComponent("FinTrack");
  await n.schedule();
}

Script.setShortcutOutput(result.summary);
Script.complete();
