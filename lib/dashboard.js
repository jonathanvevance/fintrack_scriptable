// Shows fintrack/dashboard in a WebView with every month and the rules handed in directly
// (no file picker, no network). The page asks to save by navigating to
//   fintrack://save?data=<encoded { rules?: [rule], manual?: { ym, id, manual } }>
// That navigation is cancelled here, the change is validated and written, and the page is
// told the outcome through fintrack.saved(ok, message).

const sibling = (name) => module.filename.replace(/[^/]+$/, name);
const store = importModule(sibling("store.js"));
const { compileRules } = importModule(sibling("tags.js"));

const SAVE = "fintrack://save?data=";

async function readCode(relative) {
  const fm = store.fm;
  const path = fm.joinPath(fm.documentsDirectory(), "fintrack/" + relative);
  if (!fm.fileExists(path)) throw new Error(`Missing ${relative}. Run FinTrack Update.`);
  if (!fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
  return fm.readString(path);
}

// One self-contained page: style, lib modules and app inlined (functions, not strings, as
// replacements so "$&" in the code is not treated as a replacement pattern).
async function buildHtml() {
  const lib = async (name, file) =>
    `<script>(function(){var module={exports:{}};\n${await readCode("lib/" + file)}\n` +
    `window.FT=window.FT||{};FT.${name}=module.exports;})();</script>`;
  const css = await readCode("dashboard/style.css");
  const libs = (await lib("tags", "tags.js")) + (await lib("format", "format.js"));
  const app = await readCode("dashboard/app.js");
  return (await readCode("dashboard/index.html"))
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
    .replace("<!-- LIBS -->", () => libs)
    .replace('<script src="app.js"></script>', () => `<script>${app}</script>`);
}

// Validates everything before writing anything.
async function save(url) {
  if (!url.startsWith(SAVE)) throw new Error("Unknown request");
  const { rules, manual } = JSON.parse(decodeURIComponent(url.slice(SAVE.length)));
  if (rules !== undefined) {
    if (!Array.isArray(rules)) throw new Error("rules must be a list");
    compileRules(rules);
  }
  if (manual !== undefined) {
    const valid = /^\d{4}-\d{2}$/.test(manual.ym) && typeof manual.id === "string" && manual.manual && typeof manual.manual === "object";
    if (!valid) throw new Error("bad transaction update");
  }
  if (rules !== undefined) store.writeRules(rules);
  if (manual !== undefined) await store.updateTransaction(manual.ym, manual.id, { manual: manual.manual });
}

/** Opens the dashboard on month `ym` ("YYYY-MM") and resolves when it is closed. */
async function openDashboard(ym) {
  const wv = new WebView();
  wv.shouldAllowRequest = (request) => {
    if (!request.url.startsWith("fintrack://")) return true;
    save(request.url).then(
      () => wv.evaluateJavaScript("fintrack.saved(true, '')"),
      (e) => wv.evaluateJavaScript(`fintrack.saved(false, ${JSON.stringify(String(e.message || e))})`)
    );
    return false;
  };
  await wv.loadHTML(await buildHtml());
  const data = { months: await store.listAll(), rules: await store.readRules(), currentMonth: ym };
  await wv.evaluateJavaScript(`fintrack.load(${JSON.stringify(data)})`);
  await wv.present(true);
}

module.exports = { openDashboard };
