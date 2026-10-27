// Tags transactions from rules kept as data in fintrack/data/rules.json (private, never in the repo).
// Example rule:
//   { "when": { "merchant": "swiggy|zomato", "direction": "out" }, "set": { "category": "Food" } }
// All conditions in "when" must hold. For category and owner the first matching rule wins;
// tags from every matching rule are combined. Values set by hand (tx.manual) beat rules.

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

/** Returns { category, owner, tags } for one transaction. */
function tagsFor(compiled, tx) {
  const out = { category: null, owner: null, tags: [] };
  for (const { matches, set } of compiled) {
    if (!matches(tx)) continue;
    if (!out.category && set.category) out.category = set.category;
    if (!out.owner && set.owner) out.owner = set.owner;
    for (const tag of set.tags || []) if (!out.tags.includes(tag)) out.tags.push(tag);
  }
  return { ...out, ...(tx.manual || {}) };
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

function quoted(words) {
  return words.map((w) => `"${w}"`).join(" or ");
}

/**
 * Plain words for a rule, e.g.
 *   { when: { direction: "out", merchant: "swiggy|zomato" }, set: { category: "Food" } }
 *   -> 'Money out, merchant contains "swiggy" or "zomato" → Food'
 * `rupees(n)` formats whole rupees for minAmount / maxAmount.
 */
function describeRule(rule, rupees = (n) => "₹" + n) {
  const when = rule.when || {};
  const parts = [];
  if (when.direction) parts.push(when.direction === "in" ? "Money in" : "Money out");
  for (const [key, label] of [["merchant", "merchant"], ["text", "SMS"], ["bank", "bank"], ["template", "template"]]) {
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

  const set = rule.set || {};
  const results = [
    set.category,
    set.owner ? `owner ${set.owner}` : null,
    ...(set.tags || []).map((t) => "#" + t),
  ].filter(Boolean);
  const condition = parts.length ? parts.join(", ") : "Every transaction";
  return `${condition[0].toUpperCase()}${condition.slice(1)} → ${results.join(", ") || "nothing"}`;
}

module.exports = { compileRules, tagsFor, tagAll, describeRule, patternWords };
