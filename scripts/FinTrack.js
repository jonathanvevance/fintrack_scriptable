// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: rupee-sign;

// In the app: the dashboard (fintrack/dashboard). As a widget: this month's spend.

const store = importModule("fintrack/lib/store.js");
const { recheck } = importModule("fintrack/lib/capture.js");
const { money, monthLabel, totals } = importModule("fintrack/lib/format.js");
const { openDashboard } = importModule("fintrack/lib/dashboard.js");
const { compileAccounts } = importModule("fintrack/lib/accounts.js");
const { annotateTransaction, cleanCache } = importModule("fintrack/lib/exchange.js");

const RED = new Color("#d64545");
const GREEN = new Color("#2e9e5b");
const GREY = Color.gray();

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function runWidget() {
  const ym = currentMonth();
  const isSelf = compileAccounts(await store.readAccounts());
  let rates;
  try {
    rates = cleanCache(await store.readExchangeRates());
  } catch (_) {
    rates = cleanCache(null);
  }
  const list = (await store.listMonth(ym)).filter((tx) => !isSelf(tx)).map((tx) => annotateTransaction(tx, rates));
  const inr = totals(list).INR || { out: 0, in: 0 };
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

if (config.runsInWidget) {
  await runWidget();
} else {
  await recheck(currentMonth());
  await openDashboard(currentMonth());
}
Script.complete();
