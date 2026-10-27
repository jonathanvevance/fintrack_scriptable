// Run from the repo root: jsc tests/run.js
// jsc is macOS's JavaScriptCore shell (the engine Scriptable uses):
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc

function load(path) {
  const module = { exports: {}, filename: path };
  new Function("module", "exports", readFile(path))(module, module.exports);
  return module.exports;
}

const { parseSms, parseDate } = load("lib/parse.js");
const { money, shiftMonth, totals } = load("lib/format.js");

let failures = 0;
let count = 0;
function eq(name, actual, expected) {
  count++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    print(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  }
}

function pick(tx, keys) {
  if (!tx) return tx;
  const out = {};
  keys.forEach((k) => (out[k] = tx[k]));
  return out;
}

const RECEIVED = new Date(2026, 9, 27, 12, 0, 0);
const KEYS = ["template", "bank", "accountType", "account", "merchant", "currency", "amountPaise", "date"];

const cases = [
  {
    name: "HSBC card spend in USD",
    sms: "HSBC Credit Card xxxxxx1234 used at OPENAI *CHATGPT SUBSCR I for [USD 52.78] on 19/10/26. Avl limit INR 1,23,456.78; due 05/11/26. Call 18002673456 to report fraud.",
    expect: { template: "hsbc-cc-spend", bank: "HSBC", accountType: "credit_card", account: "1234", merchant: "OPENAI *CHATGPT SUBSCR I", currency: "USD", amountPaise: -5278, date: "2026-10-19" },
  },
  {
    name: "HSBC card spend in INR without brackets",
    sms: "HSBC Credit Card xxxxxx9876 used at SWIGGY for INR 1,249.00 on 26/10/26. Avl limit INR 50,000.00; due 05/11/26. Call 18002673456 to report fraud.",
    expect: { template: "hsbc-cc-spend", bank: "HSBC", accountType: "credit_card", account: "9876", merchant: "SWIGGY", currency: "INR", amountPaise: -124900, date: "2026-10-26" },
  },
  {
    name: "SBI UPI debit",
    sms: "Dear UPI user A/C X4321 debited by 30000.00 on date 27Oct26 trf to RAHUL KUMAR Refno 630012345678 If not u? call-1800111109 for other services-18001234-SBI",
    expect: { template: "sbi-upi-debit", bank: "SBI", accountType: "bank", account: "4321", merchant: "RAHUL KUMAR", currency: "INR", amountPaise: -3000000, date: "2026-10-27" },
  },
  {
    name: "SBI UPI debit with decimals and multi-line",
    sms: "Dear UPI user A/C X4321 debited by 45.5 on date 3Nov26 trf to Swiggy\nRefno 630099999999 If not u? call-1800111109 for other services-18001234-SBI",
    expect: { template: "sbi-upi-debit", bank: "SBI", accountType: "bank", account: "4321", merchant: "Swiggy", currency: "INR", amountPaise: -4550, date: "2026-11-03" },
  },
  {
    name: "ICICI UPI debit",
    sms: "ICICI Bank Acct XX246 debited for Rs 1.00 on 27-Oct-26; PRIYA NAIR credited. UPI:630012345678. Call 18002662 for dispute. SMS BLOCK 246 to 9215676766",
    expect: { template: "icici-upi-debit", bank: "ICICI", accountType: "bank", account: "246", merchant: "PRIYA NAIR", currency: "INR", amountPaise: -100, date: "2026-10-27" },
  },
  {
    name: "ICICI UPI debit with thousands",
    sms: "ICICI Bank Acct XX246 debited for Rs 12,500.50 on 3-Nov-26; Zomato Ltd credited. UPI:630099998888. Call 18002662 for dispute. SMS BLOCK 246 to 9215676766",
    expect: { template: "icici-upi-debit", bank: "ICICI", accountType: "bank", account: "246", merchant: "Zomato Ltd", currency: "INR", amountPaise: -1250050, date: "2026-11-03" },
  },
  {
    name: "ICICI AutoPay account debit",
    sms: "Rs 299.00 debited from ICICI Bank Savings Account XX246 on 21-Oct-26 towards Google for GOOGLE AutoPay Retrieval Ref No.629412345678",
    expect: { template: "icici-account-debit", bank: "ICICI", accountType: "bank", account: "246", merchant: "Google", currency: "INR", amountPaise: -29900, date: "2026-10-21" },
  },
  {
    name: "ICICI account debit without 'for' clause",
    sms: "Rs 1,499.00 debited from ICICI Bank Savings Account XX246 on 2-Nov-26 towards Netflix Retrieval Ref No.629400001111",
    expect: { template: "icici-account-debit", bank: "ICICI", accountType: "bank", account: "246", merchant: "Netflix", currency: "INR", amountPaise: -149900, date: "2026-11-02" },
  },
  {
    name: "HSBC NEFT to own SBI account is an outgoing transfer",
    sms: "HSBC: Dear HSBC Customer, your NEFT transaction with reference number HSBCN26290123456 for INR 25,000.00 has been credited to the SBIN A/c XXXXXXX4321 of ARJUN MEHTA on 17-10-2026 at 16:08:02 .",
    keys: KEYS.concat(["kind"]),
    expect: { template: "hsbc-neft-out", bank: "HSBC", accountType: "bank", account: null, merchant: "ARJUN MEHTA (SBIN ··4321)", currency: "INR", amountPaise: -2500000, date: "2026-10-17", kind: "transfer" },
  },
  {
    name: "HSBC NEFT to someone else is spending",
    sms: "HSBC: Dear HSBC Customer, your NEFT transaction with reference number HSBCN26290999999 for INR 8000 has been credited to the HDFC A/c XXXX1111 of ANITA SHARMA on 20-10-2026 at 09:00:00 .",
    keys: KEYS.concat(["kind"]),
    expect: { template: "hsbc-neft-out", bank: "HSBC", accountType: "bank", account: null, merchant: "ANITA SHARMA (HDFC ··1111)", currency: "INR", amountPaise: -800000, date: "2026-10-20", kind: undefined },
  },
  {
    name: "SBI UPI to self is a transfer",
    sms: "Dear UPI user A/C X4321 debited by 500.00 on date 27Oct26 trf to ARJUN MEHTA Refno 630000000001 If not u? call-1800111109 for other services-18001234-SBI",
    keys: ["template", "amountPaise", "kind"],
    expect: { template: "sbi-upi-debit", amountPaise: -50000, kind: "transfer" },
  },
  {
    name: "SBI AutoPay reminder is not a transaction",
    sms: "Dear UPI User, UPI AutoPay for Indian Clearing Corporation Ltd debit of Rs.5000.00 is scheduled on .16/10/26, abc123@yespay. Please ensure sufficient balance in your account. -SBI",
    expect: null,
  },
  {
    name: "generic credit falls back with low confidence",
    sms: "Dear SBI UPI User, ur A/cX4321 credited by Rs500 on 27Oct26 by (Ref no 630011112222)",
    expect: { template: "generic", bank: "SBI", accountType: "bank", account: "4321", merchant: null, currency: "INR", amountPaise: 50000, date: "2026-10-27" },
  },
  {
    name: "generic debit with Rs. and dashes in date",
    sms: "Rs.250.00 debited from A/c XX5678 on 27-10-26 to VPA swiggy@ybl. Not you? Call 18002586161 - HDFC Bank",
    expect: { template: "generic", bank: "HDFC", accountType: "bank", account: "5678", merchant: null, currency: "INR", amountPaise: -25000, date: "2026-10-27" },
  },
  {
    name: "generic without a date uses the received date",
    sms: "INR 1,000 spent on ICICI Bank Card XX1111 at AMAZON. Avl Lmt: INR 99,000",
    expect: { template: "generic", bank: "ICICI", accountType: "bank", account: "1111", merchant: null, currency: "INR", amountPaise: -100000, date: "2026-10-27" },
  },
];

