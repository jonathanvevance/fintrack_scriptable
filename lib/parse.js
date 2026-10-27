// Turns one bank SMS into a transaction, or null if it isn't one.
// Pure JavaScript with no Scriptable APIs, so tests can run it in plain JavaScriptCore.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const AMOUNT = "([\\d,]+(?:\\.\\d{1,2})?)";

// Payees that are the household itself; money sent to them is a transfer, not spending.
const SELF_NAMES = ["ARJUN MEHTA"];

function isSelf(name) {
  const n = (name || "").toUpperCase().replace(/\s+/g, " ").trim();
  return n.length >= 8 && SELF_NAMES.some((s) => s.startsWith(n) || n.startsWith(s));
}

function toPaise(amount) {
  const [rupees, fraction = ""] = amount.replace(/,/g, "").split(".");
  return parseInt(rupees, 10) * 100 + parseInt((fraction + "00").slice(0, 2), 10);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fullYear(y) {
  const n = parseInt(y, 10);
  return y.length === 2 ? 2000 + n : n;
}

function isoDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Accepts "19/10/26", "19-10-2026", "27Oct26", "27-Oct-26", "27 Oct 2026".
function parseDate(s) {
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (m) return isoDate(fullYear(m[3]), parseInt(m[2], 10), parseInt(m[1], 10));
  m = s.match(/^(\d{1,2})[\s\-]?([A-Za-z]{3})[a-z]*[\s\-,]*(\d{2}|\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? isoDate(fullYear(m[3]), month, parseInt(m[1], 10)) : null;
  }
  return null;
}

function localIsoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function last4(s) {
  const digits = (s || "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function clean(s) {
  return s ? s.replace(/\s+/g, " ").trim() : null;
}

// Known templates, tried in order. `match` must pin down the template tightly;
// anything looser belongs in the generic fallback below.
const TEMPLATES = [
  {
    id: "hsbc-cc-spend",
    match: new RegExp(
      "HSBC Credit Card\\s+(\\S+)\\s+used at\\s+(.+?)\\s+for\\s+\\[?\\s*([A-Z]{3})\\s*" +
        AMOUNT +
        "\\s*\\]?\\s+on\\s+(\\d{1,2}/\\d{1,2}/\\d{2,4})",
      "i"
    ),
    build: (m) => ({
      bank: "HSBC",
      accountType: "credit_card",
      account: last4(m[1]),
      merchant: clean(m[2]),
      currency: m[3].toUpperCase(),
      amountPaise: -toPaise(m[4]),
      date: parseDate(m[5]),
    }),
  },
  {
    id: "sbi-upi-debit",
    match: new RegExp(
      "A/C\\s*(\\S+)\\s+debited by\\s+(?:Rs\\.?|INR)?\\s*" +
        AMOUNT +
        "\\s+on date\\s+(\\S+)\\s+trf to\\s+(.+?)\\s+Ref\\s*no\\.?\\s*(\\w+)[\\s\\S]*SBI",
      "i"
    ),
    build: (m) => ({
      bank: "SBI",
      accountType: "bank",
      account: last4(m[1]),
      merchant: clean(m[4]),
      currency: "INR",
      amountPaise: -toPaise(m[2]),
      date: parseDate(m[3]),
      ref: m[5],
      ...(isSelf(m[4]) ? { kind: "transfer" } : {}),
    }),
  },
  {
    id: "icici-upi-debit",
    match: new RegExp(
      "ICICI Bank Acct\\s*(\\S+)\\s+debited for\\s+(?:Rs\\.?|INR)\\s*" +
        AMOUNT +
        "\\s+on\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4});\\s*(.+?)\\s+credited\\.?(?:\\s*UPI:\\s*(\\w+))?",
      "i"
    ),
    build: (m) => ({
      bank: "ICICI",
      accountType: "bank",
      account: last4(m[1]),
      merchant: clean(m[4]),
      currency: "INR",
      amountPaise: -toPaise(m[2]),
      date: parseDate(m[3]),
      ref: m[5] || null,
      ...(isSelf(m[4]) ? { kind: "transfer" } : {}),
    }),
  },
  {
    id: "icici-account-debit",
    match: new RegExp(
      "(?:Rs\\.?|INR)\\s*" +
        AMOUNT +
        "\\s+debited from ICICI Bank \\w+ Account\\s*(\\S+)\\s+on\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})\\s+towards\\s+(.+?)(?:\\s+for\\s+.+?)?(?:\\s+(?:Retrieval\\s+)?Ref\\s*No\\.?\\s*(\\w+)|\\.|$)",
      "i"
    ),
    build: (m) => ({
      bank: "ICICI",
      accountType: "bank",
      account: last4(m[2]),
      merchant: clean(m[4]),
      currency: "INR",
      amountPaise: -toPaise(m[1]),
      date: parseDate(m[3]),
      ref: m[5] || null,
    }),
  },
  {
    // HSBC confirming an outgoing NEFT: "credited to the <bank> A/c" is the payee's side.
    id: "hsbc-neft-out",
    match: new RegExp(
      "HSBC[\\s\\S]*?NEFT transaction with reference number\\s*(\\w+)\\s+for\\s+(?:INR|Rs\\.?)\\s*" +
        AMOUNT +
        "\\s+has been credited to the\\s+(\\w+)\\s+A/c\\s*(\\S+)\\s+of\\s+(.+?)\\s+on\\s+(\\d{1,2}-\\d{1,2}-\\d{4})",
      "i"
    ),
    build: (m) => ({
      bank: "HSBC",
      accountType: "bank",
      account: null,
      merchant: `${clean(m[5])} (${m[3]} ··${last4(m[4])})`,
      currency: "INR",
      amountPaise: -toPaise(m[2]),
      date: parseDate(m[6]),
      ref: m[1],
      ...(isSelf(m[5]) ? { kind: "transfer" } : {}),
    }),
  },
];

const NOT_A_TRANSACTION = /\bOTP\b|will be (?:debited|charged)|has requested|request(?:ed)? (?:money|payment)|is due|payment due|minimum (?:amount )?due/i;
const CREDIT_WORDS = /\b(credited|received|refund(?:ed)?|deposited)\b/i;
const DEBIT_WORDS = /\b(debited|spent|used|paid|withdrawn|purchase|txn of|charged)\b/i;
const NEAR_KEYWORD = new RegExp(
  "\\b(?:debited|credited|spent|paid|withdrawn|received|deposited|charged)\\b\\s*(?:by|with|for|of|from)?\\s*(?:(?:INR|Rs\\.?|₹)\\s*)?" +
    AMOUNT,
  "i"
);
const CURRENCY_AMOUNT = new RegExp("(?:INR|Rs\\.?|₹)\\s*" + AMOUNT, "i");
const ANY_DATE = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2})|\d{1,2}[\s\-]?[A-Za-z]{3}[\s\-,]*(?:\d{4}|\d{2}))\b/;
const ACCOUNT = /(?:A\/c|Acct|Account|Card)\s*(?:no\.?\s*)?(?:ending\s*(?:with)?\s*)?[xX*]*(\d{3,6})/i;
const BANKS = ["HSBC", "SBI", "HDFC", "ICICI", "Axis", "Kotak", "IDFC", "Yes Bank", "IndusInd", "AU Bank", "Federal", "Canara", "PNB", "BOB"];

