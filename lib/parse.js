// Turns one bank SMS into a transaction, or null if it isn't one.
// Pure JavaScript with no Scriptable APIs, so tests can run it in plain JavaScriptCore.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const AMOUNT = "(\\d[\\d,]*(?:\\.\\d{1,2})?)";

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
  m = s.match(/^(\d{1,2})[\s\-\/]?([A-Za-z]{3})[a-z]*[\s\-,\/]*(\d{2}|\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? isoDate(fullYear(m[3]), month, parseInt(m[1], 10)) : null;
  }
  return null;
}

// "26OCT" has no year: take the year of `received` ("YYYY-MM-DD"), or the year before when that
// date would be after it (a December SMS read in January).
function dayMonthDate(s, received) {
  const m = s.match(/^(\d{1,2})([A-Za-z]{3})$/);
  const month = m && MONTHS[m[2].toLowerCase()];
  if (!month) return parseDate(s);
  const year = Number(received.slice(0, 4));
  const date = isoDate(year, month, parseInt(m[1], 10));
  return date && date > received ? isoDate(year - 1, month, parseInt(m[1], 10)) : date;
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

// "123456***-001" -> "001": the digits after the mask, when only the last 3 are shown.
function tailDigits(s) {
  const m = (s || "").match(/(\d+)\D*$/);
  return m ? m[1].slice(-4) : null;
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
    id: "sbi-cc-spend",
    match: new RegExp(
      "(?:Rs\\.?|INR)\\s*" +
        AMOUNT +
        "\\s+spent on your SBI Credit Card ending\\s*(\\S+)\\s+at\\s+(.+?)\\s+on\\s+(\\d{1,2}/\\d{1,2}/\\d{2,4})",
      "i"
    ),
    build: (m) => ({
      bank: "SBI",
      accountType: "credit_card",
      account: last4(m[2]),
      merchant: clean(m[3]),
      currency: "INR",
      amountPaise: -toPaise(m[1]),
      date: parseDate(m[4]),
    }),
  },
  {
    // Monthly cashback on the SBI Card CASHBACK card. The SMS has no date or card number; the
    // received date is used.
    id: "sbi-cc-cashback",
    match: new RegExp("(?:Rs\\.?|INR)\\s*" + AMOUNT + "\\s+has been credited to your CASHBACK SBI Card account", "i"),
    build: (m) => ({
      bank: "SBI",
      accountType: "credit_card",
      account: null,
      merchant: "SBI Card Cashback",
      currency: "INR",
      amountPaise: toPaise(m[1]),
      date: null,
    }),
  },
  {
    // HSBC account payment (UPI and similar): "INR 1.00 is paid from HSBC account <acct> to <name> on
    // 28-Oct-26 with ref <ref>."
    id: "hsbc-account-paid",
    match: new RegExp(
      "(?:INR|Rs\\.?)\\s*" + AMOUNT + "\\s+is paid from HSBC account\\s*(\\S+)\\s+to\\s+(.+?)\\s+on\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})(?:\\s+with ref\\s*(\\w+))?",
      "i"
    ),
    build: (m) => ({
      bank: "HSBC",
      accountType: "bank",
      account: last4(m[2]),
      merchant: clean(m[3]),
      currency: "INR",
      amountPaise: -toPaise(m[1]),
      date: parseDate(m[4]),
      ref: m[5] || null,
    }),
  },
  {
    // Money received by UPI into an HSBC account: "Your HSBC Acc <acct> is credited for INR <amount> on
    // 28-Oct-26 from <upi id>. UPI Ref No <ref>". The sender's UPI ID becomes the name.
    id: "hsbc-upi-credit",
    match: new RegExp(
      "Your HSBC Acc\\s*(\\S+)\\s+is credited for\\s+(?:INR|Rs\\.?)\\s*" + AMOUNT +
        "\\s+on\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})\\s+from\\s+(.+?)\\.?\\s*UPI Ref No\\.?\\s*(\\w+)",
      "i"
    ),
    build: (m) => ({
      bank: "HSBC",
      accountType: "bank",
      account: last4(m[1]),
      merchant: clean(m[4]),
      currency: "INR",
      amountPaise: toPaise(m[2]),
      date: parseDate(m[3]),
      ref: m[5],
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
    }),
  },
  {
    // "HSBC: A/c <acct> is credited with INR <amount> + on 14OCT at 12.35.54 with UTR <utr> as NEFT
    // from CITI A/c ***<last-4> of <payer>*** . Your Avl Bal is ..."
    id: "hsbc-neft-in",
    match: new RegExp(
      "HSBC[\\s\\S]*?A/c\\s*(\\S+)\\s+is credited with\\s+(?:INR|Rs\\.?)\\s*" + AMOUNT +
        "\\s*\\+?\\s+on\\s+(\\d{1,2}[A-Za-z]{3}(?:\\d{2,4})?)\\b[\\s\\S]*?(?:with UTR\\s*(\\w+)\\s+)?as\\s+(?:NEFT|IMPS|RTGS)\\s+from\\s+(\\w+)\\s+A/c\\s*(\\S+)\\s+of\\s+(.+?)[\\s*]*\\.\\s*Your Avl",
      "i"
    ),
    build: (m, received) => ({
      bank: "HSBC",
      accountType: "bank",
      account: tailDigits(m[1]),
      merchant: `${clean(m[7])} (${m[5]} ··${last4(m[6])})`,
      currency: "INR",
      amountPaise: toPaise(m[2]),
      date: dayMonthDate(m[3], received),
      ref: m[4] || null,
    }),
  },
  {
    // "HSBC: Dear Customer, your HSBC A/c <acct> has been debited with INR <amount>- on 26OCT as
    // payment towards card ending with <last-4> ." Paying a card bill: a self transfer.
    id: "hsbc-card-payment",
    match: new RegExp(
      "your HSBC A/c\\s*(\\S+)\\s+has been debited with\\s+(?:INR|Rs\\.?)\\s*" + AMOUNT +
        "\\s*-?\\s+on\\s+(\\d{1,2}[A-Za-z]{3}(?:\\d{2,4})?)\\s+as payment towards card ending with\\s*(\\d{4})",
      "i"
    ),
    build: (m, received) => ({
      bank: "HSBC",
      accountType: "bank",
      account: tailDigits(m[1]),
      merchant: `HSBC Card ··${m[4]}`,
      card: m[4],
      currency: "INR",
      amountPaise: -toPaise(m[2]),
      date: dayMonthDate(m[3], received),
    }),
  },
  {
    // "We have received payment of Rs.<amount> via BBPS & the same has been credited to your SBI
    // Credit Card." Older ones add "SBI Card no XXXXNN on DD-mon-YY". Paying a card bill: a self transfer.
    id: "sbi-cc-payment",
    match: new RegExp(
      "We have received payment of\\s+(?:Rs\\.?|INR)\\s*" + AMOUNT +
        "\\s+via\\s+(.+?)\\s+(?:&|and)\\s+(?:the\\s+)?same has been credited to your SBI (?:Credit )?Card(?:\\s+no\\.?\\s*([X\\d]+))?(?:\\s+on\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4}))?",
      "i"
    ),
    build: (m) => ({
      bank: "SBI",
      accountType: "credit_card",
      account: m[3] ? tailDigits(m[3]) : null,
      merchant: `Bill payment via ${clean(m[2])}`,
      currency: "INR",
      amountPaise: toPaise(m[1]),
      date: parseDate(m[4]),
    }),
  },
  {
    // "HDFC Bank Cardmember, Online Payment of Rs.<amount> vide Ref# <ref> was credited to your card
    // ending <last-4> On 28/OCT/2026_value Date 28/OCT/2026". Paying a card bill: a self transfer.
    id: "hdfc-cc-payment",
    match: new RegExp(
      "HDFC Bank Cardmember,?\\s+(.+?)\\s+of\\s+(?:Rs\\.?|INR)\\s*" + AMOUNT +
        "(?:\\s+vide Ref#\\s*(\\w+))?\\s+was credited to your card ending\\s*(\\d{4})(?:\\s+On\\s+(\\d{1,2}/[A-Za-z]{3}/\\d{2,4}))?",
      "i"
    ),
    build: (m) => ({
      bank: "HDFC",
      accountType: "credit_card",
      account: m[4],
      card: m[4],
      merchant: "Card bill payment",
      currency: "INR",
      amountPaise: toPaise(m[2]),
      date: parseDate(m[5]),
      ref: m[3] || null,
    }),
  },
];