for (const c of cases) eq(c.name, pick(parseSms(c.sms, RECEIVED), c.keys || KEYS), c.expect);

eq("OTP is ignored", parseSms("123456 is your OTP for txn of INR 500.00 at AMAZON. Do not share. -HDFC Bank", RECEIVED), null);
eq("collect request is ignored", parseSms("RAHUL has requested money of Rs.200 from you on Google Pay. Approve with UPI PIN. -SBI", RECEIVED), null);
eq("bill reminder is ignored", parseSms("Your HSBC Credit Card statement: total INR 12,345.00, minimum due INR 620.00, payment due 05/11/26.", RECEIVED), null);
eq("chat message is ignored", parseSms("See you at 7 for dinner?", RECEIVED), null);
eq("empty is ignored", parseSms("   ", RECEIVED), null);

eq("parseDate dd/mm/yyyy", parseDate("05/11/2026"), "2026-11-05");
eq("parseDate dd-Mon-yy", parseDate("27-Oct-26"), "2026-10-27");
eq("parseDate dd Mon yyyy", parseDate("1 Jan 2027"), "2027-01-01");
eq("parseDate rejects month 13", parseDate("01/13/26"), null);

eq("money INR grouping", money(-1234567890), "-₹1,23,45,678.90");
eq("money INR whole", money(50000), "₹500");
eq("money USD", money(-5278, "USD"), "-$52.78");
eq("money other currency", money(1000, "AED"), "AED 10");
eq("shiftMonth back over year", shiftMonth("2026-01", -1), "2025-12");
eq("shiftMonth forward", shiftMonth("2026-12", 1), "2027-01");
eq(
  "totals per currency",
  totals([
    { currency: "INR", amountPaise: -100 },
    { currency: "INR", amountPaise: 300 },
    { currency: "USD", amountPaise: -50 },
    { currency: "INR", amountPaise: -9999, kind: "transfer" },
  ]),
  { INR: { out: 100, in: 300, count: 2 }, USD: { out: 50, in: 0, count: 1 } }
);

print(failures ? `[PROGRESS] ${failures}/${count} tests failed` : `[PROGRESS] All ${count} tests passed`);
if (failures) throw new Error("tests failed");
