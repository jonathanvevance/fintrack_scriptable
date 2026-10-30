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

/** Index of the first rule that sets this transaction's category, or null for a manual/no category. */
function ruleIndexFor(compiled, tx) {
  if (tx.manual && tx.manual.category) return null;
  const index = compiled.findIndex(({ matches, set }) => set.category && matches(tx));
  return index < 0 ? null : index;
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

// ["a"] -> "a"; ["a", "b"] -> "a or b"; ["a", "b", "c"] -> "a, b or c".
function orList(items) {
  return items.length < 3 ? items.join(" or ") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * A rule as one spoken sentence, in pieces: plain strings, and parts you can change as
 * { kind, words: [...] } (said "a, b or c") or { kind, text }. Kinds: "dir", "names", "words",
 * "amount", "account", "other", "category". For example
 *   { when: { direction: "out", merchant: "swiggy|zomato" }, set: { category: "Food" } }
 *   -> "When I " {dir "pay"} " " {names ["swiggy", "zomato"]} ", it's " {category "Food"}
 * A name matches part of the bank's name unless the rule says "exactly". `rupees(n)` formats whole rupees.
 */
function ruleSentence(rule, rupees = (n) => "₹" + n) {
  const when = rule.when || {};
  const dir = when.direction || "";
  const out = ["When I ", { kind: "dir", text: { out: "pay", in: "receive money" }[dir] || "pay or get money" }];
  if (when.merchant != null) {
    const { exact, words } = patternWords(when.merchant);
    out.push(dir === "out" ? " " : " from ", ...(exact ? ["exactly "] : []), { kind: "names", words });
  }
  const min = when.minAmount, max = when.maxAmount;
  if (min != null && max != null) out.push(" between ", { kind: "amount", text: rupees(min) }, " and ", { kind: "amount", text: rupees(max) });
  else if (min != null) out.push(" at least ", { kind: "amount", text: rupees(min) });
  else if (max != null) out.push(" up to ", { kind: "amount", text: rupees(max) });
  if (when.account != null) out.push(" on account ", { kind: "account", text: `··${when.account}` });
  if (when.currency) out.push(" in ", { kind: "other", text: when.currency });
  for (const [key, label, kind] of [["text", "the SMS says", "words"], ["bank", "the bank is", "other"], ["template", "the SMS template is", "other"]]) {
    if (when[key] == null) continue;
    const { exact, words } = patternWords(when[key]);
    out.push(` and ${label} `, ...(exact && key === "text" ? ["exactly "] : []), { kind, words });
  }
  const category = (rule.set || {}).category;
  out.push(", it's ", { kind: "category", text: category || "" });
  return out;
}

/** The sentence as plain text, names in quotes: 'When I pay "swiggy" or "zomato", it's Food'. */
function describeRule(rule, rupees) {
  return ruleSentence(rule, rupees)
    .map((p) => (typeof p === "string" ? p : p.words ? orList(p.words.map((w) => `"${w}"`)) : p.kind === "category" ? p.text || "nothing" : p.text))
    .join("");
}

module.exports = { compileRules, tagsFor, ruleIndexFor, tagAll, describeRule, ruleSentence, orList, patternWords, isPlainPattern, recipientPattern };
