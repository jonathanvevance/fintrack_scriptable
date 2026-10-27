// Shows fintrack/dashboard in a WebView with every month and the rules handed in directly
// (no file picker, no network). The page asks to save rules by navigating to
// fintrack://saveRules?data=<encoded rules array>; that navigation is cancelled here and handled.

const sibling = (name) => module.filename.replace(/[^/]+$/, name);
const store = importModule(sibling("store.js"));
const { compileRules } = importModule(sibling("tags.js"));

const SAVE_RULES = "fintrack://saveRules?data=";

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

function saveRules(url) {
  try {
    const list = JSON.parse(decodeURIComponent(url.slice(SAVE_RULES.length)));
    if (!Array.isArray(list)) throw new Error("rules must be a list");
    compileRules(list);
    store.writeRules(list);
    return { ok: true, message: "" };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

/** Opens the dashboard on month `ym` ("YYYY-MM") and resolves when it is closed. */
async function openDashboard(ym) {
  const wv = new WebView();
  wv.shouldAllowRequest = (request) => {
    if (!request.url.startsWith("fintrack://")) return true;
    const result = request.url.startsWith(SAVE_RULES) ? saveRules(request.url) : { ok: false, message: "Unknown request" };
    wv.evaluateJavaScript(`fintrack.saved(${result.ok}, ${JSON.stringify(result.message)})`);
    return false;
  };
  await wv.loadHTML(await buildHtml());
  const data = { months: await store.listAll(), rules: await store.readRules(), currentMonth: ym };
  await wv.evaluateJavaScript(`fintrack.load(${JSON.stringify(data)})`);
  await wv.present(true);
}

module.exports = { openDashboard };
