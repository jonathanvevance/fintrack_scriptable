// Run from the repo root: jsc tests/run.js
// jsc is macOS's JavaScriptCore shell (the engine Scriptable uses):
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc

function load(path) {
  const module = { exports: {}, filename: path };
  new Function("module", "exports", readFile(path))(module, module.exports);
  return module.exports;
}

const { parseSms, parseDate } = load("lib/parse.js");
const { money, shiftMonth, totals, categoryTotals, merchantTotals, recurringPayments } = load("lib/format.js");
const { compileRules, tagsFor, tagAll, describeRule, patternWords, isPlainPattern, recipientPattern } = load("lib/tags.js");

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
    name: "HSBC NEFT to own SBI account is money out",
    sms: "HSBC: Dear HSBC Customer, your NEFT transaction with reference number HSBCN26290123456 for INR 25,000.00 has been credited to the SBIN A/c XXXXXXX4321 of ARJUN MEHTA on 17-10-2026 at 16:08:02 .",
    expect: { template: "hsbc-neft-out", bank: "HSBC", accountType: "bank", account: null, merchant: "ARJUN MEHTA (SBIN ··4321)", currency: "INR", amountPaise: -2500000, date: "2026-10-17" },
  },
  {
    name: "HSBC NEFT to someone else is money out",
    sms: "HSBC: Dear HSBC Customer, your NEFT transaction with reference number HSBCN26290999999 for INR 8000 has been credited to the HDFC A/c XXXX1111 of ANITA SHARMA on 20-10-2026 at 09:00:00 .",
    expect: { template: "hsbc-neft-out", bank: "HSBC", accountType: "bank", account: null, merchant: "ANITA SHARMA (HDFC ··1111)", currency: "INR", amountPaise: -800000, date: "2026-10-20" },
  },
  {
    name: "SBI card spend at Amazon",
    sms: "Rs.1,234.00 spent on your SBI Credit Card ending 5678 at AMAZONPAYINDIAPRIVA on 21/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute",
    keys: KEYS.concat(["merchantRaw"]),
    expect: { template: "sbi-cc-spend", bank: "SBI", accountType: "credit_card", account: "5678", merchant: "Amazon", currency: "INR", amountPaise: -123400, date: "2026-10-21", merchantRaw: "AMAZONPAYINDIAPRIVA" },
  },
  {
    name: "SBI card spend elsewhere keeps the bank's merchant name",
    sms: "Rs.89.00 spent on your SBI Credit Card ending 5678 at UBER INDIA SYSTEMS on 22/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute",
    expect: { template: "sbi-cc-spend", bank: "SBI", accountType: "credit_card", account: "5678", merchant: "UBER INDIA SYSTEMS", currency: "INR", amountPaise: -8900, date: "2026-10-22" },
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

const genericCases = [
  {
    name: "comma right after 'debited' still finds the amount",
    sms: "Rs 500.00 debited, A/c XX1234 on 27-10-26. Not you? Call 18002586161 -HDFC Bank",
    amountPaise: -50000,
  },
  {
    name: "comma right after 'credited' still finds the amount",
    sms: "Your A/c XX1234 is credited, INR 2,000.00 on 27-10-26 by NEFT. -Axis Bank",
    amountPaise: 200000,
  },
  {
    name: "debited before credited is money out",
    sms: "Rs 1,000 debited from A/c XX1234 and credited to abc@ybl on 27-10-26 -HDFC",
    amountPaise: -100000,
  },
  {
    name: "credited before debited is money in",
    sms: "Rs 500.00 credited to A/c XX1234 from rahul@okaxis on 27-10-26. Debited from sender's bank. -HDFC",
    amountPaise: 50000,
  },
  {
    name: "IMPS credited to beneficiary is money out",
    sms: "IMPS of Rs 5,000.00 from A/c XX1234 credited to beneficiary A/c XX9999 on 27-10-26. -Kotak Bank",
    amountPaise: -500000,
  },
  {
    name: "reworded HSBC NEFT credited to SBIN A/c is money out",
    sms: "HSBC: Your NEFT txn with ref no HSBCN1 for INR 25,000.00 has been credited to the SBIN A/c XXXX4321 of ARJUN MEHTA on 17-10-2026.",
    amountPaise: -2500000,
  },
  {
    name: "credited to your A/c is money in",
    sms: "INR 2,000.00 credited to your A/c XX1234 on 27-10-26 by UPI. -ICICI Bank",
    amountPaise: 200000,
  },
  {
    name: "reversal is money in",
    sms: "Rs.500 debited from A/c XX5678 on 20-10-26 has been reversed and credited back to your account. -HDFC Bank",
    amountPaise: 50000,
  },
  {
    name: "real debit with an OTP safety footer is kept",
    sms: "Rs.250.00 debited from A/c XX5678 on 27-10-26 to VPA swiggy@ybl. Never share your OTP with anyone. -HDFC Bank",
    amountPaise: -25000,
  },
];
for (const c of genericCases) eq(c.name, pick(parseSms(c.sms, RECEIVED), ["template", "amountPaise"]), { template: "generic", amountPaise: c.amountPaise });

const notTransactions = [
  ["OTP", "123456 is your OTP for txn of INR 500.00 at AMAZON. Do not share. -HDFC Bank"],
  ["future debit", "Rs 299.00 will be debited from your ICICI Bank Savings Account XX246 on 21-Oct-26 towards Google for GOOGLE AutoPay"],
  ["future auto-debit", "Your SIP of Rs 1,500 will be auto-debited from A/c XX1234 on 05-11-26. -Axis Bank"],
  ["future charge", "Your HSBC Credit Card XX1234 will be charged INR 649.00 for the annual fee on 05/11/26."],
  ["conditional debit", "Rs 649 will not be debited if balance is low on 05-11-26. -SBI"],
  ["scheduled debit", "Standing instruction: Rs 2,500 scheduled to be debited from A/c XX1234 on 01-11-26. -HDFC Bank"],
  ["cashback promise", "Cashback of Rs 500 will be credited to your A/c XX1234 within 7 days. -ICICI Bank"],
  ["declined", "Txn of Rs 500.00 on HDFC Bank Card XX1234 at AMAZON declined due to insufficient balance."],
  ["collect request", "RAHUL has requested money of Rs.200 from you; amount will be debited on approval. -SBI"],
  ["bill reminder", "Total due Rs 12,345 is due on 05/11/26. Paid already? Ignore. -HSBC"],
  ["minimum due", "Your card statement: minimum due Rs 620; spent Rs 12,345 this cycle. -SBI Card"],
];
for (const [name, sms] of notTransactions) eq(`${name} is not a transaction`, parseSms(sms, RECEIVED), null);

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
  ]),
  { INR: { out: 100, in: 300, count: 2 }, USD: { out: 50, in: 0, count: 1 } }
);