// Banks truncate merchant names ("AMAZONPAYINDIAPRIVA"); map known prefixes to a readable name.
const MERCHANT_NAMES = [[/^AMAZON/i, "Amazon"]];

function merchantName(raw) {
  if (!raw) return raw;
  const hit = MERCHANT_NAMES.find(([re]) => re.test(raw));
  return hit ? hit[1] : raw;
}

// Reminders, requests, declines and OTPs. Anti-fraud footers ("Never share your OTP") must not match.
const NOT_A_TRANSACTION = new RegExp(
  [
    "\\bis (?:your|the) OTP\\b|\\bOTP (?:is|for)\\b|one[- ]time password",
    "\\b(?:will|to|shall|would) (?:not )?be (?:auto[- ]?)?(?:debited|charged|credited|deducted|processed)\\b",
    "\\bscheduled\\b|\\bupcoming\\b",
    "\\b(?:declined|failed|unsuccessful|not processed|rejected)\\b",
    "has requested|request(?:ed)? (?:money|payment)",
    "is due|payment due|minimum (?:amount )?due",
  ].join("|"),
  "i"
);
const CREDIT_WORDS = /\b(credited|received|refund(?:ed)?|deposited|reversed|reversal)\b/i;
const REVERSAL = /\b(?:revers(?:ed|al)|credited back|refunded)\b/i;
// "credited to the beneficiary / payee / VPA / SBIN A/c" is the other party's side: money out.
const PAYEE_CREDITED = /credited to (?:[Tt]he )?(?:[Bb]eneficiary|[Pp]ayee|VPA\b|(?!YOUR\b)[A-Z]{4} A\/c)/;
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

