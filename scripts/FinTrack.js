// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: rupee-sign;

// In the app: month view of captured transactions. As a widget: this month's spend.

const store = importModule("fintrack/lib/store.js");
const { capture, recheck } = importModule("fintrack/lib/capture.js");
const { money, monthLabel, shiftMonth, totals } = importModule("fintrack/lib/format.js");

const RED = new Color("#d64545");
const GREEN = new Color("#2e9e5b");
const GREY = Color.gray();

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function version() {
  const path = store.fm.joinPath(store.fm.documentsDirectory(), "fintrack/version.json");
  if (!store.fm.fileExists(path)) return "unknown version";
  try {
    const v = JSON.parse(store.fm.readString(path));
    return `${v.sha.slice(0, 7)} · ${v.message}`;
  } catch (e) {
    return "unknown version";
  }
}

function totalsLine(list) {
  const t = totals(list);
  const inr = t.INR || { out: 0, in: 0 };
  const foreign = Object.keys(t)
    .filter((c) => c !== "INR")
    .map((c) => `${money(t[c].out, c)} out`);
  return { inr, foreign };
}

async function alert(title, message, actions) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  actions.forEach((label) => a.addAction(label));
  a.addCancelAction("Cancel");
  return a.presentSheet();
}

async function promptText(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addTextField("Paste the SMS here", "");
  a.addAction("Add");
  a.addCancelAction("Cancel");
  if ((await a.present()) === -1) return null;
  return a.textFieldValue(0);
}

async function showResult(result) {
  const a = new Alert();
  a.title = { saved: "Saved", duplicate: "Already saved", unparsed: "Not recognised", empty: "Nothing to add", copied: "Copied" }[result.status];
  a.message = result.summary;
  a.addAction("OK");
  await a.present();
}

function actionRow(title, onSelect) {
  const row = new UITableRow();
  const cell = row.addText(title);
  cell.titleColor = Color.blue();
  row.onSelect = onSelect;
  row.dismissOnSelect = false;
  return row;
}

function txRow(tx, onSelect) {
  const row = new UITableRow();
  row.height = 56;
  const who = tx.merchant || tx.bank || "Unknown";
  const sub = [tx.date.slice(5), tx.bank, tx.account ? "··" + tx.account : null, tx.confidence === "low" ? "check" : null]
    .filter(Boolean)
    .join(" · ");
  const left = row.addText(who, sub);
  left.widthWeight = 70;
  left.subtitleColor = GREY;
  const amount = row.addText(money(tx.amountPaise, tx.currency));
  amount.widthWeight = 30;
  amount.rightAligned();
  amount.titleColor = tx.amountPaise < 0 ? RED : GREEN;
  row.onSelect = onSelect;
  row.dismissOnSelect = false;
  return row;
}

