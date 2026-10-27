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

// Totals per currency: { INR: { out, in, count }, USD: {...} }. Transfers are left out.
function totals(transactions) {
  const out = {};
  for (const t of transactions) {
    if (t.kind === "transfer") continue;
    const c = (out[t.currency] = out[t.currency] || { out: 0, in: 0, count: 0 });
    if (t.amountPaise < 0) c.out += -t.amountPaise;
    else c.in += t.amountPaise;
    c.count += 1;
  }
  return out;
}

module.exports = { money, monthLabel, shiftMonth, totals, groupIndian };
