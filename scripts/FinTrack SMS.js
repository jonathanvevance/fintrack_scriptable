// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: comment-dollar;

// Run from a Shortcuts "Message" automation with the message Content as the parameter.
// No network calls: parses, stores, and posts a notification.
// Run by hand inside Scriptable, it only explains how to test.

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

let step = "start";
try {
  if (config.runsInApp) {
    await explain(
      "FinTrack SMS",
      "This script runs from the Shortcuts message automation. To test by hand, open FinTrack and tap \"Add SMS from clipboard\"."
    );
  } else {
    step = "load modules";
    const { capture } = importModule("fintrack/lib/capture.js");
    step = "read input";
    const text = inputText();
    step = "capture";
    const result = await capture(text, new Date());
    if (result.status !== "duplicate") {
      step = "notify";
      const n = new Notification();
      n.title = result.status === "saved" ? "FinTrack" : "FinTrack: not recognised";
      n.body = result.summary;
      n.openURL = "scriptable:///run?scriptName=" + encodeURIComponent("FinTrack");
      await n.schedule();
    }
    Script.setShortcutOutput(result.summary);
  }
} catch (e) {
  const message = `Failed at step "${step}": ${e}`;
  console.error(message);
  if (config.runsInApp) await explain("FinTrack SMS error", message);
  else Script.setShortcutOutput(message);
}
Script.complete();
