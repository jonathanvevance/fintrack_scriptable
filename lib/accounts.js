// Your own banks, kept in fintrack/data/accounts.json (private, never in the repo):
//   [{ "bank": "HSBC",
//      "account": { "last4": "6001", "name": "Savings", "upi": ["you@okhsbc"], "names": ["A KUMAR"] },   // or null
//      "cards": [{ "last4": "9012", "name": "Premier", "bills": ["HSBC CARD"] }] }]
// A self transfer moves money between your own accounts, so it is neither spent nor received:
//   - a card's "bill paid" SMS (CARD_BILL_TEMPLATES), always;
//   - paid to or received from one of your UPI IDs, or a name your account shows as when paid
//     ("names", e.g. SBI's "trf to A KUMAR"), the whole name;
//   - a NEFT naming one of your accounts, "A KUMAR (SBIN ··4321)": bank code and last digits;
//   - paid to a name containing one of your card bill names.
// Older lists have no "names"; that is the same as none.

const LAST4 = /^\d{4}$/;
const UPI_ID = /^[\w.\-]+@[\w.\-]+$/;
const CARD_BILL_TEMPLATES = ["hsbc-card-payment", "sbi-cc-payment"];
// Bank codes NEFT SMS use for the other account (IFSC prefixes and short names).
const BANK_CODES = { SBIN: "SBI", SBI: "SBI", HSBC: "HSBC", ICIC: "ICICI", ICICI: "ICICI" };
const OTHER_ACCOUNT = /\((\w+) ··(\d{3,4})\)$/;

function checkText(value, what, max) {
  if (typeof value !== "string" || value.length > max) throw new Error(`${what} must be text of at most ${max} characters`);
}

function checkList(list, what, test) {
  if (!Array.isArray(list)) throw new Error(`${what} must be a list`);
  list.forEach(test);
}

function checkName(value, what, max) {
  checkText(value, what, max);
  if (!value.trim()) throw new Error(`${what} is empty`);
}

/** Throws a readable message when the accounts list is malformed. */
function checkAccounts(banks) {
  const seen = new Set();
  checkList(banks, "accounts", (b) => {
    if (!b || typeof b !== "object") throw new Error("each bank must be an object");
    checkName(b.bank, "Bank name", 20);
    const key = b.bank.trim().toLowerCase();
    if (seen.has(key)) throw new Error(`${b.bank} is listed twice`);
    seen.add(key);
    if (b.account != null) {
      if (!LAST4.test(b.account.last4)) throw new Error(`${b.bank} account: last 4 digits must be 4 digits`);
      checkText(b.account.name || "", `${b.bank} account name`, 30);
      checkList(b.account.upi, `${b.bank} UPI IDs`, (id) => {
        if (typeof id !== "string" || !UPI_ID.test(id)) throw new Error(`${id} is not a UPI ID (like name@bank)`);
      });
      checkList(b.account.names || [], `${b.bank} names`, (name) => checkName(name, "Name shown when paid", 60));
    }
    checkList(b.cards || [], `${b.bank} cards`, (c) => {
      if (!c || !LAST4.test(c.last4)) throw new Error(`${b.bank} card: last 4 digits must be 4 digits`);
      checkText(c.name || "", `${b.bank} card name`, 30);
      checkList(c.bills, `${b.bank} card bill names`, (name) => checkName(name, "Bill name", 40));
    });
  });
}

// "HSBC Savings ··6001", "SBI ··5678".
function accountLabel(bank, item) {
  return [bank, item.name, "··" + item.last4].filter(Boolean).join(" ");
}

const plain = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Returns a matcher: tx -> null, or why it is a self transfer, { kind, match, label }:
 *   card: { match: "HSBC Card ··9012", label: "HSBC Premier ··9012" }   (label "" if the card isn't listed)
 *   upi:  { match: "you@okhsbc", label: "HSBC Savings ··6001" }
 *   name: { match: "A KUMAR", label: "HSBC Savings ··6001" }
 *   neft: { match: "SBIN ··4321", label: "SBI Savings ··4321" }
 *   bill: { match: "SBI CARDS", label: "SBI Cashback ··5678" }
 */
function compileAccounts(banks) {
  const exact = new Map();
  const bills = [];
  for (const b of banks) {
    if (b.account) {
      const label = accountLabel(b.bank, b.account);
      for (const id of b.account.upi) exact.set(plain(id), { kind: "upi", match: id, label });
      for (const name of b.account.names || []) exact.set(plain(name), { kind: "name", match: name, label });
    }
    for (const c of b.cards || []) for (const name of c.bills) bills.push({ lower: plain(name), match: name, label: accountLabel(b.bank, c) });
  }
  const ownAccount = (code, digits) => {
    const bank = BANK_CODES[code.toUpperCase()];
    const b = bank && banks.find((x) => x.bank.toUpperCase() === bank && x.account && x.account.last4.endsWith(digits));
    return b ? accountLabel(b.bank, b.account) : null;
  };
  const ownCard = (tx) => {
    const b = banks.find((x) => x.bank.toUpperCase() === String(tx.bank).toUpperCase());
    const c = b && (b.cards || []).find((card) => !tx.card || card.last4 === tx.card);
    return c ? accountLabel(b.bank, c) : "";
  };
  return (tx) => {
    if (CARD_BILL_TEMPLATES.includes(tx.template)) return { kind: "card", match: tx.merchant || "", label: ownCard(tx) };
    const name = plain(tx.merchant);
    if (!name) return null;
    if (exact.has(name)) return exact.get(name);
    const other = String(tx.merchant).match(OTHER_ACCOUNT);
    const label = other && ownAccount(other[1], other[2]);
    if (label) return { kind: "neft", match: `${other[1]} ··${other[2]}`, label };
    const bill = tx.amountPaise < 0 && bills.find((b) => name.includes(b.lower));
    return bill ? { kind: "bill", match: bill.match, label: bill.label } : null;
  };
}

module.exports = { checkAccounts, compileAccounts, accountLabel };
