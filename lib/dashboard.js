// Shows fintrack/dashboard in a WebView with every month, the rules and unrecognised messages
// handed in directly (no file picker, no network). The page makes requests by navigating to
//   fintrack://do?data=<encoded { action, ... }>
// That navigation is cancelled here, the action runs, and the page gets fintrack.reply(result).

const sibling = (name) => module.filename.replace(/[^/]+$/, name);
const store = importModule(sibling("store.js"));
const { capture } = importModule(sibling("capture.js"));
const { compileRules } = importModule(sibling("tags.js"));
const { checkAccounts } = importModule(sibling("accounts.js"));

const REQUEST = "fintrack://do?data=";
const CAPTURE_TITLES = { saved: "Saved", duplicate: "Already saved", unparsed: "Not recognised", empty: "Clipboard is empty" };

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
  const libs = (await lib("tags", "tags.js")) + (await lib("format", "format.js")) + (await lib("accounts", "accounts.js"));
  const app = await readCode("dashboard/app.js");
  return (await readCode("dashboard/index.html"))
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
    .replace("<!-- LIBS -->", () => libs)
    .replace('<script src="app.js"></script>', () => `<script>${app}</script>`);
}

function version() {
  try {
    const v = JSON.parse(store.fm.readString(store.fm.joinPath(store.fm.documentsDirectory(), "fintrack/version.json")));
    return `${v.sha.slice(0, 7)} · ${v.message}`;
  } catch (e) {
    return "unknown";
  }
}

async function pageData(ym) {
  return {
    months: await store.listAll(),
    rules: await store.readRules(),
    categories: await store.readCategories(),
    accounts: await store.readAccounts(),
    unparsed: await store.listUnparsed(),
    version: version(),
    currentMonth: ym,
  };
}

function checkCategories(looks) {
  if (!looks || typeof looks !== "object" || Array.isArray(looks)) throw new Error("categories must be an object");
  for (const [name, look] of Object.entries(looks)) {
    const valid = look && typeof look.emoji === "string" && look.emoji.length <= 16 && /^#[0-9a-f]{6}$/i.test(look.colour);
    if (!valid) throw new Error(`bad look for category ${name}`);
  }
}

function checkTransactionRef({ ym, id }) {
  if (!/^\d{4}-\d{2}$/.test(ym) || typeof id !== "string") throw new Error("bad transaction reference");
}

// Each returns { title?, message?, reload?, ym? }. Validation happens before any write.
const ACTIONS = {
  // `manual` is one { ym, id, manual } update or a list of them (renaming or merging a category).
  async save({ rules, manual, categories, accounts }) {
    if (rules !== undefined) {
      if (!Array.isArray(rules)) throw new Error("rules must be a list");
      compileRules(rules);
    }
    if (accounts !== undefined) checkAccounts(accounts);
    const updates = manual === undefined ? [] : [].concat(manual);
    for (const update of updates) {
      checkTransactionRef(update);
      if (!update.manual || typeof update.manual !== "object") throw new Error("bad transaction update");
      if ("selfTransfer" in update.manual && update.manual.selfTransfer !== true) throw new Error("bad self-transfer value");
      if ("lowConfidenceReviewed" in update.manual && update.manual.lowConfidenceReviewed !== true) throw new Error("bad review value");
    }
    if (categories !== undefined) checkCategories(categories);
    if (rules !== undefined) store.writeRules(rules);
    if (categories !== undefined) store.writeCategories(categories);
    if (accounts !== undefined) store.writeAccounts(accounts);
    for (const update of updates) await store.updateTransaction(update.ym, update.id, { manual: update.manual });
    return {};
  },
  async pasteSms() {
    const result = await capture(Pasteboard.pasteString() || "", new Date());
    return { title: CAPTURE_TITLES[result.status], message: result.summary, reload: true, ym: result.tx ? result.tx.date.slice(0, 7) : null };
  },
  async copy({ text }) {
    Pasteboard.copyString(String(text || ""));
    return { title: "Copied", message: "" };
  },
  async deleteTx(ref) {
    checkTransactionRef(ref);
    await store.deleteTransaction(ref.ym, ref.id);
    return { title: "Deleted", message: "", reload: true };
  },
  async clearUnparsed() {
    for (const u of await store.listUnparsed()) await store.deleteUnparsed(u.id);
    return { title: "Cleared", message: "", reload: true };
  },
  async update() {
    Safari.open("scriptable:///run?scriptName=" + encodeURIComponent("FinTrack Update"));
    return { title: "Updating", message: "Open FinTrack again when the update has finished." };
  },
};

async function handle(url, ym) {
  try {
    if (!url.startsWith(REQUEST)) throw new Error("Unknown request");
    const { action, ...fields } = JSON.parse(decodeURIComponent(url.slice(REQUEST.length)));
    if (!ACTIONS[action]) throw new Error(`Unknown action ${action}`);
    const { reload, ...result } = await ACTIONS[action](fields);
    return { ok: true, ...result, ...(reload ? { data: await pageData(result.ym || ym) } : {}) };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

/** Opens the dashboard on month `ym` ("YYYY-MM") and resolves when it is closed. */
async function openDashboard(ym) {
  const wv = new WebView();
  wv.shouldAllowRequest = (request) => {
    if (!request.url.startsWith("fintrack://")) return true;
    handle(request.url, ym).then((result) => wv.evaluateJavaScript(`fintrack.reply(${JSON.stringify(result)})`));
    return false;
  };
  await wv.loadHTML(await buildHtml());
  await wv.evaluateJavaScript(`fintrack.load(${JSON.stringify(await pageData(ym))})`);
  await wv.present(true);
}

module.exports = { openDashboard };
