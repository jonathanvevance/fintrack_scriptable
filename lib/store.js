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

function ensureDir(dir) {
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
}

async function readJSON(path, fallback) {
  if (!fm.fileExists(path)) return fallback;
  if (!fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
  try {
    return JSON.parse(fm.readString(path));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(path, value) {
  ensureDir(path.slice(0, path.lastIndexOf("/")));
  fm.writeString(path, JSON.stringify(value, null, 1));
}

function monthPath(ym) {
  return fm.joinPath(TX_DIR, `${ym}.json`);
}

// Stable id from the SMS text, so the same message captured twice is stored once.
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

async function addTransaction(tx) {
  const ym = tx.date.slice(0, 7);
  const list = await listMonth(ym);
  if (list.some((t) => t.id === tx.id)) return { duplicate: true };
  list.push(tx);
  list.sort((a, b) => (a.date + a.capturedAt < b.date + b.capturedAt ? 1 : -1));
  writeJSON(monthPath(ym), list);
  return { duplicate: false };
}

async function deleteTransaction(ym, id) {
  const list = await listMonth(ym);
  writeJSON(monthPath(ym), list.filter((t) => t.id !== id));
}

async function listUnparsed() {
  return readJSON(UNPARSED, []);
}

async function addUnparsed(text, receivedAt) {
  const list = await listUnparsed();
  const id = hashText(text);
  if (list.some((u) => u.id === id)) return;
  list.unshift({ id, text, receivedAt: receivedAt.toISOString() });
  writeJSON(UNPARSED, list.slice(0, 200));
}

async function deleteUnparsed(id) {
  const list = await listUnparsed();
  writeJSON(UNPARSED, list.filter((u) => u.id !== id));
}

module.exports = {
  fm,
  hashText,
  listMonth,
  listMonths,
  addTransaction,
  deleteTransaction,
  listUnparsed,
  addUnparsed,
  deleteUnparsed,
};