const rules = compileRules(JSON.parse(readFile("rules.example.json")));
const tx = (fields) => ({ merchant: null, raw: "", bank: "SBI", template: "generic", account: null, currency: "INR", amountPaise: -100, ...fields });
const tagged = (fields) => tagsFor(rules, tx(fields));
eq("rule matches merchant pattern", tagged({ merchant: "SWIGGY" }), { category: "Food" });
eq("direction condition excludes money in", tagged({ merchant: "Swiggy", amountPaise: 100 }).category, null);
eq("cashback from text and direction", tagged({ raw: "Rs. 599 credited to your CASHBACK SBI Card", amountPaise: 59900 }).category, "Cashback");
eq("minAmount is in rupees", tagsFor(compileRules([{ when: { minAmount: 10000 }, set: { category: "Big" } }]), tx({ amountPaise: -999900 })).category, null);
eq("old owner/tags-only rules are skipped", tagsFor(compileRules([
  { when: { account: "1234" }, set: { owner: "Partner", tags: ["x"] } },
  { when: { account: "1234" }, set: { category: "Travel" } },
]), tx({ account: "1234" })), { category: "Travel" });
eq("first matching rule wins", tagsFor(compileRules([
  { when: { merchant: "^Amazon$" }, set: { category: "Shopping" } },
  { when: { merchant: "amazon" }, set: { category: "Other" } },
]), tx({ merchant: "Amazon" })).category, "Shopping");
eq("manual value beats rules", tagged({ merchant: "Swiggy", manual: { category: "Party" } }).category, "Party");
eq("empty rules tag nothing", tagsFor(compileRules([]), tx({})), { category: null });
eq("tagAll leaves stored list unchanged", (() => {
  const list = [tx({ merchant: "Zomato" })];
  return [tagAll(rules, list)[0].category, list[0].category];
})(), ["Food", undefined]);
const compileError = (r) => { try { compileRules(r); return null; } catch (e) { return e.message; } };
eq("unknown condition is rejected", compileError([{ when: { merchnat: "x" } }]), 'rules.json rule 1: unknown condition "merchnat"');
eq("bad direction is rejected", compileError([{}, { when: { direction: "both" } }]), 'rules.json rule 2: direction must be "in" or "out", got both');

const rupees = (n) => money(n * 100);
eq("describe merchant pattern", describeRule({ when: { direction: "out", merchant: "swiggy|zomato" }, set: { category: "Food" } }, rupees), 'Money out, recipient contains "swiggy" or "zomato" → Food');
eq("describe exact merchant from Always tag", describeRule({ when: { merchant: "^AMAZON\\.IN$" }, set: { category: "Shopping" } }, rupees), 'Recipient is "AMAZON.IN" → Shopping');
eq("describe text and account", describeRule({ when: { text: "cashback", account: "1234" }, set: { category: "Cashback" } }, rupees), 'SMS mentions "cashback", account ··1234 → Cashback');
eq("describe amount range", describeRule({ when: { minAmount: 100, maxAmount: 10000 }, set: { category: "Mid" } }, rupees), "₹100 to ₹10,000 → Mid");
eq("describe minimum only", describeRule({ when: { direction: "out", minAmount: 10000 }, set: { category: "Large" } }, rupees), "Money out, ₹10,000 or more → Large");
eq("describe old owner/tags rule", describeRule({ when: { account: "1234" }, set: { owner: "Wife" } }, rupees), "Account ··1234 → nothing");

