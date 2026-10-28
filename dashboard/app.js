// FinTrack dashboard. Scriptable shows this page in a WebView and calls fintrack.load(data) with
//   { months: { "YYYY-MM": [tx] }, rules: [rule], unparsed: [{ id, text }], version, currentMonth: "YYYY-MM" }.
// The page never writes files. Requests go out through fintrack.send({ action, ... }):
//   save { rules?: [rule], manual?: { ym, id, manual } }, pasteSms, copy { text }, deleteTx { ym, id },
//   clearUnparsed, update.
// Scriptable answers fintrack.reply({ ok, title?, message?, data?, ym? }); `data` replaces what
// fintrack.load gave. Saves are applied here only once the reply says ok.
// Needs FT.tags (lib/tags.js) and FT.format (lib/format.js) loaded first.

(function () {
  const { compileRules, tagsFor, tagAll, describeRule, patternWords } = FT.tags;
  const { money, monthLabel, shiftMonth, totals, categoryTotals, categoryChanges } = FT.format;
  const app = document.getElementById("app");

  const rupees = (n) => money(Math.round(n * 100));
  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plural = (n, word) => `${n} ${n === 1 ? word : word.endsWith("y") ? word.slice(0, -1) + "ies" : word + "s"}`;
  const monthName = (ym) => monthLabel(ym).split(" ")[0];
  const FORM_CONDITIONS = ["merchant", "text", "direction", "minAmount", "maxAmount", "account"];

  // ---- Category look: known names get an iOS system colour and an emoji, others a stable colour ----

  const KNOWN = {
    food: ["#ff9500", "🍜"], groceries: ["#34c759", "🥦"], shopping: ["#af52de", "🛍️"], travel: ["#007aff", "🚕"],
    transport: ["#007aff", "🚕"], coffee: ["#a2845e", "☕️"], subscriptions: ["#5856d6", "📺"], transfers: ["#8e8e93", "↔︎"],
    cashback: ["#30b0c7", "💸"], bills: ["#ff3b30", "🧾"], rent: ["#ff2d55", "🏠"], health: ["#ff2d55", "💊"],
    fuel: ["#ffcc00", "⛽️"], entertainment: ["#ff375f", "🎬"], investments: ["#34c759", "📈"], salary: ["#34c759", "💼"],
    education: ["#5ac8fa", "📚"], gifts: ["#ff2d55", "🎁"], family: ["#ff9500", "👪"],
  };
  const PALETTE = ["#ff9500", "#34c759", "#af52de", "#007aff", "#5856d6", "#ff2d55", "#30b0c7", "#a2845e", "#5ac8fa", "#ff3b30"];
  const UNTAGGED = ["#aeaeb2", "?"];

  function look(category) {
    if (!category) return UNTAGGED;
    const known = KNOWN[category.toLowerCase()];
    if (known) return known;
    let h = 0;
    for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return [PALETTE[Math.abs(h) % PALETTE.length], esc(category[0].toUpperCase())];
  }
  const colour = (category) => look(category)[0];
  const icon = (category, cls = "") => {
    const [c, glyph] = look(category);
    return `<span class="ic ${cls}" style="background:${c}">${glyph}</span>`;
  };

  // ---- State ----

  const state = {
    months: {},
    rules: [],
    compiled: [],
    unparsed: [],
    version: "",
    ym: null,
    tab: "spending",
    stack: [], // pushed screens: { type: "tx" | "list" | "rule" | "unparsed", ... }
    dialog: null,
    pending: null, // a save waiting for Scriptable's reply
    pendingAction: null, // options for any other request waiting for a reply
  };

  function setRules(rules) {
    state.rules = rules;
    state.compiled = compileRules(rules);
  }
  const monthTx = (ym) => tagAll(state.compiled, state.months[ym] || []);
  const allTx = () => [].concat(...Object.values(state.months));
  const top = () => state.stack[state.stack.length - 1];
  const findTx = (ym, id) => (state.months[ym] || []).find((t) => t.id === id);

  function knownCategories() {
    const count = new Map();
    for (const rule of state.rules) if (rule.set && rule.set.category) count.set(rule.set.category, (count.get(rule.set.category) || 0) + 1);
    for (const tx of tagAll(state.compiled, allTx())) if (tx.category) count.set(tx.category, (count.get(tx.category) || 0) + 1);
    for (const name of ["Food", "Groceries", "Shopping", "Travel", "Bills", "Subscriptions"]) if (!count.has(name)) count.set(name, 0);
    return [...count].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  // ---- Shared pieces ----

  function txRow(tx) {
    const sub = tx.category ? esc(tx.category) : `<span class="warn">Needs a category</span>`;
    const where = [tx.bank, tx.account ? "··" + tx.account : null].filter(Boolean).join(" ");
    const day = Number(tx.date.slice(8));
    return `<button class="li" data-act="open-tx" data-ym="${esc(tx.date.slice(0, 7))}" data-id="${esc(tx.id)}">${icon(tx.category)}
      <div class="main"><div class="t1">${esc(tx.merchant || tx.bank || "Unknown")}</div><div class="t2">${sub}${where ? " · " + esc(where) : ""}${tx.owner ? " · " + esc(tx.owner) : ""}</div></div>
      <div class="amt ${tx.amountPaise > 0 ? "in" : ""}">${tx.amountPaise > 0 ? "+" : ""}${esc(money(Math.abs(tx.amountPaise), tx.currency))}<small>${day} ${esc(monthName(tx.date.slice(0, 7)))}</small></div></button>`;
  }

  function capsule(cats) {
    const sum = cats.reduce((s, c) => s + c.paise, 0) || 1;
    const bar = cats.map((c) => `<div style="flex:${c.paise / sum};background:${colour(c.category)}"></div>`).join("");
    const legend = cats.slice(0, 6).map((c) => `<span style="--c:${colour(c.category)}">${esc(c.category || "Untagged")} ${esc(money(c.paise))}</span>`).join("");
    return `<div class="capsule">${bar}</div><div class="legend">${legend}</div>`;
  }

  function ring(cats) {
    const sum = cats.reduce((s, c) => s + c.paise, 0) || 1;
    let offset = 25;
    let circles = "";
    for (const c of cats) {
      const p = (c.paise / sum) * 100;
      circles += `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${colour(c.category)}" stroke-width="6" stroke-dasharray="${Math.max(p - 0.8, 0.3)} ${100 - Math.max(p - 0.8, 0.3)}" stroke-dashoffset="${offset}"/>`;
      offset -= p;
    }
    return `<svg width="112" height="112" viewBox="0 0 42 42">${circles}</svg>`;
  }

  function compare(a, b, labelA, labelB, c) {
    const m = Math.max(a, b, 1);
    return `<div class="cmp"><div><i style="width:${(a / m) * 60}%;background:${c}"></i><b>${esc(money(a))}</b><span class="muted small">${esc(labelA)}</span></div>
      <div><i style="width:${(b / m) * 60}%;background:var(--fill)"></i>${esc(money(b))}<span class="muted small">${esc(labelB)}</span></div></div>`;
  }

  function monthNav() {
    return `<div class="nav"><button data-act="prev">‹ ${esc(monthName(shiftMonth(state.ym, -1)))}</button><span class="mid"></span>
      <button class="end" data-act="next">${esc(monthName(shiftMonth(state.ym, 1)))} ›</button></div>`;
  }

  function backNav(title, end = "") {
    const back = state.stack.length > 1 ? "Back" : { spending: "Spending", insights: "Insights", rules: "Rules" }[state.tab];
    return `<div class="nav"><button data-act="back">‹ ${esc(back)}</button><span class="mid">${esc(title)}</span><span class="end">${end}</span></div>`;
  }

  // ---- Spending (Wallet style) ----

  function categoryRows(list) {
    const counts = new Map();
    for (const tx of list) if (tx.currency === "INR" && tx.amountPaise < 0) counts.set(tx.category || null, (counts.get(tx.category || null) || 0) + 1);
    return categoryTotals(list)
      .map((c) => `<button class="li" data-act="open-list" data-filter="${esc(c.category || "untagged")}">${icon(c.category)}
        <div class="main"><div class="t1">${esc(c.category || "Untagged")}</div><div class="t2">${plural(counts.get(c.category) || 0, "transaction")}</div></div>
        <div class="amt">${esc(money(c.paise))}</div><span class="chev"></span></button>`)
      .join("");
  }

  function spendingView() {
    const list = monthTx(state.ym);
    const prev = monthTx(shiftMonth(state.ym, -1));
    const t = totals(list);
    const spent = (t.INR || { out: 0 }).out;
    const before = (totals(prev).INR || { out: 0 }).out;
    const diff = spent - before;
    const vs = before ? `${money(Math.abs(diff))} ${diff <= 0 ? "less" : "more"} than ${monthName(shiftMonth(state.ym, -1))}` : "";
    const foreign = Object.keys(t).filter((c) => c !== "INR").map((c) => `${money(t[c].out, c)}`);
    const untagged = list.filter((tx) => !tx.category).length;
    const cats = categoryTotals(list);

    return `${monthNav()}
      <div class="large">Spending<small>${esc(monthLabel(state.ym))}</small></div>
      <div class="group pad" style="display:flex;align-items:center;gap:16px">${cats.length ? ring(cats) : ""}
        <div style="min-width:0"><div class="muted">Spent in ${esc(monthName(state.ym))}</div>
          <div class="big">${esc(money(spent))}</div>
          <div class="muted small">${esc([vs, foreign.length ? "also " + foreign.join(", ") : ""].filter(Boolean).join(" · ") || "\u00a0")}</div></div></div>
      ${cats.length ? `<div class="sh">Categories</div><div class="group">${categoryRows(list)}</div>` : ""}
      ${untagged ? `<button class="card attention" data-act="open-list" data-filter="untagged">${icon(null)}<div style="flex:1"><div style="font-weight:600">${plural(untagged, "transaction")} need a category</div>
        <div class="muted small">Tag one and choose Always; FinTrack remembers.</div></div><span class="chev"></span></button>` : ""}
      <div class="sh2">Latest ${list.length > 5 ? `<button data-act="open-list" data-filter="all">See All</button>` : ""}</div>
      <div class="group">${list.slice(0, 5).map(txRow).join("") || `<div class="empty">No transactions in ${esc(monthLabel(state.ym))}</div>`}</div>`;
  }

  function listView(screen) {
    const list = monthTx(state.ym);
    const shown = screen.filter === "all" ? list : screen.filter === "untagged" ? list.filter((t) => !t.category) : list.filter((t) => t.category === screen.filter);
    const title = screen.filter === "all" ? monthLabel(state.ym) : screen.filter === "untagged" ? "Needs a Category" : screen.filter;
    return `${backNav(title)}<div style="height:8px"></div>
      <div class="group">${shown.map(txRow).join("") || `<div class="empty">Nothing here</div>`}</div>`;
  }

  // ---- Transaction detail: pick a category, optionally Always ----

  function txView(screen) {
    const tx = tagAll(state.compiled, [findTx(screen.ym, screen.id)])[0];
    const choices = knownCategories();
    if (screen.draft && !choices.includes(screen.draft)) choices.unshift(screen.draft);
    const rows = choices
      .map((name) => `<button class="li" data-act="pick-cat" data-value="${esc(name)}">${icon(name, "sq")}<div class="main"><div class="t1">${esc(name)}</div></div>${screen.draft === name ? `<span class="check">✓</span>` : ""}</button>`)
      .join("");
    const sameMerchant = tx.merchant ? allTx().filter((t) => t.merchant === tx.merchant).length : 0;
    const when = `${Number(tx.date.slice(8))} ${monthLabel(tx.date.slice(0, 7))}`;
    return `${backNav("", `<button data-act="save-tx"><b>Save</b></button>`)}
      <div style="text-align:center;padding:6px 16px 18px">${icon(screen.draft, "xl")}
        <div style="font-size:22px;font-weight:700">${esc(tx.merchant || tx.bank || "Unknown")}</div>
        <div class="big ${tx.amountPaise > 0 ? "in" : ""}" style="font-size:40px">${esc(money(Math.abs(tx.amountPaise), tx.currency))}</div>
        <div class="muted">${esc([when, tx.bank, tx.account ? "··" + tx.account : null].filter(Boolean).join(" · "))}</div></div>
      <div class="sh">Category</div>
      <div class="group">${rows}
        <div class="li plain"><input class="left" data-field="newCat" value="${esc(screen.newCat || "")}" placeholder="New category" autocapitalize="words">
          <button class="link" data-act="add-cat">Add</button></div></div>
      ${tx.merchant ? `<div class="group"><button class="li plain" data-act="toggle-always"><div class="main"><div class="t1" style="white-space:normal">Always tag ${esc(tx.merchant)} as ${esc(screen.draft || "…")}</div>
          <div class="t2">Applies to ${plural(sameMerchant, "transaction")} now and every future one</div></div><span class="toggle ${screen.always ? "on" : ""}"></span></button></div>` : ""}
      <div class="sh">Message</div>
      <div class="group pad muted small" style="line-height:1.4;user-select:text;-webkit-user-select:text">${esc(tx.raw)}</div>
      <div class="group">
        <button class="li plain" data-act="copy-sms"><span class="link">Copy SMS</span></button>
        <button class="li plain" data-act="delete-tx"><span class="danger">Delete Transaction</span></button></div>`;
  }

  function saveTx(screen) {
    const tx = findTx(screen.ym, screen.id);
    const category = screen.draft;
    if (!category) return showDialog("Pick a category", "Choose one from the list or add a new one.");
    const fromRules = tagsFor(state.compiled, { ...tx, manual: undefined }).category;
    const manual = { ...(tx.manual || {}) };
    const payload = {};
    if (screen.always && tx.merchant) {
      payload.rules = [{ when: { merchant: `^${escapeRegex(tx.merchant)}$` }, set: { category } }, ...state.rules];
      delete manual.category;
    } else if (category === fromRules) {
      delete manual.category;
    } else {
      manual.category = category;
    }
    if (JSON.stringify(manual) !== JSON.stringify(tx.manual || {})) payload.manual = { ym: screen.ym, id: tx.id, manual };
    if (!payload.rules && !payload.manual) return back();
    const detail = payload.rules ? `Every ${tx.merchant} transaction is now ${category}.` : `This transaction is now ${category}.`;
    commit(payload, payload.rules ? "Rule saved" : "Category saved", detail, { pop: true });
  }

  // ---- More: capture by hand, unrecognised messages, update ----

  function toCheck() {
    return allTx().filter((t) => t.confidence === "low");
  }

  function reviewText() {
    return [
      ...state.unparsed.map((u) => `[unrecognised]\n${u.text}`),
      ...toCheck().map((t) => `[check: parsed as ${money(t.amountPaise, t.currency)} ${t.bank || "?"} ··${t.account || "?"}]\n${t.raw}`),
    ].join("\n\n---\n\n");
  }

  function moreView() {
    const review = state.unparsed.length + toCheck().length;
    return `<div style="height:44px"></div><div class="large">More</div>
      <div class="sh">Add</div>
      <div class="group"><button class="li plain" data-act="paste-sms"><span class="link">Add SMS from Clipboard</span></button></div>
      <div class="sf">Copy a bank SMS in Messages first. It is saved the same way the automation would.</div>
      <div class="sh">Review</div>
      <div class="group">
        <button class="li plain" data-act="open-unparsed"><div class="main"><div class="t1">Unrecognised Messages</div></div><span class="val">${state.unparsed.length}</span><span class="chev"></span></button>
        <div class="li plain"><div class="main"><div class="t1">Parsed with low confidence</div></div><span class="val">${toCheck().length}</span></div>
        ${review ? `<button class="li plain" data-act="copy-review"><span class="link">Copy All for Review</span></button>` : ""}
      </div>
      <div class="sf">Paste the copied messages into the FinTrack dev chat to get bank templates added.</div>
      <div class="sh">App</div>
      <div class="group">
        <button class="li plain" data-act="update"><span class="link">Update FinTrack</span></button>
        <div class="li plain"><div class="main"><div class="t1">Version</div></div><span class="val small" style="white-space:normal;text-align:right;max-width:65%">${esc(state.version || "unknown")}</span></div>
      </div>`;
  }

  function unparsedView() {
    const rows = state.unparsed
      .map((u) => `<button class="li plain" data-act="copy-unparsed" data-id="${esc(u.id)}"><div class="main"><div class="t2" style="white-space:normal;color:var(--text);font-size:15px;line-height:1.35">${esc(u.text)}</div></div></button>`)
      .join("");
    return `${backNav("Unrecognised", state.unparsed.length ? `<button data-act="clear-unparsed">Clear</button>` : "")}<div style="height:8px"></div>
      <div class="group">${rows || `<div class="empty">Nothing unrecognised</div>`}</div>
      ${rows ? `<div class="sf" style="margin-top:-12px">Tap a message to copy it.</div>` : ""}`;
  }

  // ---- Insights (Health style) ----

  function insightsView() {
    const list = monthTx(state.ym);
    const prevYm = shiftMonth(state.ym, -1);
    const prev = monthTx(prevYm);
    const t = totals(list).INR || { out: 0, in: 0 };
    const cards = [];

    cards.push(`<div class="card"><div class="hd">Money in and out</div>${compare(t.in, t.out, "in", "out", "var(--green)")}
      <div class="muted small" style="margin-top:4px">${t.in >= t.out ? `You kept ${esc(money(t.in - t.out))}${t.in ? ` (${Math.round((100 * (t.in - t.out)) / t.in)}%)` : ""}.` : `You spent ${esc(money(t.out - t.in))} more than came in.`}</div></div>`);

    for (const c of categoryChanges(list, prev).filter((c) => Math.abs(c.delta) >= 10000).slice(0, 4)) {
      const less = c.delta < 0;
      const lead = !c.before
        ? `New this month: <b>${esc(money(c.now))}</b> on ${esc(c.category.toLowerCase())}.`
        : !c.now
          ? `Nothing on ${esc(c.category.toLowerCase())} this month, down from ${esc(money(c.before))}.`
          : `You spent <b>${esc(money(Math.abs(c.delta)))} ${less ? "less" : "more"}</b> on ${esc(c.category.toLowerCase())} than in ${esc(monthName(prevYm))}.`;
      cards.push(`<div class="card"><div class="hd" style="color:${colour(c.category)}">${look(c.category)[1]} ${esc(c.category)}</div><div class="lead">${lead}</div>
        ${compare(c.now, c.before, monthName(state.ym), monthName(prevYm), colour(c.category))}</div>`);
    }

    const owners = new Map();
    for (const tx of list) if (tx.currency === "INR" && tx.amountPaise < 0) owners.set(tx.owner || null, (owners.get(tx.owner || null) || 0) - tx.amountPaise);
    if ([...owners.keys()].some(Boolean)) {
      const byOwner = [...owners].map(([o, paise], i) => ({ category: o || "No owner", paise, i })).sort((a, b) => b.paise - a.paise);
      cards.push(`<div class="card"><div class="hd">Who spent</div>${capsule(byOwner)}</div>`);
    }

    const untagged = list.filter((tx) => !tx.category).length;
    if (untagged) {
      cards.push(`<button class="card attention" data-act="open-list" data-filter="untagged">${icon(null)}<div style="flex:1"><div style="font-weight:600">${plural(untagged, "transaction")} need a category</div>
        <div class="muted small">Insights get better as more is tagged.</div></div><span class="chev"></span></button>`);
    }

    return `${monthNav()}<div class="large">Insights<small>${esc(monthLabel(state.ym))} compared with ${esc(monthLabel(prevYm))}</small></div>${cards.join("")}`;
  }

  // ---- Rules (Shortcuts-style sentences) ----

  function token(text, c) {
    return `<span class="tok" style="--c:${c}">${esc(text)}</span>`;
  }

  function sentence(rule) {
    const when = rule.when || {};
    const set = rule.set || {};
    const accent = colour(set.category);
    const parts = [];
    if (when.direction) parts.push(`money goes ${token(when.direction, when.direction === "in" ? "var(--green)" : "var(--red)")}`);
    for (const [key, label] of [["merchant", "merchant"], ["text", "SMS"], ["bank", "bank"], ["template", "template"]]) {
      if (when[key] == null) continue;
      const { exact, words } = patternWords(when[key]);
      const verb = exact ? "is" : key === "text" ? "mentions" : "contains";
      parts.push(`${label} ${verb} ${words.map((w) => token(w, accent)).join(" or ")}`);
    }
    if (when.account != null) parts.push(`account is ${token("··" + when.account, "#8e8e93")}`);
    if (when.currency) parts.push(`currency is ${token(when.currency, "#8e8e93")}`);
    if (when.minAmount != null || when.maxAmount != null) {
      const range = when.minAmount != null && when.maxAmount != null ? `${rupees(when.minAmount)}–${rupees(when.maxAmount)}`
        : when.minAmount != null ? `${rupees(when.minAmount)} or more` : `up to ${rupees(when.maxAmount)}`;
      parts.push(`amount is ${token(range, "#8e8e93")}`);
    }
    const then = [];
    if (set.category) then.push(`tag ${token(`${look(set.category)[1]} ${set.category}`, accent)}`);
    if (set.owner) then.push(`owner ${token(set.owner, "#8e8e93")}`);
    if (set.tags && set.tags.length) then.push(set.tags.map((t) => token("#" + t, "#8e8e93")).join(" "));
    return `When ${parts.join(" and ") || "anything"}<br>then ${then.join(", ") || "nothing"}`;
  }

  function rulesView() {
    const txs = allTx();
    const cards = state.rules
      .map((rule, i) => {
        const hits = txs.filter(state.compiled[i].matches).length;
        return `<button class="sentence" data-act="edit-rule" data-i="${i}"><div class="lbl"><span>${plural(hits, "transaction")}</span><span>${i + 1}</span></div>${sentence(rule)}</button>`;
      })
      .join("");
    return `<div class="nav"><span></span><span class="mid"></span><button class="end" data-act="new-rule" style="font-size:26px;line-height:1">＋</button></div>
      <div class="large">Rules<small>Checked top to bottom. For category and owner, the first match wins.</small></div>
      ${cards || `<div class="group"><div class="empty">No rules yet. Open a transaction, pick a category and turn on Always.</div></div>`}`;
  }

  // ---- Rule editor (grouped form) ----

  function fieldsFromRule(rule) {
    const when = rule.when || {};
    const set = rule.set || {};
    const extra = {};
    for (const key of Object.keys(when)) if (!FORM_CONDITIONS.includes(key)) extra[key] = when[key];
    return {
      extra,
      fields: {
        merchant: when.merchant || "", text: when.text || "", direction: when.direction || "",
        minAmount: when.minAmount != null ? String(when.minAmount) : "", maxAmount: when.maxAmount != null ? String(when.maxAmount) : "",
        account: when.account || "", category: set.category || "", owner: set.owner || "", tags: (set.tags || []).join(", "),
      },
    };
  }

  // Throws a readable message when a field is invalid.
  function ruleFromForm(screen) {
    const f = screen.fields;
    const when = { ...screen.extra };
    for (const key of ["merchant", "text", "direction", "account"]) if (f[key].trim()) when[key] = f[key].trim();
    for (const key of ["minAmount", "maxAmount"]) {
      if (!f[key].trim()) continue;
      const n = Number(f[key].replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new Error(`${key === "minAmount" ? "Minimum" : "Maximum"} amount must be a number`);
      when[key] = n;
    }
    const set = {};
    if (f.category.trim()) set.category = f.category.trim();
    if (f.owner.trim()) set.owner = f.owner.trim();
    const tags = f.tags.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
    if (tags.length) set.tags = tags;
    const rule = { when, set };
    compileRules([rule]);
    return rule;
  }

  const cleanError = (e) => String(e.message || e).replace(/^rules\.json rule \d+: /, "");

  function previewHtml(screen) {
    let rule;
    try {
      rule = ruleFromForm(screen);
    } catch (e) {
      return `<div class="sh danger" style="text-transform:none">${esc(cleanError(e))}</div>`;
    }
    if (!Object.keys(rule.when).length) return `<div class="sh" style="text-transform:none">Add a condition to see what this rule matches.</div>`;
    const hits = tagAll(state.compiled, allTx().filter(compileRules([rule])[0].matches)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const more = hits.length > 5 ? `<div class="li plain"><span class="muted">+${hits.length - 5} more</span></div>` : "";
    return `<div class="sh">Matches ${plural(hits.length, "transaction")}</div><div class="group">${hits.slice(0, 5).map(txRow).join("")}${more}</div>`;
  }

  function field(screen, name, label, placeholder) {
    return `<div class="li plain"><span>${label}</span><input data-field="${name}" value="${esc(screen.fields[name])}" placeholder="${esc(placeholder)}" autocapitalize="off" autocorrect="off"></div>`;
  }

  function ruleView(screen) {
    const dir = screen.fields.direction;
    const seg = [["out", "Out"], ["in", "In"], ["", "Either"]]
      .map(([v, label]) => `<button data-act="dir" data-value="${v}" class="${dir === v ? "on" : ""}">${label}</button>`).join("");
    const cats = knownCategories().slice(0, 10)
      .map((name) => `<button data-act="rule-cat" data-value="${esc(name)}" class="${screen.fields.category === name ? "on" : ""}">${look(name)[1]} ${esc(name)}</button>`).join("");
    const extra = Object.keys(screen.extra).length ? `<div class="sf" style="margin-top:-12px">Also keeps: ${esc(describeRule({ when: screen.extra }, rupees).replace(/ → .*$/, ""))}</div>` : "";
    const editing = screen.index != null;
    return `<div class="nav"><button data-act="back">Cancel</button><span class="mid">${editing ? "Edit Rule" : "New Rule"}</span><button class="end" data-act="save-rule"><b>Save</b></button></div>
      <div style="height:8px"></div>
      <div class="sh">If</div>
      <div class="group">
        ${field(screen, "merchant", "Merchant", "swiggy|zomato")}
        ${field(screen, "text", "SMS mentions", "cashback")}
        <div class="li plain"><span style="flex:1">Money</span><div class="seg">${seg}</div></div>
        ${field(screen, "minAmount", "At least ₹", "any")}
        ${field(screen, "maxAmount", "At most ₹", "any")}
        ${field(screen, "account", "Account", "last digits")}
      </div>
      <div class="sf">Separate several merchants or words with |.</div>${extra}
      <div class="sh">Then</div>
      <div class="group">
        ${field(screen, "category", "Category", "Food")}
        <div class="chips" style="padding-top:2px">${cats}</div>
        ${field(screen, "owner", "Owner", "none")}
        ${field(screen, "tags", "Tags", "none")}
      </div>
      <div id="preview">${previewHtml(screen)}</div>
      ${editing ? `<div class="group">
        ${screen.index > 0 ? `<button class="li plain" data-act="move-rule" data-value="-1"><span class="link">Move Up</span></button>` : ""}
        ${screen.index < state.rules.length - 1 ? `<button class="li plain" data-act="move-rule" data-value="1"><span class="link">Move Down</span></button>` : ""}
        <button class="li plain" data-act="delete-rule"><span class="danger">Delete Rule</span></button></div>` : ""}`;
  }

  function saveRule(screen) {
    let rule;
    try {
      rule = ruleFromForm(screen);
      if (!Object.keys(rule.when).length) throw new Error("Add at least one condition.");
      if (!Object.keys(rule.set).length) throw new Error("Set a category, owner or tag.");
    } catch (e) {
      return showDialog("Can't save yet", cleanError(e));
    }
    const next = state.rules.slice();
    if (screen.index == null) next.unshift(rule);
    else next[screen.index] = rule;
    commit({ rules: next }, "Rule saved", describeRule(rule, rupees), { pop: true });
  }

  // ---- Saving through Scriptable ----

  function commit(payload, title, detail, options = {}) {
    const undo = {};
    if (payload.rules) undo.rules = state.rules;
    if (payload.manual) {
      const tx = findTx(payload.manual.ym, payload.manual.id);
      undo.manual = { ...payload.manual, manual: (tx && tx.manual) || {} };
    }
    state.pending = { payload, undo, title, detail, ...options };
    fintrack.send({ action: "save", ...payload });
  }

  // Anything other than a save: Scriptable does it and may send fresh data back.
  function request(action, fields = {}, options = {}) {
    state.pendingAction = options;
    fintrack.send({ action, ...fields });
  }

  function useData(data) {
    state.months = data.months || {};
    state.unparsed = data.unparsed || [];
    state.version = data.version || "";
    setRules(data.rules || []);
  }

  function reply(result) {
    if (state.pending) return saved(result.ok, result.message);
    const options = state.pendingAction || {};
    state.pendingAction = null;
    if (result.data) useData(result.data);
    if (result.ym) state.ym = result.ym;
    if (result.ok && options.pop) state.stack.pop();
    showDialog(result.title || (result.ok ? "Done" : "Something went wrong"), result.message || "");
  }

  function saved(ok, message) {
    const p = state.pending;
    state.pending = null;
    if (!p) return;
    if (!ok) return showDialog("Not saved", message || "Scriptable could not save the change.");
    const txs = allTx();
    const before = txs.map((tx) => JSON.stringify(tagsFor(state.compiled, tx)));
    if (p.payload.rules) setRules(p.payload.rules);
    if (p.payload.manual) {
      const tx = findTx(p.payload.manual.ym, p.payload.manual.id);
      if (tx) tx.manual = p.payload.manual.manual;
    }
    const changed = txs.filter((tx, i) => JSON.stringify(tagsFor(state.compiled, tx)) !== before[i]).length;
    if (p.pop) state.stack.pop();
    if (!p.quiet) {
      state.dialog = {
        title: p.title,
        text: `${p.detail}\n${plural(changed, "transaction")} re-tagged.`,
        actions: p.isUndo ? [["OK", "close"]] : [["Undo", "undo"], ["OK", "close"]],
        undo: p.undo,
      };
    }
    render();
  }

  // ---- Rendering and events ----

  function showDialog(title, text, actions = [["OK", "close"]], extra = {}) {
    state.dialog = { title, text, actions, ...extra };
    render();
  }

  function dialogView() {
    const d = state.dialog;
    if (!d) return "";
    const acts = d.actions.map(([label, act, danger]) => `<button data-act="${act}" class="${danger ? "danger" : ""}">${esc(label)}</button>`).join("");
    return `<div class="dim"><div class="alert"><div class="body"><h3>${esc(d.title)}</h3><p>${esc(d.text).replace(/\n/g, "<br>")}</p></div><div class="acts">${acts}</div></div></div>`;
  }

  const TAB_ICONS = {
    spending: '<svg viewBox="0 0 26 24"><rect x="1" y="4" width="24" height="16" rx="3.5"/><rect x="1" y="8" width="24" height="3" fill="var(--card)"/></svg>',
    insights: '<svg viewBox="0 0 26 24"><rect x="3" y="12" width="5" height="9" rx="1.5"/><rect x="10.5" y="6" width="5" height="15" rx="1.5"/><rect x="18" y="2" width="5" height="19" rx="1.5"/></svg>',
    rules: '<svg viewBox="0 0 26 24"><rect x="2" y="3" width="22" height="4" rx="2"/><rect x="2" y="10" width="16" height="4" rx="2"/><rect x="2" y="17" width="19" height="4" rx="2"/></svg>',
    more: '<svg viewBox="0 0 26 24"><circle cx="5" cy="12" r="2.6"/><circle cx="13" cy="12" r="2.6"/><circle cx="21" cy="12" r="2.6"/></svg>',
  };

  function render() {
    if (!state.ym) {
      app.innerHTML = `<div class="large" style="padding-top:40px">FinTrack<small>Loading…</small></div>`;
      return;
    }
    const screen = top();
    const views = { tx: txView, list: listView, rule: ruleView, unparsed: unparsedView };
    const body = screen ? views[screen.type](screen) : { spending: spendingView, insights: insightsView, rules: rulesView, more: moreView }[state.tab]();
    const tabs = screen ? "" : `<nav class="tabbar">${["spending", "insights", "rules", "more"]
      .map((id) => `<button data-act="tab" data-value="${id}" class="${state.tab === id ? "on" : ""}">${TAB_ICONS[id]}${id[0].toUpperCase() + id.slice(1)}</button>`).join("")}</nav>`;
    app.innerHTML = `<div class="screen ${screen ? "no-tabs" : ""}">${body}</div>${tabs}${dialogView()}`;
  }

  function push(screen) {
    state.stack.push(screen);
    render();
    window.scrollTo(0, 0);
  }
  function back() {
    state.stack.pop();
    render();
  }

  const actions = {
    tab: (el) => { state.tab = el.dataset.value; state.stack = []; render(); window.scrollTo(0, 0); },
    prev: () => { state.ym = shiftMonth(state.ym, -1); render(); },
    next: () => { state.ym = shiftMonth(state.ym, 1); render(); },
    back,
    "open-list": (el) => push({ type: "list", filter: el.dataset.filter }),
    "open-tx": (el) => {
      const tx = tagAll(state.compiled, [findTx(el.dataset.ym, el.dataset.id)])[0];
      push({ type: "tx", ym: el.dataset.ym, id: tx.id, draft: tx.category, always: false });
    },
    "pick-cat": (el) => { top().draft = el.dataset.value; render(); },
    "add-cat": () => { const s = top(); if (s.newCat && s.newCat.trim()) { s.draft = s.newCat.trim(); s.newCat = ""; } render(); },
    "toggle-always": () => { top().always = !top().always; render(); },
    "save-tx": () => saveTx(top()),
    "new-rule": () => push({ type: "rule", index: null, ...fieldsFromRule({}) }),
    "edit-rule": (el) => { const i = Number(el.dataset.i); push({ type: "rule", index: i, ...fieldsFromRule(state.rules[i]) }); },
    dir: (el) => { top().fields.direction = el.dataset.value; render(); },
    "rule-cat": (el) => { top().fields.category = el.dataset.value; render(); },
    "save-rule": () => saveRule(top()),
    "move-rule": (el) => {
      const s = top();
      const next = state.rules.slice();
      const [rule] = next.splice(s.index, 1);
      next.splice(s.index + Number(el.dataset.value), 0, rule);
      commit({ rules: next }, "", "", { quiet: true, pop: true });
    },
    "delete-rule": () => showDialog("Delete Rule?", describeRule(state.rules[top().index], rupees), [["Cancel", "close"], ["Delete", "delete-confirm", true]]),
    "delete-confirm": () => {
      const i = top().index;
      const rule = state.rules[i];
      state.dialog = null;
      commit({ rules: state.rules.filter((_, j) => j !== i) }, "Rule deleted", describeRule(rule, rupees), { pop: true });
    },
    undo: () => {
      const undo = state.dialog.undo;
      state.dialog = null;
      render();
      commit(undo, "Undone", "Back to how it was.", { isUndo: true });
    },
    close: () => { state.dialog = null; render(); },
    "copy-sms": () => request("copy", { text: findTx(top().ym, top().id).raw }),
    "delete-tx": () => {
      const tx = findTx(top().ym, top().id);
      showDialog("Delete Transaction?", `${tx.merchant || tx.bank || "This transaction"}, ${money(Math.abs(tx.amountPaise), tx.currency)}. This cannot be undone.`,
        [["Cancel", "close"], ["Delete", "delete-tx-confirm", true]]);
    },
    "delete-tx-confirm": () => { state.dialog = null; render(); request("deleteTx", { ym: top().ym, id: top().id }, { pop: true }); },
    "paste-sms": () => request("pasteSms"),
    "open-unparsed": () => push({ type: "unparsed" }),
    "copy-unparsed": (el) => request("copy", { text: state.unparsed.find((u) => u.id === el.dataset.id).text }),
    "copy-review": () => request("copy", { text: reviewText() }),
    "clear-unparsed": () => showDialog("Clear Unrecognised?", `${plural(state.unparsed.length, "message")} will be removed.`, [["Cancel", "close"], ["Clear", "clear-confirm", true]]),
    "clear-confirm": () => { state.dialog = null; render(); request("clearUnparsed", {}, { pop: true }); },
    update: () => request("update"),
  };

  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
  });

  app.addEventListener("input", (e) => {
    const name = e.target.dataset && e.target.dataset.field;
    const screen = top();
    if (!name || !screen) return;
    if (screen.type === "tx") screen.newCat = e.target.value;
    if (screen.type === "rule") {
      screen.fields[name] = e.target.value;
      document.getElementById("preview").innerHTML = previewHtml(screen);
    }
  });

  function load(data) {
    useData(data);
    state.ym = data.currentMonth || Object.keys(state.months).sort().pop() || "2026-01";
    render();
  }

  window.fintrack = {
    load,
    reply,
    send: (message) => {
      location.href = "fintrack://do?data=" + encodeURIComponent(JSON.stringify(message));
    },
  };
  render();
})();