function generic(text) {
  if (NOT_A_TRANSACTION.test(text)) return null;
  const isCredit = CREDIT_WORDS.test(text);
  const isDebit = DEBIT_WORDS.test(text);
  if (!isCredit && !isDebit) return null;
  const amount = text.match(NEAR_KEYWORD) || text.match(CURRENCY_AMOUNT);
  if (!amount) return null;
  const date = text.match(ANY_DATE);
  const account = text.match(ACCOUNT);
  const bank = BANKS.find((b) => new RegExp("\\b" + b + "\\b", "i").test(text)) || null;
  // "debited ...; X credited" is money out, so whichever word comes first decides.
  const credit = isCredit && !isDebit ? true : isCredit && text.search(CREDIT_WORDS) < text.search(DEBIT_WORDS);
  return {
    bank,
    accountType: /credit card/i.test(text) ? "credit_card" : "bank",
    account: account ? last4(account[1]) : null,
    merchant: null,
    currency: "INR",
    amountPaise: (credit ? 1 : -1) * toPaise(amount[1]),
    date: date ? parseDate(date[1]) : null,
  };
}

/**
 * Parses one SMS. Example input:
 *   "HSBC Credit Card xxxxxx1234 used at AMAZON for [USD 52.78] on 19/10/26. Avl limit INR 1,23,456.78; ..."
 * Returns { template, confidence, bank, accountType, account, merchant, currency,
 * amountPaise (negative is money out), date ("YYYY-MM-DD"), ref?, kind? ("transfer" when paid to SELF_NAMES) } or null.
 */
function parseSms(text, receivedAt) {
  const sms = clean(String(text || ""));
  if (!sms) return null;
  const fallbackDate = localIsoDate(receivedAt || new Date());
  for (const t of TEMPLATES) {
    const m = sms.match(t.match);
    if (m) {
      const tx = t.build(m);
      return { template: t.id, confidence: "high", ...tx, date: tx.date || fallbackDate };
    }
  }
  const tx = generic(sms);
  if (!tx) return null;
  return { template: "generic", confidence: "low", ...tx, date: tx.date || fallbackDate };
}

module.exports = { parseSms, parseDate, toPaise };