eq("plain: exact names", isPlainPattern("^Jio Prepaid Rech$|^AIRTEL$"), true);
eq("plain: partial names", isPlainPattern("swiggy|zomato"), true);
eq("plain: escaped dot is still a name", isPlainPattern("^AMAZON\\.IN$"), true);
eq("not plain: wildcard", isPlainPattern("^AMZN.*"), false);
eq("not plain: mixed exact and partial", isPlainPattern("^Amazon$|flipkart"), false);
eq("not plain: empty alternative", isPlainPattern("swiggy|"), false);
eq("recipientPattern exact escapes", recipientPattern(["AMAZON.IN", "Jio (Prepaid)"], true), "^AMAZON\\.IN$|^Jio \\(Prepaid\\)$");
eq("recipientPattern partial", recipientPattern(["swiggy", "zomato"], false), "swiggy|zomato");
eq("recipientPattern round trip", patternWords(recipientPattern(["A.B", "C+D"], true)), { exact: true, words: ["A.B", "C+D"] });
eq("recipientPattern matches literally", new RegExp(recipientPattern(["A.B"], true), "i").test("AXB"), false);
eq("describe empty rule", describeRule({}), "Every transaction → nothing");

eq(
  "categoryTotals sums INR money out, largest first, untagged as null",
  categoryTotals([
    { currency: "INR", amountPaise: -500, category: "Food" },
    { currency: "INR", amountPaise: -300, category: "Food" },
    { currency: "INR", amountPaise: -1000, category: null },
    { currency: "INR", amountPaise: 9999, category: "Cashback" },
    { currency: "USD", amountPaise: -5000, category: "Food" },
    { currency: "INR", amountPaise: -200 },
  ]),
  [{ category: null, paise: 1200 }, { category: "Food", paise: 800 }]
);

eq(
  "merchantTotals sums INR money out per merchant, most common category, largest first",
  merchantTotals([
    { currency: "INR", amountPaise: -500, merchant: "Swiggy", category: "Food" },
    { currency: "INR", amountPaise: -300, merchant: "Swiggy", category: null },
    { currency: "INR", amountPaise: -200, merchant: "Swiggy", category: "Food" },
    { currency: "INR", amountPaise: -1500, bank: "SBI" },
    { currency: "INR", amountPaise: 900, merchant: "Swiggy" },
    { currency: "USD", amountPaise: -999, merchant: "OpenAI" },
  ]),
  [
    { merchant: "SBI", paise: 1500, count: 1, category: null },
    { merchant: "Swiggy", paise: 1000, count: 3, category: "Food" },
  ]
);

const pay = (merchant, date, rupeesOut, category = null) => ({ currency: "INR", amountPaise: -rupeesOut * 100, merchant, date, category });
const recurring = (list, today = "2026-10-28") => recurringPayments(list, today).map((r) => r.merchant);
eq(
  "recurring: monthly, same day and amount, paid this month",
  recurringPayments([pay("Netflix", "2026-08-03", 649), pay("Netflix", "2026-09-03", 649), pay("Netflix", "2026-10-04", 649, "Subscriptions")], "2026-10-28"),
  [{ merchant: "Netflix", category: "Subscriptions", paise: 64900, day: 3, months: 3, lastDate: "2026-10-04", paidThisMonth: true, varies: false }]
);
eq("recurring: last paid last month is still upcoming", recurringPayments([pay("Airtel", "2026-08-12", 999), pay("Airtel", "2026-09-12", 999)], "2026-10-05")[0].paidThisMonth, false);
eq("recurring: one month is not enough", recurring([pay("Netflix", "2026-10-03", 649)]), []);
eq("recurring: frequent merchant is not a bill", recurring([pay("Swiggy", "2026-09-02", 300), pay("Swiggy", "2026-09-09", 320), pay("Swiggy", "2026-10-02", 310), pay("Swiggy", "2026-10-15", 290)]), []);
eq("recurring: amount changes too much", recurring([pay("Amazon", "2026-09-05", 500), pay("Amazon", "2026-10-05", 1500)]), []);
eq("recurring: day moves too much", recurring([pay("Uber", "2026-09-02", 200), pay("Uber", "2026-10-20", 200)]), []);
eq("recurring: stopped two months ago", recurring([pay("Hotstar", "2026-06-10", 299), pay("Hotstar", "2026-07-10", 299), pay("Hotstar", "2026-08-10", 299)]), []);
eq("recurring: bill that varies a little", recurringPayments([pay("BESCOM", "2026-09-18", 1700), pay("BESCOM", "2026-10-17", 1900)], "2026-10-28")[0].varies, true);
eq("recurring: sorted by day", recurring([pay("B", "2026-09-20", 10), pay("B", "2026-10-20", 10), pay("A", "2026-09-02", 10), pay("A", "2026-10-02", 10)]), ["A", "B"]);

print(failures ? `[PROGRESS] ${failures}/${count} tests failed` : `[PROGRESS] All ${count} tests passed`);
if (failures) throw new Error("tests failed");