async function runApp() {
  const table = new UITable();
  table.showSeparators = true;
  let ym = currentMonth();

  async function addText(text) {
    const result = await capture(text, new Date());
    await showResult(result);
    if (result.tx) ym = result.tx.date.slice(0, 7);
    await render();
  }

  async function render() {
    table.removeAllRows();
    const list = await store.listMonth(ym);
    const unparsed = await store.listUnparsed();
    const { inr, foreign } = totalsLine(list);

    const header = new UITableRow();
    header.isHeader = true;
    header.height = 70;
    const h = header.addText(monthLabel(ym), `Spent ${money(inr.out)} · Received ${money(inr.in)}${foreign.length ? " · " + foreign.join(", ") : ""}`);
    h.titleFont = Font.boldSystemFont(22);
    h.subtitleColor = GREY;
    table.addRow(header);

    const nav = new UITableRow();
    const prev = nav.addButton("‹ Previous");
    prev.onTap = async () => { ym = shiftMonth(ym, -1); await render(); };
    prev.leftAligned();
    const next = nav.addButton("Next ›");
    next.onTap = async () => { ym = shiftMonth(ym, 1); await render(); };
    next.rightAligned();
    table.addRow(nav);

    table.addRow(actionRow("＋ Add SMS from clipboard", async () => addText(Pasteboard.pasteString() || "")));
    table.addRow(actionRow("＋ Paste SMS text…", async () => {
      const text = await promptText("Add SMS", "Paste a bank SMS to capture it, same as the automation would.");
      if (text !== null) await addText(text);
    }));

    const toCheck = list.filter((t) => t.confidence === "low");
    if (unparsed.length || toCheck.length) {
      table.addRow(actionRow(`⚠ ${unparsed.length} unrecognised · ${toCheck.length} to check`, async () => {
        const pick = await alert(
          "Messages to review",
          "Copy them all and paste into the FinTrack dev chat to get templates added.",
          ["Copy all for review", "Review unrecognised one by one", "Clear unrecognised"]
        );
        if (pick === 0) {
          const blocks = [
            ...unparsed.map((u) => `[unrecognised]\n${u.text}`),
            ...toCheck.map((t) => `[check: parsed as ${money(t.amountPaise, t.currency)} ${t.bank || "?"} ··${t.account || "?"}]\n${t.raw}`),
          ];
          Pasteboard.copyString(blocks.join("\n\n---\n\n"));
          await showResult({ status: "copied", summary: `Copied ${blocks.length} message(s)` });
        }
        if (pick === 1) {
          for (const u of unparsed) {
            const choice = await alert("Unrecognised SMS", u.text, ["Copy text", "Delete", "Next"]);
            if (choice === -1) break;
            if (choice === 0) Pasteboard.copyString(u.text);
            if (choice === 1) await store.deleteUnparsed(u.id);
          }
        }
        if (pick === 2) {
          for (const u of unparsed) await store.deleteUnparsed(u.id);
        }
        await render();
      }));
    }

    if (!list.length) {
      const empty = new UITableRow();
      empty.addText("No transactions this month").titleColor = GREY;
      table.addRow(empty);
    }
    for (const tx of list) {
      table.addRow(txRow(tx, async () => {
        const details = `${money(tx.amountPaise, tx.currency)} · ${tx.date} · ${tx.template}\n\n${tx.raw}`;
        const pick = await alert(tx.merchant || tx.bank || "Transaction", details, ["Copy SMS", "Delete"]);
        if (pick === 0) Pasteboard.copyString(tx.raw);
        if (pick === 1) {
          await store.deleteTransaction(ym, tx.id);
          await render();
        }
      }));
    }

    table.addRow(actionRow("⟳ Update FinTrack", async () => {
      Safari.open("scriptable:///run?scriptName=" + encodeURIComponent("FinTrack Update"));
    }));
    const footer = new UITableRow();
    footer.addText(version()).titleColor = GREY;
    table.addRow(footer);

    table.reload();
  }

  await recheck(ym);
  await render();
  await table.present(false);
}

async function runWidget() {
  const ym = currentMonth();
  const list = await store.listMonth(ym);
  const { inr } = totalsLine(list);
  const w = new ListWidget();
  w.url = "scriptable:///run?scriptName=" + encodeURIComponent("FinTrack");
  const title = w.addText(`${monthLabel(ym)} spent`);
  title.font = Font.mediumSystemFont(12);
  title.textColor = GREY;
  const total = w.addText(money(inr.out));
  total.font = Font.boldSystemFont(24);
  total.minimumScaleFactor = 0.5;
  w.addSpacer(6);
  for (const tx of list.slice(0, config.widgetFamily === "small" ? 2 : 4)) {
    const line = w.addText(`${money(tx.amountPaise, tx.currency)} ${tx.merchant || tx.bank || ""}`);
    line.font = Font.systemFont(11);
    line.lineLimit = 1;
    line.textColor = tx.amountPaise < 0 ? RED : GREEN;
  }
  w.addSpacer();
  Script.setWidget(w);
}

if (config.runsInWidget) await runWidget();
else await runApp();
Script.complete();
