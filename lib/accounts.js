// Your own banks, kept in fintrack/data/accounts.json (private, never in the repo):
//   [{ "bank": "HSBC",
//      "account": { "last4": "6001", "name": "Savings", "upi": ["you@okhsbc"] },   // or null
//      "cards": [{ "last4": "9012", "name": "Premier", "bills": ["HSBC CARD"] }] }]
// A self transfer moves money between your own accounts, so it is neither spent nor received:
// paid to or received from one of your UPI IDs, or paid to a name one of your card bills shows as.

const LAST4 = /^\d{4}$/;
const UPI_ID = /^[\w.\-]+@[\w.\-]+$/;

function checkText(value, what, max) {
  if (typeof value !== "string" || value.length > max) throw new Error(`${what} must be text of at most ${max} characters`);
}

function checkList(list, what, test) {
  if (!Array.isArray(list)) throw new Error(`${what} must be a list`);
  list.forEach(test);
}

/** Throws a readable message when the accounts list is malformed. */
function checkAccounts(banks) {
  const seen = new Set();
  checkList(banks, "accounts", (b) => {
    if (!b || typeof b !== "object") throw new Error("each bank must be an object");
    checkText(b.bank, "Bank name", 20);
    if (!b.bank.trim()) throw new Error("Bank name is empty");
    const key = b.bank.trim().toLowerCase();
    if (seen.has(key)) throw new Error(`${b.bank} is listed twice`);
    seen.add(key);
    if (b.account != null) {
      if (!LAST4.test(b.account.last4)) throw new Error(`${b.bank} account: last 4 digits must be 4 digits`);
      checkText(b.account.name || "", `${b.bank} account name`, 30);
      checkList(b.account.upi, `${b.bank} UPI IDs`, (id) => {
        if (typeof id !== "string" || !UPI_ID.test(id)) throw new Error(`${id} is not a UPI ID (like name@bank)`);
      });
    }
    checkList(b.cards || [], `${b.bank} cards`, (c) => {
      if (!c || !LAST4.test(c.last4)) throw new Error(`${b.bank} card: last 4 digits must be 4 digits`);
      checkText(c.name || "", `${b.bank} card name`, 30);
      checkList(c.bills, `${b.bank} card bill names`, (name) => {
        checkText(name, "Bill name", 40);
        if (!name.trim()) throw new Error("Bill name is empty");
      });
    });
  });
}

// "HSBC Savings ··6001", "SBI ··5678".
function accountLabel(bank, item) {
  return [bank, item.name, "··" + item.last4].filter(Boolean).join(" ");
}

/**
 * Returns a matcher: tx -> null, or why it is a self transfer:
 *   { kind: "upi", match: "you@okhsbc", label: "HSBC Savings ··6001" }
 *   { kind: "bill", match: "SBI CARDS", label: "SBI Cashback ··5678" }
 * UPI IDs must equal the name the SMS gives; bill names only need to appear in it (any case).
 */
function compileAccounts(banks) {
  const upi = new Map();
  const bills = [];
  for (const b of banks) {
    if (b.account) for (const id of b.account.upi) upi.set(id.toLowerCase(), { match: id, label: accountLabel(b.bank, b.account) });
    for (const c of b.cards || []) for (const name of c.bills) bills.push({ lower: name.toLowerCase(), match: name, label: accountLabel(b.bank, c) });
  }
  return (tx) => {
    const name = (tx.merchant || "").trim().toLowerCase();
    if (!name) return null;
    const mine = upi.get(name);
    if (mine) return { kind: "upi", ...mine };
    const bill = tx.amountPaise < 0 && bills.find((b) => name.includes(b.lower));
    return bill ? { kind: "bill", match: bill.match, label: bill.label } : null;
  };
}

module.exports = { checkAccounts, compileAccounts, accountLabel };
