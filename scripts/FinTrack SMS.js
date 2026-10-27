// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: comment-dollar;

// Run from a Shortcuts "Message" automation with the message Content as the parameter.
// No network calls: parses, stores, and posts a notification.
// Run by hand inside Scriptable, it only explains how to test.

// Must match PENDING in lib/store.js. Written without lib imports, since a broken lib is one way to get here.
const PENDING_FILE = "fintrack-pending.json";
const OPEN_FINTRACK = "scriptable:///run?scriptName=" + encodeURIComponent("FinTrack");

async function explain(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.present();
}

function inputText() {
  const p = args.shortcutParameter;
  if (typeof p === "string") return p;
  if (p && typeof p === "object") return p.text || p.content || p.body || JSON.stringify(p);
  return (args.plainTexts && args.plainTexts[0]) || "";
}

async function notify(title, body) {
  const n = new Notification();
  n.title = title;
  n.body = body;
  n.openURL = OPEN_FINTRACK;
  await n.schedule();
}

// Keeps the SMS on this device so FinTrack can save it on next open.
async function stashPending(text, receivedAt, error) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), PENDING_FILE);
  const list = fm.fileExists(path) ? JSON.parse(fm.readString(path)) : [];
  list.push({ text, receivedAt: receivedAt.toISOString(), error });
  fm.writeString(path, JSON.stringify(list, null, 1));
  await notify("FinTrack: capture failed", "Message kept. Open FinTrack to save it.");
}

let step = "start";
const receivedAt = new Date();
let text = "";
try {
  if (config.runsInApp) {
    await explain(
      "FinTrack SMS",
      "This script runs from the Shortcuts message automation. To test by hand, open FinTrack and tap \"Add SMS from clipboard\"."
    );
  } else {
    step = "read input";
    text = inputText();
    step = "load modules";
    const { capture } = importModule("fintrack/lib/capture.js");
    step = "capture";
    const result = await capture(text, receivedAt);
    step = "notify";
    if (result.status !== "duplicate") {
      await notify(result.status === "saved" ? "FinTrack" : "FinTrack: not recognised", result.summary);
    }
    Script.setShortcutOutput(result.summary);
  }
} catch (e) {
  const message = `Failed at step "${step}": ${e}`;
  console.error(message);
  if (config.runsInApp) await explain("FinTrack SMS error", message);
  else {
    if (text.trim() && step !== "notify") {
      try {
        await stashPending(text, receivedAt, message);
      } catch (stashError) {
        console.error(`Could not keep the message: ${stashError}`);
      }
    }
    Script.setShortcutOutput(message);
  }
}
Script.complete();