function isMoneyIn(text, isCredit, isDebit) {
  if (REVERSAL.test(text)) return true;
  if (PAYEE_CREDITED.test(text)) return false;
  if (!isDebit) return isCredit;
  // "debited ...; X credited" is money out, so whichever word comes first decides.
  return isCredit && text.search(CREDIT_WORDS) < text.search(DEBIT_WORDS);
}

function generic(text) {
  if (NOT_A_TRANSACTION.test(text)) return null;
  const isCredit = CREDIT_WORDS.test(text);
  const isDebit = DEBIT_WORDS.test(text);
  if (!isCredit && !isDebit) return null;
  const amount = text.match(NEAR_KEYWORD) || text.match(CURRENCY_AMOUNT);
  if (!amount) return null;
  const paise = toPaise(amount[1]);
  if (!Number.isFinite(paise)) return null;
  const date = text.match(ANY_DATE);
  const account = text.match(ACCOUNT);
  const bank = BANKS.find((b) => new RegExp("\\b" + b + "\\b", "i").test(text)) || null;
  const credit = isMoneyIn(text, isCredit, isDebit);
  return {
    bank,
    accountType: /credit card/i.test(text) ? "credit_card" : "bank",
    account: account ? last4(account[1]) : null,
    merchant: null,
    currency: "INR",
    amountPaise: (credit ? 1 : -1) * paise,
    date: date ? parseDate(date[1]) : null,
  };
}

/**
 * Parses one SMS. Example input:
 *   "HSBC Credit Card xxxxxx1234 used at AMAZON for [USD 52.78] on 19/10/26. Avl limit INR 1,23,456.78; ..."
 * Returns { template, confidence, bank, accountType, account, merchant, currency,
 * amountPaise (negative is money out), date ("YYYY-MM-DD"), ref? } or null.
 */
function parseSms(text, receivedAt) {
  const sms = clean(String(text || ""));
  if (!sms) return null;
  const fallbackDate = localIsoDate(receivedAt || new Date());
  for (const t of TEMPLATES) {
    const m = sms.match(t.match);
    if (m) {
      const tx = t.build(m, fallbackDate);
      const merchant = merchantName(tx.merchant);
      const raw = merchant !== tx.merchant ? { merchantRaw: tx.merchant } : {};
      return { template: t.id, confidence: "high", ...tx, merchant, ...raw, date: tx.date || fallbackDate };
    }
  }
  const tx = generic(sms);
  if (!tx) return null;
  return { template: "generic", confidence: "low", ...tx, date: tx.date || fallbackDate };
}

module.exports = { parseSms, parseDate, toPaise };
