// Tags transactions from rules kept as data in fintrack/data/rules.json (private, never in the repo).
// Example rule:
//   { "when": { "merchant": "swiggy|zomato", "direction": "out" }, "set": { "category": "Food" } }
// All conditions in "when" must hold, and the first matching rule sets the category.
// A category set by hand (tx.manual.category) beats rules. Older rules may also carry "owner"
// or "tags" in "set"; those are ignored.

const PATTERN_FIELDS = { merchant: (tx) => tx.merchant, text: (tx) => tx.raw, bank: (tx) => tx.bank, template: (tx) => tx.template };

function condition(key, value) {
  if (key in PATTERN_FIELDS) {
    const re = new RegExp(value, "i");
    const field = PATTERN_FIELDS[key];
    return (tx) => re.test(field(tx) || "");
  }
  if (key === "account") return (tx) => tx.account === String(value);
  if (key === "currency") return (tx) => tx.currency === value;
  if (key === "direction") {
    if (value !== "in" && value !== "out") throw new Error(`direction must be "in" or "out", got ${value}`);
    return (tx) => (tx.amountPaise > 0) === (value === "in");
  }
  if (key === "minAmount") return (tx) => Math.abs(tx.amountPaise) >= value * 100;
  if (key === "maxAmount") return (tx) => Math.abs(tx.amountPaise) <= value * 100;
  throw new Error(`unknown condition "${key}"`);
}

/** Turns rules into matchers once, so tagging a month is one cheap pass. Throws on a malformed rule. */
function compileRules(rules) {
  return rules.map((rule, i) => {
    try {
      const tests = Object.entries(rule.when || {}).map(([key, value]) => condition(key, value));
      return { matches: (tx) => tests.every((test) => test(tx)), set: rule.set || {} };
    } catch (e) {
      throw new Error(`rules.json rule ${i + 1}: ${e.message}`);
    }
  });
}

/** Returns { category } for one transaction; category is null when nothing matches. */
function tagsFor(compiled, tx) {
  if (tx.manual && tx.manual.category) return { category: tx.manual.category };
  const hit = compiled.find(({ matches, set }) => set.category && matches(tx));
  return { category: hit ? hit.set.category : null };
}

/** Tagged copies for display; the stored transactions are not changed. */
function tagAll(compiled, list) {
  return list.map((tx) => ({ ...tx, ...tagsFor(compiled, tx) }));
}

// "^Amazon$" -> { exact: true, words: ["Amazon"] }; "swiggy|zomato" -> { exact: false, words: [...] }.
function patternWords(pattern) {
  const parts = String(pattern).split("|");
  const exact = parts.every((p) => p.startsWith("^") && p.endsWith("$"));
  const words = parts.map((p) => p.replace(/^\^|\$$/g, "").replace(/\\(.)/g, "$1"));
  return { exact, words };
}

const META = /[\\^$.*+?()[\]{}|]/;
const escapeWord = (word) => word.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

// True when the pattern is only names, all exact ("^a$|^b$") or all partial ("a|b"), so the
// rule editor can show it as "is" / "contains" plus a list of names without changing its meaning.
function isPlainPattern(pattern) {
  const parts = String(pattern).split("|");
  const exact = parts.map((p) => p.startsWith("^") && p.endsWith("$") && p.length > 1);
  if (exact.some((e) => e !== exact[0])) return false;
  return parts.every((p, i) => {
    const body = exact[i] ? p.slice(1, -1) : p;
    return body.length > 0 && !META.test(body.replace(/\\./g, ""));
  });
}

// The other way round: ["Jio Prepaid"], exact -> "^Jio Prepaid$"; ["swiggy", "zomato"] -> "swiggy|zomato".
function recipientPattern(words, exact) {
  return words.map((w) => (exact ? `^${escapeWord(w)}$` : escapeWord(w))).join("|");
}

function quoted(words) {
  return words.map((w) => `"${w}"`).join(" or ");
}

/**
 * Plain words for a rule, e.g.
 *   { when: { direction: "out", merchant: "swiggy|zomato" }, set: { category: "Food" } }
 *   -> 'Paid to a name containing "swiggy" or "zomato" → Food'
 * `rupees(n)` formats whole rupees for minAmount / maxAmount.
 */
function describeRule(rule, rupees = (n) => "₹" + n) {
  const when = rule.when || {};
  const parts = [];
  const paid = { out: "paid", in: "received" }[when.direction];
  if (when.merchant != null) {
    const { exact, words } = patternWords(when.merchant);
    const lead = paid ? `${paid} ${when.direction === "out" ? "to" : "from"}` : "paid to or received from";
    parts.push(`${lead} ${exact ? "" : "a name containing "}${quoted(words)}`);
  } else if (paid) {
    parts.push(paid);
  }
  for (const [key, label] of [["text", "SMS"], ["bank", "bank"], ["template", "template"]]) {
    if (when[key] == null) continue;
    const { exact, words } = patternWords(when[key]);
    parts.push(`${label} ${exact ? "is" : key === "text" ? "mentions" : "contains"} ${quoted(words)}`);
  }
  if (when.account != null) parts.push(`account ··${when.account}`);
  if (when.currency) parts.push(`in ${when.currency}`);
  const min = when.minAmount, max = when.maxAmount;
  if (min != null && max != null) parts.push(`${rupees(min)} to ${rupees(max)}`);
  else if (min != null) parts.push(`${rupees(min)} or more`);
  else if (max != null) parts.push(`up to ${rupees(max)}`);

  const category = (rule.set || {}).category;
  const condition = parts.length ? parts.join(", ") : "Every transaction";
  return `${condition[0].toUpperCase()}${condition.slice(1)} → ${category || "nothing"}`;
}

module.exports = { compileRules, tagsFor, tagAll, describeRule, patternWords, isPlainPattern, recipientPattern };
