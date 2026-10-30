// Display helpers. Pure JavaScript, tested in plain JavaScriptCore.

const SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

// Indian digit grouping: 12345678 -> "1,23,45,678".
function groupIndian(n) {
  const s = String(n);
  if (s.length <= 3) return s;
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return head + "," + s.slice(-3);
}

function money(paise, currency = "INR") {
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const symbol = SYMBOLS[currency] || currency + " ";
  const digits = currency === "INR" ? groupIndian(whole) : String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (paise < 0 ? "-" : "") + symbol + digits + (fraction ? "." + String(fraction).padStart(2, "0") : "");
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1]} ${y}`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

// Signed INR paise for aggregation. Foreign transactions get `inrPaise` at dashboard load;
// null means there was no cached/fetched rate, so they remain separate from INR totals.
function inrValue(transaction) {
  if (transaction.currency === "INR") return transaction.amountPaise;
  return Number.isFinite(transaction.inrPaise) ? transaction.inrPaise : null;
}

// Totals per original currency, plus converted foreign transactions in the INR bucket.
function totals(transactions) {
  const out = {};
  const add = (currency, amount) => {
    const c = (out[currency] = out[currency] || { out: 0, in: 0, count: 0 });
    if (amount < 0) c.out += -amount;
    else c.in += amount;
    c.count += 1;
  };
  for (const t of transactions) {
    add(t.currency, t.amountPaise);
    const converted = inrValue(t);
    if (t.currency !== "INR" && converted != null) add("INR", converted);
  }
  return out;
}

// INR and converted foreign money out per category, largest first.
function categoryTotals(tagged) {
  const byCategory = new Map();
  for (const t of tagged) {
    const amount = inrValue(t);
    if (amount == null || amount >= 0) continue;
    const key = t.category || null;
    byCategory.set(key, (byCategory.get(key) || 0) - amount);
  }
  return [...byCategory].map(([category, paise]) => ({ category, paise })).sort((a, b) => b.paise - a.paise);
}

// INR and converted foreign money out per merchant: [{ merchant, category, paise, count }].
// category is the one the merchant's payments carry most often (null if mostly untagged).
function merchantTotals(tagged) {
  const byName = new Map();
  for (const t of tagged) {
    const amount = inrValue(t);
    if (amount == null || amount >= 0) continue;
    const name = t.merchant || t.bank || "Unknown";
    const m = byName.get(name) || { merchant: name, paise: 0, count: 0, categories: new Map() };
    m.paise -= amount;
    m.count += 1;
    m.categories.set(t.category || null, (m.categories.get(t.category || null) || 0) + 1);
    byName.set(name, m);
  }
  return [...byName.values()]
    .map(({ categories, ...m }) => ({ ...m, category: [...categories].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.paise - a.paise);
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// Monthly repeats among INR money out, by day of month:
//   [{ merchant, category, paise, day, months, lastDate, paidThisMonth, varies }].
// A merchant counts when it was paid in 2+ months, about once a month, with the amount within 30%
// and the day within 5 days of its usual, and was last paid this month or last month.
// `today` is "YYYY-MM-DD"; `paise` is the latest payment.
function recurringPayments(tagged, today) {
  const byMerchant = new Map();
  for (const t of tagged) {
    const amount = inrValue(t);
    if (amount == null || amount >= 0 || !t.merchant) continue;
    const key = t.merchant.toLowerCase();
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key).push({ ...t, amountPaise: amount, currency: "INR" });
  }
  const thisMonth = today.slice(0, 7);
  const found = [];
  for (const list of byMerchant.values()) {
    const months = new Map();
    for (const t of list) {
      const ym = t.date.slice(0, 7);
      if (!months.has(ym)) months.set(ym, []);
      months.get(ym).push(t);
    }
    if (months.size < 2 || list.length > months.size * 1.5) continue;
    const usual = median(list.map((t) => -t.amountPaise));
    const picked = [...months.values()]
      .map((ts) => ts.reduce((best, t) => (Math.abs(-t.amountPaise - usual) < Math.abs(-best.amountPaise - usual) ? t : best)))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const amounts = picked.map((t) => -t.amountPaise);
    if (Math.max(...amounts) > 1.3 * Math.min(...amounts)) continue;
    const days = picked.map((t) => Number(t.date.slice(8, 10)));
    const day = median(days);
    if (days.some((d) => Math.abs(d - day) > 5)) continue;
    const last = picked[picked.length - 1];
    if (last.date.slice(0, 7) < shiftMonth(thisMonth, -1)) continue;
    found.push({
      merchant: last.merchant,
      category: last.category || null,
      paise: -last.amountPaise,
      day,
      months: months.size,
      lastDate: last.date,
      paidThisMonth: last.date.slice(0, 7) === thisMonth,
      varies: Math.max(...amounts) > 1.05 * Math.min(...amounts),
    });
  }
  return found.sort((a, b) => a.day - b.day);
}

module.exports = { money, monthLabel, shiftMonth, totals, categoryTotals, merchantTotals, recurringPayments, groupIndian, inrValue };
