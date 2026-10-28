// JSON storage in Scriptable's folder: fintrack/data/transactions/YYYY-MM.json
// and fintrack/data/unparsed.json. Updates never write under fintrack/data.

function fileManager() {
  try {
    const icloud = FileManager.iCloud();
    if (module.filename.startsWith(icloud.documentsDirectory())) return icloud;
  } catch (e) {
    // iCloud is off for Scriptable; scripts live in local storage.
  }
  return FileManager.local();
}

const fm = fileManager();
const DATA = fm.joinPath(fm.documentsDirectory(), "fintrack/data");
const TX_DIR = fm.joinPath(DATA, "transactions");
const UNPARSED = fm.joinPath(DATA, "unparsed.json");
const RULES = fm.joinPath(DATA, "rules.json");
// Must match PENDING_FILE in "FinTrack SMS", which writes it without importing this module.
const local = FileManager.local();
const PENDING = local.joinPath(local.documentsDirectory(), "fintrack-pending.json");

// The same SMS text arriving again within this window is one message seen by two automations.
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

// Returns `fallback` only when the file does not exist. An unreadable or corrupt file is
// copied aside and throws, so the caller never overwrites data it could not read.
async function readJSON(path, fallback, files = fm) {
  if (!files.fileExists(path)) return fallback;
  if (files === fm && !fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
  const text = files.readString(path);
  if (text == null) throw new Error(`Could not read ${path} (phone locked or iCloud unavailable?)`);
  try {
    return JSON.parse(text);
  } catch (e) {
    const backup = path.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    files.copy(path, backup);
    throw new Error(`${path} is not valid JSON; a copy was saved to ${backup}`);
  }
}

function writeJSON(path, value, files = fm) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (!files.fileExists(dir)) files.createDirectory(dir, true);
  files.writeString(path, JSON.stringify(value, null, 1));
}

function monthPath(ym) {
  return fm.joinPath(TX_DIR, `${ym}.json`);
}

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function listMonth(ym) {
  return readJSON(monthPath(ym), []);
}

// Months that have a file, newest first ("YYYY-MM").
function listMonths() {
  if (!fm.fileExists(TX_DIR)) return [];
  return fm
    .listContents(TX_DIR)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 7))
    .sort()
    .reverse();
}

// `tx.textHash` identifies the SMS text; older entries only have `id` (which was that hash).
function isDuplicate(stored, tx) {
  if ((stored.textHash || stored.id) !== tx.textHash) return false;
  return Math.abs(Date.parse(stored.capturedAt) - Date.parse(tx.capturedAt)) <= DUPLICATE_WINDOW_MS;
}

async function addTransaction(tx) {
  const ym = tx.date.slice(0, 7);
  const list = await listMonth(ym);
  if (list.some((t) => isDuplicate(t, tx))) return { duplicate: true };
  list.push(tx);
  list.sort((a, b) => (a.date + a.capturedAt < b.date + b.capturedAt ? 1 : -1));
  writeJSON(monthPath(ym), list);
  return { duplicate: false };
}

async function deleteTransaction(ym, id) {
  const list = await listMonth(ym);
  writeJSON(monthPath(ym), list.filter((t) => t.id !== id));
}

// Merges `patch` into one stored transaction. The patch must not change its month.
async function updateTransaction(ym, id, patch) {
  const list = await listMonth(ym);
  writeJSON(monthPath(ym), list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

async function readRules() {
  return readJSON(RULES, []);
}

// Callers validate with compileRules first; order is priority (first match wins).
function writeRules(list) {
  writeJSON(RULES, list);
}

// Every month: { "YYYY-MM": [tx] }.
async function listAll() {
  const all = {};
  for (const ym of listMonths()) all[ym] = await listMonth(ym);
  return all;
}

async function listUnparsed() {
  return readJSON(UNPARSED, []);
}

async function addUnparsed(text, receivedAt) {
  const list = await listUnparsed();
  const id = hashText(text);
  if (list.some((u) => u.id === id)) return;
  list.unshift({ id, text, receivedAt: receivedAt.toISOString() });
  writeJSON(UNPARSED, list);
}

async function deleteUnparsed(id) {
  const list = await listUnparsed();
  writeJSON(UNPARSED, list.filter((u) => u.id !== id));
}

// Messages "FinTrack SMS" could not save: [{ text, receivedAt, error }].
async function listPending() {
  return readJSON(PENDING, [], local);
}

function setPending(list) {
  if (list.length) writeJSON(PENDING, list, local);
  else if (local.fileExists(PENDING)) local.remove(PENDING);
}

module.exports = {
  fm,
  hashText,
  listMonth,
  listMonths,
  addTransaction,
  deleteTransaction,
  updateTransaction,
  readRules,
  writeRules,
  listAll,
  listUnparsed,
  addUnparsed,
  deleteUnparsed,
  listPending,
  setPending,
};
