// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: cloud-download-alt;

// Installs the latest FinTrack code from GitHub into Scriptable's folder.
// Paste this one script by hand, named exactly "FinTrack Update"; it updates itself afterwards.
// It only writes the files listed in manifest.json, never fintrack/data.

const REPO = "jonathanvevance/fintrack_scriptable";
const BRANCH = "master";
const HEADERS = { "User-Agent": "fintrack-scriptable", Accept: "application/vnd.github+json" };

function fileManager() {
  try {
    const icloud = FileManager.iCloud();
    if (module.filename.startsWith(icloud.documentsDirectory())) return icloud;
  } catch (e) {
    // iCloud is off for Scriptable.
  }
  return FileManager.local();
}

async function fetchText(url) {
  const req = new Request(url);
  req.headers = HEADERS;
  const body = await req.loadString();
  if (req.response.statusCode !== 200) throw new Error(`HTTP ${req.response.statusCode} for ${url}`);
  return body;
}

async function latestCommit() {
  const commit = JSON.parse(await fetchText(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`));
  return { sha: commit.sha, message: commit.commit.message.split("\n")[0], date: commit.commit.committer.date };
}

async function main() {
  const fm = fileManager();
  const root = fm.documentsDirectory();
  console.log("[PROGRESS] Looking up latest commit");
  // Pinning raw URLs to a commit sha avoids raw.githubusercontent.com's ~5 minute branch cache.
  const commit = await latestCommit();
  const base = `https://raw.githubusercontent.com/${REPO}/${commit.sha}/`;
  const manifest = JSON.parse(await fetchText(base + "manifest.json"));

  // Download everything before writing anything, so a dropped connection never leaves
  // a mix of old and new files.
  const files = manifest.files;
  const downloads = [];
  for (let i = 0; i < files.length; i++) {
    const { src, dest } = files[i];
    if (dest.includes("..") || dest.startsWith("/") || dest.startsWith("fintrack/data")) {
      throw new Error(`Refusing to write ${dest}`);
    }
    downloads.push({ dest, text: await fetchText(base + encodeURI(src)) });
    console.log(`[PROGRESS] Downloaded ${i + 1}/${files.length}: ${src}`);
  }
  for (const { dest, text } of downloads) {
    const path = fm.joinPath(root, dest);
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    fm.writeString(path, text);
  }
  console.log(`[PROGRESS] Installed ${downloads.length} files`);

  const versionPath = fm.joinPath(root, "fintrack/version.json");
  fm.writeString(versionPath, JSON.stringify({ ...commit, installedAt: new Date().toISOString() }, null, 1));
  console.log(`[PROGRESS] Finished: ${commit.sha.slice(0, 7)} ${commit.message}`);
  return commit;
}

try {
  const commit = await main();
  if (config.runsInApp) {
    const a = new Alert();
    a.title = "FinTrack updated";
    a.message = `${commit.sha.slice(0, 7)} · ${commit.message}`;
    a.addAction("OK");
    await a.present();
  }
} catch (e) {
  console.error(e);
  if (config.runsInApp) {
    const a = new Alert();
    a.title = "Update failed";
    a.message = String(e);
    a.addAction("OK");
    await a.present();
  }
}
Script.complete();
