// FinTrack dashboard. Scriptable shows this page in a WebView and calls fintrack.load(data) with
//   { months: { "YYYY-MM": [tx] }, rules: [rule], categories: { name: { emoji, colour } },
//     unparsed: [{ id, text }], version, currentMonth: "YYYY-MM" }.
// The page never writes files. Requests go out through fintrack.send({ action, ... }):
//   save { rules?: [rule], manual?: { ym, id, manual }, categories?: { name: look } }, pasteSms, copy { text }, deleteTx { ym, id },
//   clearUnparsed, update.
// Scriptable answers fintrack.reply({ ok, title?, message?, data?, ym? }); `data` replaces what
// fintrack.load gave. Saves are applied here only once the reply says ok.
// Needs FT.tags (lib/tags.js) and FT.format (lib/format.js) loaded first.

(function () {
  const { compileRules, tagsFor, tagAll, describeRule, patternWords, isPlainPattern, recipientPattern } = FT.tags;
  const { money, monthLabel, shiftMonth, totals, categoryTotals, merchantTotals, recurringPayments } = FT.format;
  const app = document.getElementById("app");

  const rupees = (n) => money(Math.round(n * 100));
  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const plural = (n, word) => `${n} ${n === 1 ? word : /[^aeiou]y$/.test(word) ? word.slice(0, -1) + "ies" : word + "s"}`;
  const monthName = (ym) => monthLabel(ym).split(" ")[0];
  const recipient = (tx) => tx.merchant || tx.bank || "Unknown";
  // Lists, titles and bubbles show at most 12 characters; the transaction detail shows the full name.
  const shortName = (name) => (name.length > 12 ? name.slice(0, 11).trimEnd() + "…" : name);
  const FORM_CONDITIONS = ["merchant", "text", "direction", "minAmount", "maxAmount", "account"];

  // ---- Category look: saved in categories.json, else suggested from the name ----

  // First keyword found in the lower-cased name wins, so more specific words come first.
  const SUGGEST = [
    [["coffee", "cafe"], "#a2845e", "☕️"],
    [["food", "dining", "restaurant", "swiggy", "zomato", "lunch", "dinner"], "#ff9500", "🍜"],
    [["grocer", "vegetable", "fruit", "bigbasket", "blinkit", "zepto"], "#34c759", "🥦"],
    [["snack"], "#ff9500", "🍿"],
    [["cloth", "fashion", "apparel"], "#af52de", "👕"],
    [["shop", "amazon", "flipkart"], "#af52de", "🛍️"],
    [["flight", "travel", "trip", "holiday", "vacation"], "#007aff", "✈️"],
    [["hotel", "stay"], "#007aff", "🏨"],
    [["fuel", "petrol", "diesel"], "#ffcc00", "⛽️"],
    [["taxi", "cab", "uber", "ola", "auto", "transport", "commute", "metro"], "#007aff", "🚕"],
    [["parking", "toll"], "#8e8e93", "🅿️"],
    [["recharge", "mobile", "phone", "prepaid", "postpaid"], "#007aff", "📱"],
    [["internet", "broadband", "wifi"], "#5ac8fa", "🌐"],
    [["electric", "power"], "#ffcc00", "💡"],
    [["water"], "#5ac8fa", "🚰"],
    [["gas", "lpg", "cylinder"], "#ff9500", "🔥"],
    [["rent", "house", "home"], "#ff2d55", "🏠"],
    [["bill", "utilit"], "#ff3b30", "🧾"],
    [["maint", "repair"], "#8e8e93", "🔧"],
    [["subscri", "netflix", "spotify", "prime"], "#5856d6", "📺"],
    [["movie", "entertain", "game"], "#ff375f", "🎬"],
    [["health", "medic", "doctor", "pharma", "hospital"], "#ff2d55", "💊"],
    [["gym", "fitness", "sport"], "#34c759", "🏋️"],
    [["beauty", "salon", "spa", "groom"], "#ff2d55", "💇"],
    [["school", "educat", "course", "book", "fees"], "#5ac8fa", "📚"],
    [["kid", "baby", "child"], "#ff9500", "🧸"],
    [["pet"], "#a2845e", "🐾"],
    [["family", "parent"], "#ff9500", "👪"],
    [["gift"], "#ff2d55", "🎁"],
    [["donat", "charit"], "#34c759", "🤲"],
    [["insur"], "#30b0c7", "🛡️"],
    [["loan", "emi"], "#8e8e93", "🏦"],
    [["card"], "#8e8e93", "💳"],
    [["invest", "sip", "mutual", "stock"], "#34c759", "📈"],
    [["saving"], "#34c759", "🐷"],
    [["salary", "income"], "#34c759", "💼"],
    [["cashback", "reward"], "#30b0c7", "💸"],
    [["refund"], "#30b0c7", "↩️"],
    [["transfer", "upi"], "#8e8e93", "↔︎"],
    [["cash", "atm"], "#34c759", "💵"],
    [["test"], "#8e8e93", "🧪"],
  ];
  const PALETTE = ["#ff9500", "#34c759", "#af52de", "#007aff", "#5856d6", "#ff2d55", "#30b0c7", "#a2845e", "#5ac8fa", "#ff3b30", "#ffcc00", "#8e8e93"];
  const EMOJIS = ["🍜", "🥦", "☕️", "🍿", "🛍️", "👕", "✈️", "🚕", "⛽️", "📱", "🌐", "💡", "🧾", "🏠", "🔧", "📺",
    "🎬", "💊", "🏋️", "💇", "📚", "🧸", "🐾", "👪", "🎁", "🛡️", "🏦", "💳", "📈", "💼", "💸", "↔︎", "💵", "🧪", "🏷️", "⭐️"];
  const UNTAGGED = ["#aeaeb2", "?"];

  function suggestLook(name) {
    const lower = name.toLowerCase();
    const hit = SUGGEST.find(([words]) => words.some((w) => lower.includes(w)));
    if (hit) return [hit[1], hit[2]];
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return [PALETTE[Math.abs(h) % PALETTE.length], "🏷️"];
  }

  // [colour, emoji]. A look being picked on the current screen shows before it is saved.
  function look(category) {
    if (!category) return UNTAGGED;
    const pending = state.previewLook;
    if (pending && pending.name === category) return [pending.colour, pending.emoji];
    const saved = state.categories[category];
    return saved ? [saved.colour, saved.emoji] : suggestLook(category);
  }
  const colour = (category) => look(category)[0];
  const icon = (category, cls = "") => {
    const [c, glyph] = look(category);
    return `<span class="ic ${cls}" style="background:${c}">${glyph}</span>`;
  };
  const startLook = (name) => {
    const [c, emoji] = look(name);
    return { name, emoji, colour: c };
  };

  function lookPicker(newLook) {
    const emojis = EMOJIS.map((e) => `<button data-act="pick-emoji" data-value="${e}" style="${e === newLook.emoji ? `background:${newLook.colour}` : ""}">${e}</button>`).join("");
    const swatches = PALETTE.map((c) => `<button data-act="pick-colour" data-value="${c}" class="${c === newLook.colour ? "on" : ""}" style="background:${c}"></button>`).join("");
    return `<div class="sh">Icon for ${esc(newLook.name)}</div><div class="group pad"><div class="emojis">${emojis}</div><div class="swatches">${swatches}</div></div>`;
  }

  // ---- State ----

  const state = {
    months: {},
    rules: [],
    compiled: [],
    categories: {}, // saved looks: { name: { emoji, colour } }
    previewLook: null, // { name, emoji, colour } being picked on the current screen
    unparsed: [],
    version: "",
    ym: null,
    year: null, // "YYYY" when Spending shows a whole year instead of state.ym
    today: null, // the month FinTrack was opened in
    tab: "spending",
    trends: "trends", // which view the Trends tab shows: trends | recurring | merchants
    trendCategory: null,
    trendMonths: 12,
    bubble: null, // recipient picked in the Recipients bubbles
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
  const yearMonths = (y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  const hasMonth = (ym) => (state.months[ym] || []).length > 0;
  // What Spending and its lists show: one month, or every month of state.year, newest first.
  const periodTx = () => (state.year ? [].concat(...yearMonths(state.year).reverse().map(monthTx)) : monthTx(state.ym));
  const periodLabel = () => state.year || monthLabel(state.ym);
  const allTx = () => [].concat(...Object.values(state.months));
  const top = () => state.stack[state.stack.length - 1];
  const findTx = (ym, id) => (state.months[ym] || []).find((t) => t.id === id);

  function knownCategories() {
    const count = new Map();
    for (const rule of state.rules) if (rule.set && rule.set.category) count.set(rule.set.category, (count.get(rule.set.category) || 0) + 1);
    for (const tx of tagAll(state.compiled, allTx())) if (tx.category) count.set(tx.category, (count.get(tx.category) || 0) + 1);
    for (const name of Object.keys(state.categories)) if (!count.has(name)) count.set(name, 0);
    for (const name of ["Food", "Groceries", "Shopping", "Travel", "Bills", "Subscriptions"]) if (!count.has(name)) count.set(name, 0);
    return [...count].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  // ---- Shared pieces ----

  function txRow(tx) {
    const sub = tx.category ? esc(tx.category) : `<span class="warn">Needs a category</span>`;
    const where = [tx.bank, tx.account ? "··" + tx.account : null].filter(Boolean).join(" ");
    const day = Number(tx.date.slice(8));
    return `<button class="li" data-act="open-tx" data-ym="${esc(tx.date.slice(0, 7))}" data-id="${esc(tx.id)}">${icon(tx.category)}
      <div class="main"><div class="t1">${esc(shortName(recipient(tx)))}</div><div class="t2">${sub}${where ? " · " + esc(where) : ""}</div></div>
      <div class="amt ${tx.amountPaise > 0 ? "in" : ""}">${tx.amountPaise > 0 ? "+" : ""}${esc(money(Math.abs(tx.amountPaise), tx.currency))}<small>${day} ${esc(monthName(tx.date.slice(0, 7)))}</small></div></button>`;
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

  // Swipeable month pills grouped by year, with an "All YYYY" pill per year.
  function monthStrip() {
    const yms = [...new Set([...Object.keys(state.months).filter(hasMonth), state.today, state.ym])].filter(Boolean).sort();
    const html = [...new Set(yms.map((ym) => ym.slice(0, 4)))]
      .map((y) => `<span class="yearlbl">${y}</span>` +
        yms.filter((ym) => ym.startsWith(y))
          .map((ym) => `<button class="pill ${ym === state.ym && !state.year ? "on" : ""}" data-act="month" data-ym="${ym}">${esc(monthName(ym))}</button>`).join("") +
        `<button class="pill year ${state.year === y ? "on" : ""}" data-act="year" data-value="${y}">All ${y}</button>`)
      .join("");
    return `<div class="strip">${html}</div>`;
  }

  // Money out per month of year y; tap a bar to open that month.
  function yearBars(y) {
    const yms = yearMonths(y);
    const spent = yms.map((ym) => (totals(monthTx(ym)).INR || { out: 0 }).out);
    const max = Math.max(1, ...spent);
    return `<div class="bars">${yms.map((ym, i) => `<button data-act="month" data-ym="${ym}" ${hasMonth(ym) ? "" : "disabled"}>
      <div class="b" style="height:${Math.max(2, (spent[i] / max) * 100)}%"></div><div class="l">${monthName(ym)[0]}</div></button>`).join("")}</div>`;
  }

  function backNav(title, end = "") {
    const back = state.stack.length > 1 ? "Back" : { spending: "Spending", trends: "Trends", rules: "Rules", more: "More" }[state.tab];
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
    const list = periodTx();
    const t = totals(list);
    const spent = (t.INR || { out: 0 }).out;
    let note;
    if (state.year) {
      const months = yearMonths(state.year).filter(hasMonth).length;
      note = months ? `${money(Math.round(spent / months / 100) * 100)} a month on average · ${plural(months, "month")}` : "";
    } else {
      const before = (totals(monthTx(shiftMonth(state.ym, -1))).INR || { out: 0 }).out;
      const diff = spent - before;
      note = before ? `${money(Math.abs(diff))} ${diff <= 0 ? "less" : "more"} than ${monthName(shiftMonth(state.ym, -1))}` : "";
    }
    const foreign = Object.keys(t).filter((c) => c !== "INR").map((c) => `${money(t[c].out, c)}`);
    const untagged = list.filter((tx) => !tx.category).length;
    const cats = categoryTotals(list);

    return `<div class="large first">Spending<small>${esc(periodLabel())}</small></div>
      ${monthStrip()}
      <div class="group pad" style="display:flex;align-items:center;gap:16px">${cats.length ? ring(cats) : ""}
        <div style="min-width:0"><div class="muted">Spent in ${esc(state.year || monthName(state.ym))}</div>
          <div class="big">${esc(money(spent))}</div>
          <div class="muted small">${esc([note, foreign.length ? "also " + foreign.join(", ") : ""].filter(Boolean).join(" · ") || "\u00a0")}</div></div></div>
      ${state.year ? `<div class="group pad"><div class="muted small">Each month · tap one to open it</div>${yearBars(state.year)}</div>` : ""}
      ${cats.length ? `<div class="sh">Categories</div><div class="group">${categoryRows(list)}</div>` : ""}
      ${untagged ? `<button class="card attention" data-act="open-list" data-filter="untagged">${icon(null)}<div style="flex:1"><div style="font-weight:600">${plural(untagged, "transaction")} need a category</div>
        <div class="muted small">Tag one and choose Always; FinTrack remembers.</div></div><span class="chev"></span></button>` : ""}
      <div class="sh2">Latest ${list.length > 5 ? `<button data-act="open-list" data-filter="all">See All</button>` : ""}</div>
      <div class="group">${list.slice(0, 5).map(txRow).join("") || `<div class="empty">No transactions in ${esc(periodLabel())}</div>`}</div>`;
  }

  function listView(screen) {
    if (screen.merchant) {
      const all = screen.allTime ? tagAll(state.compiled, allTx()).sort((a, b) => (a.date < b.date ? 1 : -1)) : periodTx();
      const shown = all.filter((t) => recipient(t) === screen.merchant);
      return `${backNav(shortName(screen.merchant))}<div style="height:8px"></div>
      <div class="group">${shown.map(txRow).join("") || `<div class="empty">Nothing here</div>`}</div>`;
    }
    const list = periodTx();
    const shown = screen.filter === "all" ? list : screen.filter === "untagged" ? list.filter((t) => !t.category) : list.filter((t) => t.category === screen.filter);
    const title = screen.filter === "all" ? periodLabel() : screen.filter === "untagged" ? "Needs a Category" : screen.filter;
    const isCategory = screen.filter !== "all" && screen.filter !== "untagged";
    return `${backNav(title, isCategory ? `<button data-act="see-trend" data-value="${esc(screen.filter)}">See Trend</button>` : "")}<div style="height:8px"></div>
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
        <div style="font-size:22px;font-weight:700">${esc(recipient(tx))}</div>
        <div class="big ${tx.amountPaise > 0 ? "in" : ""}" style="font-size:40px">${esc(money(Math.abs(tx.amountPaise), tx.currency))}</div>
        <div class="muted">${esc([when, tx.bank, tx.account ? "··" + tx.account : null].filter(Boolean).join(" · "))}</div></div>
      <div class="sh">Category</div>
      <div class="group">${rows}
        <div class="li plain"><input class="left" data-field="newCat" value="${esc(screen.newCat || "")}" placeholder="New category" autocapitalize="words">
          <button class="link" data-act="add-cat">Add</button></div>
        ${screen.draft && !screen.newLook ? `<button class="li plain" data-act="edit-look"><span class="link">Change Icon for ${esc(screen.draft)}</span></button>` : ""}</div>
      ${screen.newLook && screen.newLook.name === screen.draft ? lookPicker(screen.newLook) : ""}
      ${tx.merchant ? `<div class="group"><button class="li plain" data-act="toggle-always"><div class="main"><div class="t1" style="white-space:normal">Always tag ${esc(shortName(tx.merchant))} as ${esc(screen.draft || "…")}</div>
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
      payload.rules = [{ when: { merchant: recipientPattern([tx.merchant], true) }, set: { category } }, ...state.rules];
      delete manual.category;
    } else if (category === fromRules) {
      delete manual.category;
    } else {
      manual.category = category;
    }
    if (JSON.stringify(manual) !== JSON.stringify(tx.manual || {})) payload.manual = { ym: screen.ym, id: tx.id, manual };
    const lookChange = lookPayload(screen.newLook, category);
    if (lookChange) payload.categories = lookChange;
    if (!payload.rules && !payload.manual && !payload.categories) return back();
    const detail = payload.rules ? `Every ${shortName(tx.merchant)} transaction is now ${category}.`
      : payload.manual ? `This transaction is now ${category}.` : `${category} has a new icon.`;
    commit(payload, payload.rules ? "Rule saved" : payload.manual ? "Category saved" : "Icon saved", detail, { pop: true });
  }

  // The whole categories map with `newLook` saved for `category`, or null when nothing changes.
  function lookPayload(newLook, category) {
    if (!newLook || newLook.name !== category) return null;
    const saved = state.categories[category];
    if (saved && saved.emoji === newLook.emoji && saved.colour === newLook.colour) return null;
    return { ...state.categories, [category]: { emoji: newLook.emoji, colour: newLook.colour } };
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
    return `<div class="large first">More</div>
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

  // ---- Trends tab: Trends | Recurring | Recipients ----

  const shortMoney = (paise) => {
    const r = paise / 100;
    return r >= 100000 ? `₹${(r / 100000).toFixed(1)}L` : r >= 1000 ? `₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k` : `₹${Math.round(r)}`;
  };
  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  function lineChart(values, labels, c, average) {
    const W = 326, H = 150, n = values.length;
    const max = Math.max(1, average || 0, ...values) * 1.12;
    const x = (i) => (n === 1 ? W / 2 : 10 + (i * (W - 20)) / (n - 1));
    const y = (v) => H - (v / max) * H;
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    let svg = `<svg class="line" viewBox="0 0 ${W} ${H + 22}">
      <polygon points="${x(0)},${H} ${pts} ${x(n - 1)},${H}" fill="${c}" opacity=".16"/>
      <polyline points="${pts}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(n - 1)}" cy="${y(values[n - 1])}" r="5" fill="${c}" stroke="var(--card)" stroke-width="2"/>`;
    if (average) svg += `<line x1="0" x2="${W}" y1="${y(average)}" y2="${y(average)}" stroke="var(--sec)" stroke-dasharray="4 4"/>
      <text x="${W}" y="${y(average) - 6}" text-anchor="end" font-size="11" fill="var(--sec)">avg ${esc(shortMoney(average))}</text>`;
    labels.forEach((label, i) => {
      if (n <= 6 || i % 2 === (n - 1) % 2) svg += `<text x="${x(i)}" y="${H + 17}" text-anchor="middle" font-size="11" fill="var(--sec)">${esc(label)}</text>`;
    });
    return svg + "</svg>";
  }

  function trendsView() {
    const views = [["trends", "Trends"], ["recurring", "Recurring"], ["merchants", "Recipients"]];
    const seg = `<div class="seg wide">${views.map(([v, label]) => `<button data-act="trends-view" data-value="${v}" class="${state.trends === v ? "on" : ""}">${label}</button>`).join("")}</div>`;
    const body = { trends: categoryTrend, recurring: recurringList, merchants: merchantBubbles }[state.trends]();
    return `<div class="large first">${views.find(([v]) => v === state.trends)[1]}</div>${seg}${body}`;
  }

  // One category's money out per month, last 6 or 12 months up to this month.
  function categoryTrend() {
    const n = state.trendMonths;
    const yms = Array.from({ length: n }, (_, i) => shiftMonth(state.today, i - n + 1));
    const series = new Map();
    yms.forEach((ym, i) => {
      for (const c of categoryTotals(monthTx(ym))) {
        if (!c.category) continue;
        if (!series.has(c.category)) series.set(c.category, Array(n).fill(0));
        series.get(c.category)[i] = c.paise;
      }
    });
    if (!series.size) return `<div class="group"><div class="empty">Tag a few transactions to see how each category moves month to month.</div></div>`;
    const names = [...series.keys()].sort((a, b) => series.get(b).reduce((s, v) => s + v, 0) - series.get(a).reduce((s, v) => s + v, 0));
    const cat = series.has(state.trendCategory) ? state.trendCategory : names[0];
    const values = series.get(cat);
    const first = Math.max(0, yms.findIndex(hasMonth));
    const before = values.slice(first, -1);
    const average = before.length ? before.reduce((s, v) => s + v, 0) / before.length : 0;
    const now = values[n - 1];
    const pct = average ? Math.round((100 * (now - average)) / average) : null;
    const chips = names.map((name) => `<button class="pill ${name === cat ? "on" : ""}" data-act="trend-cat" data-value="${esc(name)}"><i class="dot" style="background:${colour(name)}"></i>${esc(name)}</button>`).join("");
    const range = [[6, "6M"], [12, "1Y"]].map(([m, label]) => `<button data-act="trend-months" data-value="${m}" class="${n === m ? "on" : ""}">${label}</button>`).join("");
    const rows = yms.map((ym, i) => [ym, values[i]]).slice(first).reverse()
      .map(([ym, v]) => `<button class="li plain" data-act="trend-month" data-ym="${ym}" data-value="${esc(cat)}"><div class="main"><div class="t1">${esc(monthLabel(ym))}</div></div><span class="val">${esc(money(v))}</span><span class="chev"></span></button>`).join("");
    return `<div class="strip">${chips}</div>
      <div class="group pad"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div style="min-width:0"><div class="muted">${esc(cat)} in ${esc(monthName(state.today))}</div><div class="big">${esc(money(now))}</div>
          <div class="small ${pct > 0 ? "up" : "down"}" style="font-weight:600">${pct === null ? "&nbsp;" : `${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${Math.abs(pct)}% vs your average`}</div></div>
        <div class="seg" style="flex:0 0 96px">${range}</div></div>
        ${lineChart(values.slice(first), yms.slice(first).map(monthName), colour(cat), average)}</div>
      <div class="sh">Each month</div><div class="group">${rows}</div>`;
  }

  function recurringList() {
    const today = todayIso();
    const day = Number(today.slice(8));
    const items = recurringPayments(tagAll(state.compiled, allTx()), today);
    if (!items.length) return `<div class="group"><div class="empty">Nothing repeats yet.</div></div>
      <div class="sf">A payment shows up here once FinTrack sees it in two months, around the same day and amount.</div>`;
    const monthly = items.reduce((s, r) => s + r.paise, 0);
    const mon = monthName(today.slice(0, 7));
    const row = (r) => {
      const when = r.paidThisMonth ? `paid ${Number(r.lastDate.slice(8))} ${mon}` : r.day > day ? `in ${plural(r.day - day, "day")}` : r.day === day ? "today" : `due ${r.day} ${mon}`;
      return `<button class="li" data-act="open-merchant" data-value="${esc(r.merchant)}" data-all="1">${icon(r.category)}
        <div class="main"><div class="t1">${esc(shortName(r.merchant))}</div><div class="t2">Monthly · ${plural(r.months, "month")}${r.varies ? " · varies" : ""}</div></div>
        <div class="amt">${esc(money(r.paise))}<small>${esc(when)}</small></div></button>`;
    };
    const coming = items.filter((r) => !r.paidThisMonth);
    const paid = items.filter((r) => r.paidThisMonth);
    return `<div class="group pad"><div class="muted">Every month</div><div class="big">${esc(money(monthly))}</div>
        <div class="muted small">${plural(items.length, "recurring payment")} · ${esc(money(monthly * 12))} a year</div></div>
      ${coming.length ? `<div class="sh">Coming up</div><div class="group">${coming.map(row).join("")}</div>` : ""}
      ${paid.length ? `<div class="sh">Paid this month</div><div class="group">${paid.map(row).join("")}</div>` : ""}
      <div class="sf">Spotted automatically: the same recipient, a similar amount and around the same day each month.</div>`;
  }

  // Circles sized by spend, packed outward from the biggest; the viewBox is fitted afterwards.
  function packBubbles(items) {
    const max = items[0].paise;
    const placed = [];
    for (const m of items) {
      const r = 24 + 38 * Math.sqrt(m.paise / max);
      let x = 0, y = 0;
      for (let t = 0; placed.length; t += 0.12) {
        x = 2.2 * t * Math.cos(t);
        y = 1.6 * t * Math.sin(t);
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + 3)) break;
      }
      placed.push({ m, r, x, y });
    }
    return placed;
  }

  function merchantBubbles() {
    const list = merchantTotals(periodTx());
    if (!list.length) return `${monthStrip()}<div class="group"><div class="empty">No spending in ${esc(periodLabel())}</div></div>`;
    const picked = list.find((m) => m.merchant === state.bubble) || list[0];
    const circles = packBubbles(list.slice(0, 14));
    const x0 = Math.min(...circles.map((c) => c.x - c.r)) - 4, x1 = Math.max(...circles.map((c) => c.x + c.r)) + 4;
    const y0 = Math.min(...circles.map((c) => c.y - c.r)) - 4, y1 = Math.max(...circles.map((c) => c.y + c.r)) + 4;
    const svg = circles.map(({ m, r, x, y }) => {
      const chars = Math.floor((r * 2) / 7.5);
      const short = shortName(m.merchant);
      const name = short.length > chars ? short.slice(0, Math.max(chars - 1, 1)) + "…" : short;
      return `<g data-act="bubble" data-value="${esc(m.merchant)}"><circle cx="${x}" cy="${y}" r="${r}" fill="${colour(m.category)}" opacity="${m === picked ? 1 : 0.8}" ${m === picked ? 'stroke="var(--text)" stroke-width="3"' : ""}/>
        ${r >= 24 ? `<text x="${x}" y="${y + (r >= 34 ? -2 : 4)}" text-anchor="middle" font-size="${r >= 44 ? 13 : 11}" font-weight="700" fill="#fff">${esc(name)}</text>` : ""}
        ${r >= 34 ? `<text x="${x}" y="${y + 14}" text-anchor="middle" font-size="11" fill="#fff" opacity=".85">${esc(shortMoney(m.paise))}</text>` : ""}</g>`;
    }).join("");
    const row = (m) => `<button class="li" data-act="open-merchant" data-value="${esc(m.merchant)}">${icon(m.category)}
      <div class="main"><div class="t1">${esc(shortName(m.merchant))}</div><div class="t2">${plural(m.count, "payment")} · ${esc(money(Math.round(m.paise / m.count / 100) * 100))} each</div></div>
      <div class="amt">${esc(money(m.paise))}</div><span class="chev"></span></button>`;
    return `${monthStrip()}
      <div class="group" style="padding:6px"><svg class="bubbles" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">${svg}</svg></div>
      <div class="group">${row(picked)}</div>
      <div class="sh">All recipients · ${esc(periodLabel())}</div><div class="group">${list.map(row).join("")}</div>`;
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
    for (const [key, label] of [["merchant", "recipient"], ["text", "SMS"], ["bank", "bank"], ["template", "template"]]) {
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
    const then = set.category ? `tag ${token(`${look(set.category)[1]} ${set.category}`, accent)}`
      : `<span class="muted">nothing: owner and tags are no longer used, so this rule can go</span>`;
    return `When ${parts.join(" and ") || "anything"}<br>then ${then}`;
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
      <div class="large">Rules<small>Checked top to bottom. The first rule that matches sets the category.</small></div>
      ${cards || `<div class="group"><div class="empty">No rules yet. Open a transaction, pick a category and turn on Always.</div></div>`}`;
  }

  // ---- Rule editor (grouped form) ----

  // Plain-name patterns become "is" / "contains" plus name chips; anything else is kept as is.
  function fieldsFromRule(rule) {
    const when = rule.when || {};
    const extra = {};
    for (const key of Object.keys(when)) if (!FORM_CONDITIONS.includes(key)) extra[key] = when[key];
    let recipients = [], exact = false, words = [];
    if (when.merchant != null) {
      if (isPlainPattern(when.merchant)) ({ exact, words: recipients } = patternWords(when.merchant));
      else extra.merchant = when.merchant;
    }
    if (when.text != null) {
      const p = patternWords(when.text);
      if (isPlainPattern(when.text) && !p.exact) words = p.words;
      else extra.text = when.text;
    }
    return {
      extra,
      more: words.length > 0 || when.account != null,
      newLook: null,
      fields: {
        recipients, exact, recipientInput: "", words, wordInput: "", direction: when.direction || "",
        minAmount: when.minAmount != null ? String(when.minAmount) : "", maxAmount: when.maxAmount != null ? String(when.maxAmount) : "",
        account: when.account || "", category: (rule.set || {}).category || "", catInput: "",
      },
    };
  }

  // Names typed but not yet added with Add still count.
  const withTyped = (list, typed) => (typed.trim() ? [...list, typed.trim()] : list);

  // Throws a readable message when a field is invalid.
  function ruleFromForm(screen) {
    const f = screen.fields;
    const when = { ...screen.extra };
    const recipients = withTyped(f.recipients, f.recipientInput);
    if (recipients.length) when.merchant = recipientPattern(recipients, f.exact);
    const words = withTyped(f.words, f.wordInput);
    if (words.length) when.text = recipientPattern(words, false);
    if (f.direction) when.direction = f.direction;
    if (f.account.trim()) when.account = f.account.trim();
    for (const key of ["minAmount", "maxAmount"]) {
      if (!f[key].trim()) continue;
      const n = Number(f[key].replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new Error(`${key === "minAmount" ? "Minimum" : "Maximum"} amount must be a number`);
      when[key] = n;
    }
    const rule = { when, set: f.category ? { category: f.category } : {} };
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

  // Removable name chips plus an input with Add, for a list field ("recipients" or "words").
  function nameList(screen, list, input, placeholder) {
    const names = screen.fields[list];
    const chips = names.map((w, i) => `<span class="namechip">${esc(w)}<button data-act="remove-word" data-list="${list}" data-i="${i}">×</button></span>`).join("");
    return `${chips ? `<div class="namechips">${chips}</div>` : ""}
      <div class="li plain"><input class="left" data-field="${input}" value="${esc(screen.fields[input])}" placeholder="${esc(names.length ? "Add another" : placeholder)}" autocapitalize="off" autocorrect="off">
        <button class="link" data-act="add-word" data-list="${list}">Add</button></div>`;
  }

  function ruleView(screen) {
    const f = screen.fields;
    const segOf = (act, options, current) => options.map(([v, label]) => `<button data-act="${act}" data-value="${v}" class="${current === v ? "on" : ""}">${label}</button>`).join("");
    const choices = knownCategories().slice(0, 12);
    if (f.category && !choices.includes(f.category)) choices.unshift(f.category);
    const cats = choices.map((name) => `<button data-act="rule-cat" data-value="${esc(name)}" class="${f.category === name ? "on" : ""}">${look(name)[1]} ${esc(name)}</button>`).join("");
    const extra = Object.keys(screen.extra).length ? `<div class="sf" style="margin-top:-12px">Also keeps: ${esc(describeRule({ when: screen.extra }, rupees).replace(/ → .*$/, ""))}</div>` : "";
    const editing = screen.index != null;
    return `<div class="nav"><button data-act="back">Cancel</button><span class="mid">${editing ? "Edit Rule" : "New Rule"}</span><button class="end" data-act="save-rule"><b>Save</b></button></div>
      <div style="height:8px"></div>
      <div class="sh">When</div>
      <div class="group">
        <div class="li plain"><span style="flex:1">Recipient</span><div class="seg">${segOf("match-mode", [["contains", "contains"], ["is", "is"]], f.exact ? "is" : "contains")}</div></div>
        ${nameList(screen, "recipients", "recipientInput", "Name, e.g. Swiggy")}
        <div class="li plain"><span style="flex:1">Money</span><div class="seg">${segOf("dir", [["out", "Out"], ["in", "In"], ["", "Either"]], f.direction)}</div></div>
        <div class="li plain"><span>Amount ₹</span><input data-field="minAmount" value="${esc(f.minAmount)}" placeholder="from" inputmode="decimal"><span class="muted">to</span><input data-field="maxAmount" value="${esc(f.maxAmount)}" placeholder="any" inputmode="decimal" style="flex:0 0 72px"></div>
        <button class="li plain" data-act="toggle-more"><span class="link" style="flex:1">${screen.more ? "Fewer conditions" : "More conditions"}</span></button>
        ${screen.more ? `<div class="li plain"><span class="muted small" style="flex:1">SMS mentions</span></div>${nameList(screen, "words", "wordInput", "Word, e.g. cashback")}${field(screen, "account", "Account", "last digits")}` : ""}
      </div>
      <div class="sf">${f.exact ? "<b>is</b>: the whole recipient name must match" : "<b>contains</b>: part of the name is enough, like swiggy in SWIGGY BANGALORE"}. Capital letters don't matter.</div>${extra}
      <div class="sh">Then set category</div>
      <div class="group">
        <div class="chips" style="padding-top:12px">${cats}</div>
        <div class="li plain"><input class="left" data-field="catInput" value="${esc(f.catInput)}" placeholder="New category" autocapitalize="words">
          <button class="link" data-act="rule-new-cat">Add</button></div>
        ${f.category && !screen.newLook ? `<button class="li plain" data-act="edit-look"><span class="link">Change Icon for ${esc(f.category)}</span></button>` : ""}
      </div>
      ${screen.newLook && screen.newLook.name === f.category ? lookPicker(screen.newLook) : ""}
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
      if (!rule.set.category) throw new Error("Pick a category.");
    } catch (e) {
      return showDialog("Can't save yet", cleanError(e));
    }
    const next = state.rules.slice();
    if (screen.index == null) next.unshift(rule);
    else next[screen.index] = rule;
    const payload = { rules: next };
    const lookChange = lookPayload(screen.newLook, rule.set.category);
    if (lookChange) payload.categories = lookChange;
    commit(payload, "Rule saved", describeRule(rule, rupees), { pop: true });
  }

  // ---- Saving through Scriptable ----

  function commit(payload, title, detail, options = {}) {
    const undo = {};
    if (payload.rules) undo.rules = state.rules;
    if (payload.categories) undo.categories = state.categories;
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
    state.categories = data.categories || {};
    setRules(data.rules || []);
  }

  function reply(result) {
    if (state.pending) return saved(result.ok, result.message);
    const options = state.pendingAction || {};
    state.pendingAction = null;
    if (result.data) useData(result.data);
    if (result.ym) {
      state.ym = result.ym;
      state.year = null;
    }
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
    if (p.payload.categories) state.categories = p.payload.categories;
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
    trends: '<svg viewBox="0 0 26 24"><rect x="3" y="12" width="5" height="9" rx="1.5"/><rect x="10.5" y="6" width="5" height="15" rx="1.5"/><rect x="18" y="2" width="5" height="19" rx="1.5"/></svg>',
    rules: '<svg viewBox="0 0 26 24"><rect x="2" y="3" width="22" height="4" rx="2"/><rect x="2" y="10" width="16" height="4" rx="2"/><rect x="2" y="17" width="19" height="4" rx="2"/></svg>',
    more: '<svg viewBox="0 0 26 24"><circle cx="5" cy="12" r="2.6"/><circle cx="13" cy="12" r="2.6"/><circle cx="21" cy="12" r="2.6"/></svg>',
  };

  function render() {
    if (!state.ym) {
      app.innerHTML = `<div class="large" style="padding-top:40px">FinTrack<small>Loading…</small></div>`;
      return;
    }
    const screen = top();
    state.previewLook = (screen && screen.newLook) || null;
    const views = { tx: txView, list: listView, rule: ruleView, unparsed: unparsedView };
    const body = screen ? views[screen.type](screen) : { spending: spendingView, trends: trendsView, rules: rulesView, more: moreView }[state.tab]();
    const tabs = screen ? "" : `<nav class="tabbar">${["spending", "trends", "rules", "more"]
      .map((id) => `<button data-act="tab" data-value="${id}" class="${state.tab === id ? "on" : ""}">${TAB_ICONS[id]}${id[0].toUpperCase() + id.slice(1)}</button>`).join("")}</nav>`;
    app.innerHTML = `<div class="screen ${screen ? "no-tabs" : ""}">${body}</div>${tabs}${dialogView()}`;
    const strip = app.querySelector(".strip");
    const on = strip && strip.querySelector(".on");
    if (on) strip.scrollLeft = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
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
    month: (el) => { state.ym = el.dataset.ym; state.year = null; render(); },
    year: (el) => { state.year = el.dataset.value; render(); },
    "trends-view": (el) => { state.trends = el.dataset.value; render(); window.scrollTo(0, 0); },
    "trend-cat": (el) => { state.trendCategory = el.dataset.value; render(); },
    "trend-months": (el) => { state.trendMonths = Number(el.dataset.value); render(); },
    "trend-month": (el) => {
      state.ym = el.dataset.ym;
      state.year = null;
      push({ type: "list", filter: el.dataset.value });
    },
    bubble: (el) => { state.bubble = el.dataset.value; render(); },
    "open-merchant": (el) => push({ type: "list", merchant: el.dataset.value, allTime: el.dataset.all === "1" }),
    back,
    "open-list": (el) => push({ type: "list", filter: el.dataset.filter }),
    "open-tx": (el) => {
      const tx = tagAll(state.compiled, [findTx(el.dataset.ym, el.dataset.id)])[0];
      push({ type: "tx", ym: el.dataset.ym, id: tx.id, draft: tx.category, always: false });
    },
    "pick-cat": (el) => { const s = top(); s.draft = el.dataset.value; if (s.newLook && s.newLook.name !== s.draft) s.newLook = null; render(); },
    "add-cat": () => {
      const s = top();
      const name = (s.newCat || "").trim();
      if (!name) return;
      s.draft = name;
      s.newCat = "";
      s.newLook = state.categories[name] ? null : startLook(name);
      render();
    },
    "edit-look": () => { const s = top(); s.newLook = startLook(s.type === "tx" ? s.draft : s.fields.category); render(); },
    "pick-emoji": (el) => { top().newLook.emoji = el.dataset.value; render(); },
    "pick-colour": (el) => { top().newLook.colour = el.dataset.value; render(); },
    "see-trend": (el) => {
      state.tab = "trends";
      state.trends = "trends";
      state.trendCategory = el.dataset.value;
      state.stack = [];
      render();
      window.scrollTo(0, 0);
    },
    "toggle-always": () => { top().always = !top().always; render(); },
    "save-tx": () => saveTx(top()),
    "new-rule": () => push({ type: "rule", index: null, ...fieldsFromRule({}) }),
    "edit-rule": (el) => { const i = Number(el.dataset.i); push({ type: "rule", index: i, ...fieldsFromRule(state.rules[i]) }); },
    dir: (el) => { top().fields.direction = el.dataset.value; render(); },
    "rule-cat": (el) => { const s = top(); s.fields.category = el.dataset.value; if (s.newLook && s.newLook.name !== s.fields.category) s.newLook = null; render(); },
    "rule-new-cat": () => {
      const s = top();
      const name = s.fields.catInput.trim();
      if (!name) return;
      s.fields.category = name;
      s.fields.catInput = "";
      s.newLook = state.categories[name] ? null : startLook(name);
      render();
    },
    "match-mode": (el) => { top().fields.exact = el.dataset.value === "is"; render(); },
    "toggle-more": () => { top().more = !top().more; render(); },
    "add-word": (el) => {
      const f = top().fields;
      const list = el.dataset.list;
      const input = list === "recipients" ? "recipientInput" : "wordInput";
      const word = f[input].trim();
      if (word && !f[list].some((w) => w.toLowerCase() === word.toLowerCase())) f[list].push(word);
      f[input] = "";
      render();
      const box = app.querySelector(`[data-field="${input}"]`);
      if (box) box.focus();
    },
    "remove-word": (el) => { top().fields[el.dataset.list].splice(Number(el.dataset.i), 1); render(); },
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
      showDialog("Delete Transaction?", `${shortName(recipient(tx))}, ${money(Math.abs(tx.amountPaise), tx.currency)}. This cannot be undone.`,
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

  const ENTER_ADDS = { newCat: "add-cat", catInput: "rule-new-cat", recipientInput: "add-word", wordInput: "add-word" };
  app.addEventListener("keydown", (e) => {
    const act = e.key === "Enter" && e.target.dataset && ENTER_ADDS[e.target.dataset.field];
    if (!act) return;
    e.preventDefault();
    const list = e.target.dataset.field === "wordInput" ? "words" : "recipients";
    actions[act]({ dataset: { list } });
  });

  function load(data) {
    useData(data);
    state.ym = data.currentMonth || Object.keys(state.months).sort().pop() || "2026-01";
    state.today = state.ym;
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
