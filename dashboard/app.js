// FinTrack dashboard. Scriptable shows this page in a WebView and calls fintrack.load(data) with
//   { months: { "YYYY-MM": [tx] }, rules: [rule], categories: { name: { emoji, colour } },
//     accounts: [bank], unparsed: [{ id, text }], version, currentMonth: "YYYY-MM" }.
// The page never writes files. Requests go out through fintrack.send({ action, ... }):
//   save { rules?: [rule], manual?: { ym, id, manual }, categories?: { name: look }, accounts?: [bank] },
//   pasteSms, copy { text }, deleteTx { ym, id }, clearUnparsed, update.
// Scriptable answers fintrack.reply({ ok, title?, message?, data?, ym? }); `data` replaces what
// fintrack.load gave. Saves are applied here only once the reply says ok.
// Needs FT.tags (lib/tags.js), FT.format (lib/format.js) and FT.accounts (lib/accounts.js) loaded first.

(function () {
  const { compileRules, tagsFor, tagAll, describeRule, ruleSentence, orList, patternWords, isPlainPattern, recipientPattern } = FT.tags;
  const { money, monthLabel, shiftMonth, totals, categoryTotals, merchantTotals, recurringPayments } = FT.format;
  const { checkAccounts, compileAccounts, accountLabel } = FT.accounts;
  const app = document.getElementById("app");

  const rupees = (n) => money(Math.round(n * 100));
  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const plural = (n, word) => `${n} ${n === 1 ? word : /[^aeiou]y$/.test(word) ? word.slice(0, -1) + "ies" : word + "s"}`;
  const monthName = (ym) => monthLabel(ym).split(" ")[0];
  const recipient = (tx) => tx.merchant || tx.bank || "Unknown";
  // Lists, titles and bubbles show at most 12 characters; the transaction detail shows the full name.
  const shortName = (name) => name.slice(0, 12).trimEnd();
  const FORM_CONDITIONS = ["merchant", "text", "direction", "minAmount", "maxAmount", "account"];

  // ---- Category look: saved in categories.json, else suggested from the name ----

  // First keyword found in the lower-cased name wins, so more specific words come first.
  // [keywords, colour, emojis]: the first emoji is the suggested icon, the rest are offered beside it.
  const SUGGEST = [
    [["coffee", "cafe"], "#a2845e", ["☕️", "🫖", "🧋", "🥐"]],
    [["food", "dining", "restaurant", "swiggy", "zomato", "lunch", "dinner"], "#ff9500", ["🍜", "🍕", "🍔", "🍛", "🥡", "🍽️"]],
    [["grocer", "vegetable", "fruit", "bigbasket", "blinkit", "zepto"], "#34c759", ["🥦", "🛒", "🍎", "🥕", "🥛", "🧺"]],
    [["snack"], "#ff9500", ["🍿", "🍪", "🍫", "🥨"]],
    [["cloth", "fashion", "apparel"], "#af52de", ["👕", "👗", "👟", "👜"]],
    [["shop", "amazon", "flipkart"], "#af52de", ["🛍️", "📦", "🛒", "🏬"]],
    [["flight", "travel", "trip", "holiday", "vacation"], "#007aff", ["✈️", "🧳", "🏖️", "🗺️", "🚆"]],
    [["hotel", "stay"], "#007aff", ["🏨", "🛏️", "🏕️"]],
    [["fuel", "petrol", "diesel"], "#ffcc00", ["⛽️", "🚗", "🛵"]],
    [["taxi", "cab", "uber", "ola", "auto", "transport", "commute", "metro"], "#007aff", ["🚕", "🛺", "🚇", "🚌", "🚗", "🛵"]],
    [["parking", "toll"], "#8e8e93", ["🅿️", "🚗", "🛣️"]],
    [["recharge", "mobile", "phone", "prepaid", "postpaid"], "#007aff", ["📱", "📶", "☎️"]],
    [["internet", "broadband", "wifi"], "#5ac8fa", ["🌐", "📶", "💻"]],
    [["electric", "power"], "#ffcc00", ["💡", "⚡️", "🔌"]],
    [["water"], "#5ac8fa", ["🚰", "💧", "🚿"]],
    [["gas", "lpg", "cylinder"], "#ff9500", ["🔥", "🍳"]],
    [["rent", "house", "home"], "#ff2d55", ["🏠", "🏡", "🔑", "🛋️"]],
    [["bill", "utilit"], "#ff3b30", ["🧾", "💡", "📄"]],
    [["maint", "repair"], "#8e8e93", ["🔧", "🛠️", "🧰", "🪛"]],
    [["subscri", "netflix", "spotify", "prime"], "#5856d6", ["📺", "🎵", "🎧", "🔁"]],
    [["movie", "entertain", "game"], "#ff375f", ["🎬", "🍿", "🎮", "🎟️", "🎭"]],
    [["health", "medic", "doctor", "pharma", "hospital"], "#ff2d55", ["💊", "🩺", "🏥", "🦷", "❤️‍🩹"]],
    [["gym", "fitness", "sport"], "#34c759", ["🏋️", "🏃", "🧘", "⚽️", "🏸"]],
    [["beauty", "salon", "spa", "groom"], "#ff2d55", ["💇", "💅", "💄", "🧴"]],
    [["school", "educat", "course", "book", "fees"], "#5ac8fa", ["📚", "🎓", "✏️", "🏫"]],
    [["kid", "baby", "child"], "#ff9500", ["🧸", "👶", "🍼", "🎒"]],
    [["pet"], "#a2845e", ["🐾", "🐶", "🐱", "🦴", "🐟"]],
    [["family", "parent"], "#ff9500", ["👪", "❤️", "🏠"]],
    [["gift"], "#ff2d55", ["🎁", "🎉", "💐", "🎂"]],
    [["donat", "charit"], "#34c759", ["🤲", "❤️", "🙏"]],
    [["insur"], "#30b0c7", ["🛡️", "☂️", "📄"]],
    [["loan", "emi"], "#8e8e93", ["🏦", "📆", "💰"]],
    [["card"], "#8e8e93", ["💳", "🏦"]],
    [["invest", "sip", "mutual", "stock"], "#34c759", ["📈", "💹", "🪙", "🏦"]],
    [["saving"], "#34c759", ["🐷", "💰", "🏦"]],
    [["salary", "income"], "#34c759", ["💼", "💰", "🏢"]],
    [["cashback", "reward"], "#30b0c7", ["💸", "🎁", "⭐️"]],
    [["refund"], "#30b0c7", ["↩️", "💸"]],
    [["interest"], "#34c759", ["💰", "📈", "🏦"]],
    [["receiv"], "#34c759", ["📥", "💰", "💵"]],
    [["transfer", "upi"], "#8e8e93", ["↔︎", "🔁", "🏦"]],
    [["cash", "atm"], "#34c759", ["💵", "🏧", "💰"]],
    [["test"], "#8e8e93", ["🧪"]],
  ];
  const PALETTE = ["#ff9500", "#34c759", "#af52de", "#007aff", "#5856d6", "#ff2d55", "#30b0c7", "#a2845e", "#5ac8fa", "#ff3b30", "#ffcc00", "#8e8e93"];
  const DEFAULT_EMOJI = "🏷️";
  const UNTAGGED = ["#aeaeb2", "?"];

  function suggestedGroup(name) {
    const lower = name.toLowerCase();
    return SUGGEST.find(([words]) => words.some((w) => lower.includes(w)));
  }

  function suggestLook(name) {
    const hit = suggestedGroup(name);
    if (hit) return [hit[1], hit[2][0]];
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return [PALETTE[Math.abs(h) % PALETTE.length], DEFAULT_EMOJI];
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

  // The first emoji in what was typed, whole: a flag, a skin tone or a family counts as one.
  const EMOJI = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*/u;
  function firstEmoji(text) {
    const m = (text || "").match(EMOJI);
    return m ? m[0] : null;
  }

  // Icons that fit the name, then icons other categories already use, then any emoji from the keyboard.
  // The icon picked last is always shown, even when it came from the keyboard.
  function lookPicker(newLook, name, emojiOpen) {
    const typed = (name || "").trim();
    const group = typed ? suggestedGroup(typed) : null;
    const forName = group ? group[2].slice() : [];
    const used = [...new Set(categoryUsage().map((u) => look(u.name)[1]))].filter((e) => e !== "?" && !forName.includes(e)).slice(0, 12);
    const rows = [forName.length ? [`For “${esc(typed)}”`, forName] : null, used.length ? ["Used by your categories", used] : null].filter(Boolean);
    if (!rows.some(([, list]) => list.includes(newLook.emoji))) {
      if (rows.length) rows[0][1].unshift(newLook.emoji);
      else rows.push(["Picked", [newLook.emoji]]);
    }
    const button = (e) => `<button data-act="pick-emoji" data-value="${e}" style="${e === newLook.emoji ? `background:${newLook.colour}` : ""}">${e}</button>`;
    const lists = rows.map(([label, list]) => `<div class="emoji-label">${label}</div><div class="emojis">${list.map(button).join("")}</div>`).join("");
    const any = emojiOpen
      ? `<input data-field="emojiInput" class="emoji-input" placeholder="Tap 😀 on the keyboard, pick one" autocomplete="off">`
      : `<button class="any-emoji" data-act="any-emoji">😀 Any emoji…</button>`;
    const swatches = PALETTE.map((c) => `<button data-act="pick-colour" data-value="${c}" class="${c === newLook.colour ? "on" : ""}" style="background:${c}"></button>`).join("");
    return `<div id="look-picker"><div class="sh">Icon</div><div class="group pad">${lists}${any}<div class="swatches">${swatches}</div></div></div>`;
  }

  // ---- State ----

  const state = {
    months: {},
    rules: [],
    compiled: [],
    categories: {}, // saved looks: { name: { emoji, colour } }
    previewLook: null, // { name, emoji, colour } being picked on the current screen
    accounts: [], // your own banks (lib/accounts.js)
    isSelf: () => null,
    unparsed: [],
    version: "",
    ym: null,
    year: null, // "YYYY" when Spending shows a whole year instead of state.ym
    today: null, // the month FinTrack was opened in
    tab: "spending",
    tabHistory: [], // tabs visited before this one, so a tab can offer "‹ previous tab"
    trends: "trends", // which view the Trends tab shows: trends | recurring | merchants
    trendCategory: null,
    trendMonths: 12,
    bubble: null, // recipient picked in the Recipients bubbles
    stack: [], // pushed screens: { type: "tx" | "list" | "rule" | "unparsed", ... }
    reorder: null, // while reordering the Rules list: rule indexes in their new order
    dialog: null,
    pending: null, // a save waiting for Scriptable's reply
    pendingAction: null, // options for any other request waiting for a reply
  };

  function setRules(rules) {
    state.rules = rules;
    state.compiled = compileRules(rules);
  }
  function setAccounts(banks) {
    state.accounts = banks;
    state.isSelf = compileAccounts(banks);
  }
  // Tagged copies for display. A self transfer gets `self` (why) and no category.
  // `manual.selfTransfer` marks only this transaction; account matching handles the usual cases.
  const tag = (list) => tagAll(state.compiled, list).map((tx) => {
    const self = tx.manual && tx.manual.selfTransfer
      ? { kind: "manual", match: "", label: "" }
      : state.isSelf(tx);
    return self ? { ...tx, self, category: null } : tx;
  });
  // What totals, categories and Insights count: everything except self transfers.
  const counted = (list) => list.filter((tx) => !tx.self);
  const monthTx = (ym) => tag(state.months[ym] || []);
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
    for (const tx of tag(allTx())) if (tx.category) count.set(tx.category, (count.get(tx.category) || 0) + 1);
    for (const name of Object.keys(state.categories)) if (!count.has(name)) count.set(name, 0);
    for (const name of ["Food", "Groceries", "Shopping", "Travel", "Bills", "Subscriptions"]) if (!count.has(name)) count.set(name, 0);
    return [...count].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  // Every category in use or with a saved look, busiest first:
  // { name, rules, tx, hand (set by hand), paise (money out in state.ym) }.
  function categoryUsage() {
    const use = new Map();
    const get = (name) => use.get(name) || use.set(name, { name, rules: 0, tx: 0, hand: 0, paise: 0 }).get(name);
    for (const rule of state.rules) if (rule.set && rule.set.category) get(rule.set.category).rules++;
    for (const tx of tag(allTx())) {
      if (!tx.category) continue;
      const u = get(tx.category);
      u.tx++;
      if (tx.manual && tx.manual.category === tx.category) u.hand++;
      if (tx.date.startsWith(state.ym) && tx.currency === "INR" && tx.amountPaise < 0) u.paise -= tx.amountPaise;
    }
    for (const name of Object.keys(state.categories)) get(name);
    return [...use.values()].sort((a, b) => b.tx - a.tx || a.name.localeCompare(b.name));
  }
  const usageOf = (name) => categoryUsage().find((u) => u.name === name) || { name, rules: 0, tx: 0, hand: 0, paise: 0 };

  // Save payload that moves category `from` to `to` (rename or merge), or deletes it when `to` is
  // null: its rules, hand-set transactions and saved look change together.
  function moveCategory(from, to) {
    const rules = [];
    for (const rule of state.rules) {
      if (!rule.set || rule.set.category !== from) rules.push(rule);
      else if (to) rules.push({ ...rule, set: { ...rule.set, category: to } });
    }
    const manual = [];
    for (const [ym, list] of Object.entries(state.months)) {
      for (const tx of list) {
        if (!tx.manual || tx.manual.category !== from) continue;
        const next = { ...tx.manual };
        if (to) next.category = to;
        else delete next.category;
        manual.push({ ym, id: tx.id, manual: next });
      }
    }
    const categories = { ...state.categories };
    const moved = categories[from];
    delete categories[from];
    if (to && moved && !categories[to]) categories[to] = moved;
    const payload = { categories };
    if (JSON.stringify(rules) !== JSON.stringify(state.rules)) payload.rules = rules;
    if (manual.length) payload.manual = manual;
    return payload;
  }

  // ---- Shared pieces ----

  const SELF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h13l-3-3m3 3-3 3M17 17H4l3 3m-3-3 3-3"/></svg>`;
  const selfIcon = (cls = "") => `<span class="ic self-icon ${cls}" style="background:#8e8e93">${SELF_ICON}</span>`;

  function txRow(tx) {
    const sub = tx.self ? "Self transfer" : tx.category ? esc(tx.category) : `<span class="warn">Needs a category</span>`;
    const where = [tx.bank, tx.account ? "··" + tx.account : null].filter(Boolean).join(" ");
    const day = Number(tx.date.slice(8));
    return `<button class="li" data-act="open-tx" data-ym="${esc(tx.date.slice(0, 7))}" data-id="${esc(tx.id)}">${tx.self ? selfIcon() : icon(tx.category)}
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
    const spent = yms.map((ym) => (totals(counted(monthTx(ym))).INR || { out: 0 }).out);
    const max = Math.max(1, ...spent);
    return `<div class="bars">${yms.map((ym, i) => `<button data-act="month" data-ym="${ym}" ${hasMonth(ym) ? "" : "disabled"}>
      <div class="b" style="height:${Math.max(2, (spent[i] / max) * 100)}%"></div><div class="l">${monthName(ym)[0]}</div></button>`).join("")}</div>`;
  }

  function switchTab(tab) {
    if (tab !== state.tab) state.tabHistory = [...state.tabHistory, state.tab].slice(-10);
    state.tab = tab;
    state.stack = [];
    state.reorder = null;
  }
  // Top-left of a tab: back to the tab you came from, so the spot under Scriptable's Close is ours.
  function tabBack() {
    const last = state.tabHistory[state.tabHistory.length - 1];
    return last ? `<button data-act="tab-back">‹ ${esc(TAB_LABELS[last])}</button>` : "<span></span>";
  }

  function backNav(title, end = "") {
    const back = state.stack.length > 1 ? "Back" : TAB_LABELS[state.tab];
    return `<div class="nav"><button data-act="back">‹ ${esc(back)}</button><span class="mid">${esc(title)}</span><span class="end">${end}</span></div>`;
  }

  // ---- Spending (Wallet style) ----

  function categoryRows(list) {
    const counts = new Map();
    for (const tx of list) if (tx.currency === "INR" && tx.amountPaise < 0) counts.set(tx.category || null, (counts.get(tx.category || null) || 0) + 1);
    return categoryTotals(list)
      .map((c) => `<button class="li" data-act="open-list" data-filter="${esc(c.category || "untagged")}">${icon(c.category)}
        <div class="main"><div class="t1">${esc(c.category || "No Category")}</div><div class="t2">${plural(counts.get(c.category) || 0, "transaction")}</div></div>
        <div class="amt">${esc(money(c.paise))}</div><span class="chev"></span></button>`)
      .join("");
  }

  function spendingView() {
    const list = counted(periodTx());
    const t = totals(list);
    const spent = (t.INR || { out: 0 }).out;
    const received = (t.INR || { in: 0 }).in;
    let note;
    if (state.year) {
      const months = yearMonths(state.year).filter(hasMonth).length;
      note = months ? "₹2,14,724 on average over 6 months" : "";
    } else {
      const before = (totals(counted(monthTx(shiftMonth(state.ym, -1)))).INR || { out: 0 }).out;
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
          <div class="muted small">${esc([note, foreign.length ? "also " + foreign.join(", ") : ""].filter(Boolean).join(" · ") || "\u00a0")}</div>
          ${received ? `<button class="received" data-act="open-list" data-filter="received">Received <b class="in">${esc(money(received))}</b><span class="chev"></span></button>` : ""}</div></div>
      ${state.year ? `<div class="group pad"><div class="muted small">Each month · tap one to open it</div>${yearBars(state.year)}</div>` : ""}
      ${cats.length ? `<div class="sh">Categories</div><div class="group">${categoryRows(list)}</div>` : ""}
      ${untagged ? `<button class="card attention" data-act="open-list" data-filter="untagged">${icon(null)}<div style="flex:1"><div style="font-weight:600">${plural(untagged, "transaction")} need a category</div>
        <div class="muted small">Pick a category and turn on Always; FinTrack remembers.</div></div><span class="chev"></span></button>` : ""}
      <div class="sh2">Latest ${periodTx().length > Math.min(list.length, 5) ? `<button data-act="open-list" data-filter="all">See All</button>` : ""}</div>
      <div class="group">${list.slice(0, 5).map(txRow).join("") || `<div class="empty">No transactions in ${esc(periodLabel())}</div>`}</div>`;
  }

  function listView(screen) {
    if (screen.hand) {
      const shown = tag(allTx()).filter((t) => t.manual && t.manual.category === screen.hand).sort((a, b) => (a.date < b.date ? 1 : -1));
      return `${backNav("Set by Hand")}<div style="height:8px"></div>
      <div class="group">${shown.map(txRow).join("") || `<div class="empty">Nothing here</div>`}</div>`;
    }
    if (screen.merchant) {
      const all = screen.allTime ? tag(allTx()).sort((a, b) => (a.date < b.date ? 1 : -1)) : periodTx();
      const shown = all.filter((t) => recipient(t) === screen.merchant);
      return `${backNav(shortName(screen.merchant))}<div style="height:8px"></div>
      <div class="group">${shown.map(txRow).join("") || `<div class="empty">Nothing here</div>`}</div>`;
    }
    const list = periodTx();
    const special = {
      all: [periodLabel(), () => true],
      untagged: ["Needs a Category", (t) => !t.category && !t.self],
      received: [`Received · ${periodLabel()}`, (t) => t.amountPaise > 0 && !t.self],
    }[screen.filter];
    const shown = list.filter(special ? special[1] : (t) => t.category === screen.filter);
    const title = special ? special[0] : screen.filter;
    const isCategory = !special && state.tab !== "trends";
    return `${backNav(title, isCategory ? `<button data-act="see-trend" data-value="${esc(screen.filter)}">See Trend</button>` : "")}<div style="height:8px"></div>
      <div class="group">${shown.map(txRow).join("") || `<div class="empty">Nothing here</div>`}</div>`;
  }

  // ---- Transaction detail: pick a category, optionally Always ----

  function txHead(tx, iconHtml) {
    const when = `${Number(tx.date.slice(8))} ${monthLabel(tx.date.slice(0, 7))}`;
    return `<div style="text-align:center;padding:6px 16px 18px">${iconHtml}
        ${tx.merchant ? `<div class="muted small">${tx.amountPaise > 0 ? "Received from" : "Paid to"}</div>` : ""}
        <div style="font-size:22px;font-weight:700">${esc(recipient(tx))}</div>
        <div class="big ${tx.amountPaise > 0 && !tx.self ? "in" : ""}" style="font-size:40px">${esc(money(Math.abs(tx.amountPaise), tx.currency))}</div>
        <div class="muted">${esc([when, tx.bank, tx.account ? "··" + tx.account : null].filter(Boolean).join(" · "))}</div></div>`;
  }

  function txMessage(tx) {
    return `<div class="sh">Message</div>
      <div class="group pad muted small" style="line-height:1.4;user-select:text;-webkit-user-select:text">${esc(tx.raw)}</div>
      <div class="group">
        <button class="li plain" data-act="copy-sms"><span class="link">Copy SMS</span></button>
        <button class="li plain" data-act="delete-tx"><span class="danger">Delete Transaction</span></button></div>`;
  }

  // Why, by tx.self.kind (see compileAccounts): "you@okhsbc is your HSBC Savings ··6001."
  function selfView(tx) {
    const { kind, match, label } = tx.self;
    const why = {
      manual: "you marked this transaction by hand.",
      upi: `<b>${esc(match)}</b> is your ${esc(label)}.`,
      name: `<b>${esc(match)}</b> is how your ${esc(label)} shows when paid.`,
      neft: `<b>${esc(match)}</b> is your ${esc(label)}.`,
      bill: `<b>${esc(match)}</b> is how your ${esc(label)} bill shows.`,
      card: `it pays ${label ? `your <b>${esc(label)}</b>` : "your card"} bill.`,
    }[kind];
    return `${backNav("")}${txHead(tx, selfIcon("xl"))}
      <div class="group"><div class="li plain"><div class="main"><div class="t1">Kind</div></div><span class="val">Self Transfer</span></div></div>
      <div class="sf" style="margin-top:-12px">Not counted as spending or money received: ${why}</div>
      ${kind === "manual"
        ? `<div class="group"><button class="li plain" data-act="unmark-self"><span class="link">Change to Payment</span></button></div>`
        : `<div class="group"><button class="li plain" data-act="open-accounts"><span class="link">Open My Accounts</span></button></div>`}
      ${txMessage(tx)}`;
  }

  function txMenu() {
    return `<button class="tx-menu-dim" data-act="close-tx-menu" aria-label="Close menu"></button>
      <div class="tx-menu"><button data-act="mark-self">Mark as Self Transfer</button>
        <button data-act="close-tx-menu" class="muted">Cancel</button></div>`;
  }

  function txView(screen) {
    const tx = tag([findTx(screen.ym, screen.id)])[0];
    if (tx.self) return selfView(tx);
    const choices = knownCategories();
    if (screen.draft && !choices.includes(screen.draft)) choices.unshift(screen.draft);
    const rows = choices
      .map((name) => `<button class="li" data-act="pick-cat" data-value="${esc(name)}">${icon(name, "sq")}<div class="main"><div class="t1">${esc(name)}</div></div>${screen.draft === name ? `<span class="check">✓</span>` : ""}</button>`)
      .join("");
    const sameMerchant = tx.merchant ? allTx().filter((t) => t.merchant === tx.merchant).length : 0;
    return `${backNav("", `<span class="tx-actions"><button data-act="tx-menu" aria-label="More transaction actions">•••</button><button data-act="save-tx"><b>Save</b></button></span>`)}
      ${txHead(tx, icon(screen.draft, "xl"))}
      <div class="sh">Category</div>
      <div class="group">${rows}
        <button class="li plain" data-act="open-categories"><span class="link">Manage Categories…</span></button></div>
      ${tx.merchant ? `<div class="group"><button class="li plain" data-act="toggle-always"><div class="main"><div class="t1" style="white-space:normal">Always put ${esc(shortName(tx.merchant))} in ${esc(screen.draft || "…")}</div>
          <div class="t2">Applies to ${plural(sameMerchant, "transaction")} now and every future one</div></div><span class="toggle ${screen.always ? "on" : ""}"></span></button></div>` : ""}
      ${txMessage(tx)}${screen.txMenu ? txMenu() : ""}`;
  }

  function setManualSelf(isSelfTransfer) {
    const screen = top();
    const tx = findTx(screen.ym, screen.id);
    const manual = { ...(tx.manual || {}) };
    if (isSelfTransfer) manual.selfTransfer = true;
    else delete manual.selfTransfer;
    state.dialog = null;
    screen.txMenu = false;
    commit(
      { manual: { ym: screen.ym, id: tx.id, manual } },
      isSelfTransfer ? "Marked as Self Transfer" : "Changed to Payment",
      isSelfTransfer ? "This transaction will not count as spending or money received." : "This transaction will count normally again.",
      { detailOnly: true },
    );
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
    if (!payload.rules && !payload.manual) return back();
    const detail = payload.rules ? `Every ${shortName(tx.merchant)} transaction is now ${category}.` : `This transaction is now ${category}.`;
    commit(payload, payload.rules ? "Rule saved" : "Category saved", detail, { pop: true });
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
    const owned = state.accounts.filter((b) => b.account).length;
    const cards = state.accounts.reduce((n, b) => n + (b.cards || []).length, 0);
    const summary = owned || cards ? `${plural(owned, "bank account")} · ${plural(cards, "card")}` : "Not set up";
    return `<div class="large first">More</div>
      <div class="sh">You</div>
      <div class="group"><button class="li plain" data-act="open-accounts"><div class="main"><div class="t1">My Accounts</div><div class="t2">${esc(summary)}</div></div><span class="chev"></span></button></div>
      <div class="sf">Payments between these are self transfers and aren't counted as spending.</div>
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

  // ---- My Accounts: your banks, each with an optional account (plus UPI IDs) and cards ----

  const KNOWN_BANKS = ["SBI", "HSBC", "ICICI"];
  const BANK_COLOURS = { SBI: "#007aff", HSBC: "#ff3b30", ICICI: "#ff9500" };
  const bankIcon = (bank, glyph = "🏦", cls = "") => `<span class="ic ${cls}" style="background:${BANK_COLOURS[bank] || "#8e8e93"}">${glyph}</span>`;
  const hasBank = (name) => state.accounts.some((b) => b.bank.toLowerCase() === name.toLowerCase());
  const copyOf = (value) => JSON.parse(JSON.stringify(value));

  const navRow = (act, i, icon, title, sub) => `<button class="li" data-act="${act}" data-i="${i}">${icon}
      <div class="main"><div class="t1">${esc(title)}</div><div class="t2">${esc(sub)}</div></div><span class="chev"></span></button>`;
  const accountSub = (a) => [plural(a.upi.length, "UPI ID"), (a.names || []).length ? plural(a.names.length, "name") : ""].filter(Boolean).join(" · ");
  const cardSub = (c) => (c.bills.length ? `Bill shows as ${c.bills.join(", ")}` : "No bill name yet");
  // "Savings ··4321 · 1 card", "No account · 2 cards".
  const bankSub = (b) => [b.account ? accountLabel("", b.account).trim() : "No account", plural((b.cards || []).length, "card")].join(" · ");

  // One row per bank; its account and cards are on the bank's page.
  function accountsView() {
    const rows = state.accounts.map((b, i) => navRow("open-bank", i, bankIcon(b.bank, "🏛️"), b.bank, bankSub(b))).join("");
    return `${backNav("")}
      <div class="large">My Accounts</div>
      <div class="group">${rows}<button class="li plain" data-act="add-bank"><span class="link">Add Bank</span></button></div>
      <div class="sf">Payments between your own accounts, and card bill payments, are self transfers: not counted as spending or money received.
        Saved in FinTrack's iCloud folder with your transactions, never in the FinTrack code.</div>`;
  }

  function addBankView(screen) {
    const rows = KNOWN_BANKS.map((name) => (hasBank(name)
      ? `<div class="li plain" style="opacity:.4"><div class="main"><div class="t1">${name}</div></div><span class="val small">Added</span></div>`
      : `<button class="li plain" data-act="pick-bank" data-value="${name}"><div class="main"><div class="t1">${name}</div></div><span class="chev"></span></button>`)).join("");
    return `${backNav("Add Bank")}<div style="height:8px"></div>
      <div class="group">${rows}</div>
      <div class="sh">Other bank</div>
      <div class="group"><div class="li plain"><input class="left" data-field="otherInput" value="${esc(screen.otherInput)}" placeholder="Bank name" autocapitalize="characters" autocorrect="off">
        <button class="link" data-act="add-other-bank">Add</button></div></div>
      <div class="sf">FinTrack reads SMS from SBI, HSBC and ICICI. Another bank's SMS needs a new template first.</div>`;
  }

  // One row per item with Remove, then "Add …" which opens an input. `kind` is "upi" or "bill":
  // the actions are remove-<kind>, start-<kind>, add-<kind> and the typed text is screen[<kind>Input].
  function rowList(screen, items, kind, addLabel, placeholder) {
    const rows = items.map((item, i) => `<div class="li plain"><div class="main"><div class="t1">${esc(item)}</div></div>
      <button class="danger" data-act="remove-${kind}" data-i="${i}">Remove</button></div>`).join("");
    const adding = screen[`adding_${kind}`]
      ? `<div class="li plain"><input class="left" data-field="${kind}Input" value="${esc(screen[kind + "Input"] || "")}" placeholder="${esc(placeholder)}" autocapitalize="off" autocorrect="off">
        <button class="link" data-act="add-${kind}">Add</button></div>`
      : `<button class="li plain" data-act="start-${kind}"><span class="link">${addLabel}</span></button>`;
    return rows + adding;
  }

  const last4Input = (value) => `<input data-field="last4" value="${esc(value)}" placeholder="1234" inputmode="numeric" maxlength="4">`;

  // screen: { index (null until its first account or card is saved), draft: bank }. Nothing is edited
  // here; the account and each card open their own page, which saves the bank.
  function bankView(screen) {
    const d = screen.draft;
    const account = d.account
      ? navRow("open-account", 0, bankIcon(d.bank, "🏦"), accountLabel("", d.account).trim(), accountSub(d.account))
      : `<button class="li plain" data-act="add-account"><span class="link">Add Bank Account</span></button>`;
    const cards = d.cards.map((c, i) => navRow("open-card", i, bankIcon(d.bank, "💳"), accountLabel("", c).trim(), cardSub(c))).join("");
    return `${backNav("")}
      <div style="text-align:center;padding:6px 16px 18px">${bankIcon(d.bank, "🏛️", "xl")}
        <div style="font-size:22px;font-weight:700">${esc(d.bank)}</div><div class="muted small">${esc(bankSub(d))}</div></div>
      <div class="sh">Bank account</div>
      <div class="group">${account}</div>
      ${d.account ? "" : `<div class="sf" style="margin-top:-12px">Leave this out if you only have a card with ${esc(d.bank)}.</div>`}
      <div class="sh">Cards</div>
      <div class="group">${cards}<button class="li plain" data-act="add-card"><span class="link">Add Card</span></button></div>
      ${screen.index != null
        ? `<div class="group"><button class="li plain" data-act="delete-bank"><span class="danger">Delete ${esc(d.bank)}</span></button></div>`
        : `<div class="sf">${esc(d.bank)} is saved once you add its account or a card.</div>`}`;
  }

  const editNav = (title, act) => `<div class="nav"><button data-act="back">Cancel</button><span class="mid">${esc(title)}</span><button class="end" data-act="${act}"><b>Save</b></button></div>
      <div style="height:8px"></div>`;
  const parentBank = () => state.stack[state.stack.length - 2];

  // screen: { isNew, draft: account, upiInput, payeeInput }. Saving also saves its bank.
  function accountView(screen) {
    const d = screen.draft;
    const bank = parentBank().draft.bank;
    return `${editNav(screen.isNew ? "New Account" : accountLabel("", d).trim(), "save-account")}
      <div class="sh">${esc(bank)} account</div>
      <div class="group">
        <div class="li plain"><span>Last 4 digits</span>${last4Input(d.last4)}</div>
        <div class="li plain"><span>Name</span><input data-field="name" value="${esc(d.name)}" placeholder="e.g. Savings" autocapitalize="words"></div></div>
      <div class="sh">UPI IDs on this account</div>
      <div class="group">${rowList(screen, d.upi, "upi", "Add UPI ID", "e.g. name@okhsbc")}</div>
      <div class="sf">Money sent to or received from these counts as a self transfer. Each UPI app can give the account its own ID; add them all.</div>
      <div class="sh">Name shown when paid</div>
      <div class="group">${rowList(screen, d.names, "payee", "Add Name", "e.g. A KUMAR")}</div>
      <div class="sf">The name another bank's SMS gives when you pay this account, such as SBI's "trf to …". The whole name must match; capital letters don't matter.</div>
      ${screen.isNew ? "" : `<div class="group"><button class="li plain" data-act="delete-account"><span class="danger">Delete ${esc(accountLabel("", d).trim())}</span></button></div>
      <div class="sf" style="margin-top:-12px">Only this account; ${esc(bank)}'s cards stay.</div>`}`;
  }

  // screen: { cardIndex (null for a new card), draft: card, billInput }. Saving also saves its bank.
  function cardView(screen) {
    const d = screen.draft;
    const bank = parentBank().draft.bank;
    return `${editNav(screen.cardIndex == null ? "New Card" : accountLabel("", d).trim(), "save-card")}
      <div class="sh">${esc(bank)} card</div>
      <div class="group">
        <div class="li plain"><span>Last 4 digits</span>${last4Input(d.last4)}</div>
        <div class="li plain"><span>Name</span><input data-field="name" value="${esc(d.name)}" placeholder="e.g. Cashback" autocapitalize="words"></div></div>
      <div class="sh">Bill payment shows as</div>
      <div class="group">${rowList(screen, d.bills, "bill", "Add Bill Name", "e.g. SBI CARDS")}</div>
      <div class="sf">The name your bank's SMS gives when you pay this card's bill. Paying a name that contains it counts as a self transfer, so the card's purchases aren't counted twice. Capital letters don't matter. Add another only if a different bank shows the bill differently.</div>
      ${screen.cardIndex != null ? `<div class="group"><button class="li plain" data-act="delete-card"><span class="danger">Delete ${esc(accountLabel("", d).trim())}</span></button></div>` : ""}`;
  }

  // Saves the bank page's bank changed by `change(bank)`, then returns to the bank page showing it.
  function saveBank(change, title, detail) {
    const parent = parentBank();
    const bank = copyOf(parent.draft);
    change(bank);
    const after = () => {
      parent.draft = bank;
      if (parent.index == null) parent.index = state.accounts.length - 1;
    };
    saveAccounts(parent.index, bank, title, detail, { pop: true, after });
  }

  function saveAccount(screen, remove = false) {
    const d = screen.draft;
    const account = { last4: d.last4.trim(), name: d.name.trim(), upi: withTyped(d.upi, screen.upiInput || ""), names: withTyped(d.names, screen.payeeInput || "") };
    saveBank((bank) => { bank.account = remove ? null : account; }, remove ? "Account deleted" : "Account saved",
      `${accountLabel(parentBank().draft.bank, remove ? d : account)} is ${remove ? "gone" : "saved"}.`);
  }

  // Saves the whole list with `bank` at `index` (appended when null), or without it when bank is null.
  function saveAccounts(index, bank, title, detail, options = {}) {
    const next = state.accounts.slice();
    if (bank == null) next.splice(index, 1);
    else if (index == null) next.push(bank);
    else next[index] = bank;
    try {
      checkAccounts(next);
    } catch (e) {
      return showDialog("Can't save yet", String(e.message || e));
    }
    commit({ accounts: next }, title, detail, options);
  }

  function saveCard(screen, remove = false) {
    const card = { last4: screen.draft.last4.trim(), name: screen.draft.name.trim(), bills: withTyped(screen.draft.bills, screen.billInput) };
    saveBank((bank) => {
      if (remove) bank.cards.splice(screen.cardIndex, 1);
      else if (screen.cardIndex == null) bank.cards.push(card);
      else bank.cards[screen.cardIndex] = card;
    }, remove ? "Card deleted" : "Card saved", `${accountLabel(parentBank().draft.bank, remove ? screen.draft : card)} is ${remove ? "gone" : "saved"}.`);
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
    const views = [["trends", "Trends"], ["recurring", "Recurring"], ["merchants", "Paid To"]];
    const seg = `<div class="seg wide">${views.map(([v, label]) => `<button data-act="trends-view" data-value="${v}" class="${state.trends === v ? "on" : ""}">${label}</button>`).join("")}</div>`;
    const body = { trends: categoryTrend, recurring: recurringList, merchants: merchantBubbles }[state.trends]();
    return `<div class="large first">Insights</div>${seg}${body}`;
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
    if (!series.size) return `<div class="group"><div class="empty">Give a few transactions a category to see how each category moves month to month.</div></div>`;
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
    const items = recurringPayments(counted(tag(allTx())), today);
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
      <div class="sf">Spotted automatically: paid to the same name, a similar amount and around the same day each month.</div>`;
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
    const list = merchantTotals(counted(periodTx()));
    if (!list.length) return `${monthStrip()}<div class="group"><div class="empty">No spending in ${esc(periodLabel())}</div></div>`;
    const picked = list.find((m) => m.merchant === state.bubble) || list[0];
    const circles = packBubbles(list.slice(0, 14));
    const x0 = Math.min(...circles.map((c) => c.x - c.r)) - 4, x1 = Math.max(...circles.map((c) => c.x + c.r)) + 4;
    const y0 = Math.min(...circles.map((c) => c.y - c.r)) - 4, y1 = Math.max(...circles.map((c) => c.y + c.r)) + 4;
    const svg = circles.map(({ m, r, x, y }) => {
      const chars = Math.floor((r * 2) / 7.5);
      const short = shortName(m.merchant);
      const name = short.slice(0, Math.max(chars, 1));
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
      <div class="sh">Everyone you paid · ${esc(periodLabel())}</div><div class="group">${list.map(row).join("")}</div>`;
  }

  // ---- Rules (Shortcuts-style sentences) ----

  function token(text, c) {
    return `<span class="tok" style="--c:${c}">${esc(text)}</span>`;
  }

  // The rule's sentence as HTML (see ruleSentence). `edit(kind)` returns a data-act for the parts
  // that open a sheet in the editor, or nothing for the plain Rules list.
  function sentence(rule, edit = () => "") {
    const category = (rule.set || {}).category;
    const accent = category ? colour(category) : "var(--blue)";
    const DIR = { out: "var(--red)", in: "var(--green)" };
    const tok = (text, c, kind) => {
      const act = edit(kind);
      return act ? `<button class="tok edit" style="--c:${c}" data-act="${act}" data-value="${kind}">${esc(text)}</button>` : token(text, c);
    };
    return ruleSentence(rule, rupees).map((p) => {
      if (typeof p === "string") return esc(p);
      if (p.words) return orList(p.words.map((w) => tok(w, p.kind === "other" ? "#8e8e93" : accent, p.kind)));
      if (p.kind === "dir") return DIR[(rule.when || {}).direction] || edit("dir") ? tok(p.text, DIR[(rule.when || {}).direction] || "var(--blue)", "dir") : esc(p.text);
      if (p.kind === "category") {
        if (category) return tok(`${look(category)[1]} ${category}`, accent, "category");
        return edit("category") ? tok("pick a category", "var(--blue)", "category") : `<span class="muted">nothing: owner and tags are no longer used, so this rule can go</span>`;
      }
      return tok(p.text, "#8e8e93", p.kind);
    }).join("");
  }

  function ruleCard(i, position, txs) {
    const hits = txs.filter(state.compiled[i].matches).length;
    const lbl = `<div class="lbl"><span>${plural(hits, "transaction")}</span><span class="pos">${position + 1}</span></div>`;
    if (state.reorder) return `<div class="sentence moving" data-i="${i}"><div class="body">${lbl}${sentence(state.rules[i])}</div><span class="grip">≡</span></div>`;
    return `<button class="sentence" data-act="edit-rule" data-i="${i}">${lbl}${sentence(state.rules[i])}</button>`;
  }

  const REORDER_ICON = '<svg viewBox="0 0 24 24"><path d="M8 4v15"/><path d="M4.5 7.5 8 4l3.5 3.5"/><path d="M16 20V5"/><path d="M12.5 16.5 16 20l3.5-3.5"/></svg>';

  function rulesView() {
    const txs = allTx();
    const reorder = state.reorder;
    const order = reorder || state.rules.map((_, i) => i);
    const cards = order.map((i, position) => ruleCard(i, position, txs)).join("");
    const used = categoryUsage();
    const glyphs = used.slice(0, 7).map((u) => look(u.name)[1]).join(" ") + (used.length > 7 ? ` +${used.length - 7}` : "");
    const reorderButton = state.rules.length > 1 ? `<button class="reorder ${reorder ? "on" : ""}" data-act="reorder" aria-label="Reorder">${REORDER_ICON}</button>` : "";
    const end = reorder ? reorderButton : `${reorderButton}<button data-act="new-rule" class="plus">＋</button>`;
    const hint = reorder
      ? `<small class="live">Drag ≡ to change the order. Tap <span class="inline-icon">${REORDER_ICON}</span> again to save.</small>`
      : "<small>Checked top to bottom. The first rule that matches sets the category.</small>";
    return `<div class="nav">${reorder ? `<button data-act="reorder-cancel">Cancel</button>` : tabBack()}<span class="mid"></span><span class="end rules-end">${end}</span></div>
      <div class="large">Rules${hint}</div>
      <div class="group"><button class="li" data-act="open-categories"><span class="ic" style="background:#ff9500">🏷️</span>
        <div class="main"><div class="t1">Categories</div><div class="t2">${esc(glyphs || "None yet")}</div></div><span class="val">${used.length}</span><span class="chev"></span></button></div>
      <div class="sh">Rules</div>
      ${cards || `<div class="group"><div class="empty">No rules yet. Open a transaction, pick a category and turn on Always.</div></div>`}`;
  }

  // ---- Categories: list, one category, merge ----

  function categoriesView() {
    const rows = categoryUsage()
      .map((u) => `<button class="li" data-act="open-category" data-value="${esc(u.name)}">${icon(u.name)}
        <div class="main"><div class="t1">${esc(u.name)}</div><div class="t2">${u.rules ? plural(u.rules, "rule") : "No rules"} · ${plural(u.tx, "transaction")}</div></div>
        <div class="amt">${u.paise ? esc(money(u.paise)) : ""}</div><span class="chev"></span></button>`)
      .join("");
    return `${backNav("")}
      <div class="large">Categories<small>Amounts are what you paid in ${esc(monthLabel(state.ym))}</small></div>
      <div class="group">${rows || `<div class="empty">No categories yet</div>`}</div>
      <div class="group"><button class="li plain" data-act="new-category"><span class="link">New Category</span></button></div>`;
  }

  // screen: { name (null for a new one), nameInput, newLook, showLook, lookTouched }
  function categoryView(screen) {
    const isNew = screen.name == null;
    const lk = screen.newLook || startLook(screen.name);
    const head = `<div style="text-align:center;padding:6px 16px 18px"><span class="ic xl" style="background:${lk.colour}">${lk.emoji}</span>
      <div style="font-size:22px;font-weight:700">${esc(isNew ? screen.nameInput || "New Category" : screen.name)}</div>`;
    const nameRow = `<div class="li plain"><span>Name</span><input data-field="nameInput" value="${esc(screen.nameInput)}" placeholder="e.g. Pets" autocapitalize="words"></div>`;
    const nav = backNav("", `<button data-act="save-category"><b>${isNew ? "Save" : "Done"}</b></button>`);
    if (isNew) {
      return `${nav}${head}<div class="muted small">An icon is suggested from the name; pick another if you like.</div></div>
        <div class="group">${nameRow}</div>${lookPicker(lk, screen.nameInput, screen.emojiOpen)}`;
    }
    const u = usageOf(screen.name);
    const txs = allTx();
    const cards = state.rules.map((rule, i) => (rule.set && rule.set.category === screen.name ? ruleCard(i, i, txs) : "")).join("");
    const others = categoryUsage().length > 1;
    return `${nav}${head}<div class="muted">${esc(plural(u.tx, "transaction"))}${u.paise ? ` · ${esc(money(u.paise))} in ${esc(monthName(state.ym))}` : ""}</div></div>
      <div class="group">${nameRow}
        <button class="li plain" data-act="toggle-look"><div class="main"><div class="t1">Icon &amp; Colour</div></div>
          <span class="val">${lk.emoji} <i class="swatch" style="background:${lk.colour}"></i></span><span class="chev ${screen.showLook ? "open" : ""}"></span></button></div>
      ${screen.showLook ? lookPicker(lk, screen.nameInput, screen.emojiOpen) : ""}
      <div class="sh">Rules that set ${esc(screen.name)}</div>
      ${cards}
      <div class="group"><button class="li plain" data-act="new-rule" data-category="${esc(screen.name)}"><span class="link">Add Rule for ${esc(screen.name)}</span></button></div>
      <div class="group">
        ${u.hand ? `<button class="li plain" data-act="open-hand" data-value="${esc(screen.name)}"><div class="main"><div class="t1">Set by Hand</div></div><span class="val">${u.hand}</span><span class="chev"></span></button>` : ""}
        <button class="li plain" data-act="see-trend" data-value="${esc(screen.name)}"><span class="link">See Trend</span></button></div>
      <div class="group">
        ${others ? `<button class="li plain" data-act="merge-category"><span class="link">Merge into Another Category…</span></button>` : ""}
        <button class="li plain" data-act="delete-category"><span class="danger">Delete ${esc(screen.name)}</span></button></div>
      <div class="sf" style="margin-top:-12px">Deleting removes ${plural(u.rules, "rule")} that set it. Its transactions then need a category unless another rule matches.</div>`;
  }

  function saveCategory(screen) {
    const name = (screen.nameInput || "").trim();
    if (!name) return showDialog("Name needed", "Give the category a name.");
    if (name.length > 40) return showDialog("Name too long", "Keep it to 40 characters.");
    const taken = name !== screen.name && categoryUsage().some((u) => u.name.toLowerCase() === name.toLowerCase());
    if (taken) return showDialog("Already exists", `There is already a category called ${name}.${screen.name == null ? "" : " Use Merge to combine them."}`);
    if (screen.name == null) {
      const [c, emoji] = screen.lookTouched ? [screen.newLook.colour, screen.newLook.emoji] : suggestLook(name);
      const from = state.stack[state.stack.length - 2];
      const fromRule = from && from.type === "rule";
      return commit({ categories: { ...state.categories, [name]: { emoji, colour: c } } }, "Category added", `${name} is ready to pick.`,
        { pop: true, quiet: fromRule, after: fromRule ? () => { top().fields.category = name; } : null });
    }
    if (name === screen.name) {
      const change = lookPayload(screen.newLook, name);
      if (!change) return back();
      return commit({ categories: change }, "Icon saved", `${name} has a new icon.`, { pop: true });
    }
    const payload = moveCategory(screen.name, name);
    const lk = screen.newLook || startLook(screen.name);
    payload.categories[name] = { emoji: lk.emoji, colour: lk.colour };
    commit(payload, "Category renamed", `${screen.name} is now ${name}.`, { pop: true });
  }

  function mergeView(screen) {
    const rows = categoryUsage()
      .filter((u) => u.name !== screen.from)
      .map((u) => `<button class="li" data-act="merge-into" data-value="${esc(u.name)}">${icon(u.name)}<div class="main"><div class="t1">${esc(u.name)}</div></div><span class="chev"></span></button>`)
      .join("");
    return `${backNav("Merge Into")}<div class="sf" style="margin-top:8px">${esc(screen.from)}'s rules and hand-set transactions move to the category you pick.</div>
      <div class="group">${rows}</div>`;
  }

  // ---- Rule editor: the rule's sentence, each part opening a sheet ----

  // Plain-name patterns become "part of" / "exactly" plus a list of names; anything else is kept as is.
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
      sheet: null,
      fields: {
        recipients, exact, recipientInput: "", words, wordInput: "", direction: when.direction || "",
        minAmount: when.minAmount != null ? String(when.minAmount) : "", maxAmount: when.maxAmount != null ? String(when.maxAmount) : "",
        account: when.account || "", category: (rule.set || {}).category || "",
      },
    };
  }

  // Names typed but not yet added with Add still count.
  const withTyped = (list, typed) => (typed.trim() ? [...list, typed.trim()] : list);

  // The rule as the editor stands. With `strict`, throws a readable message when a field is invalid;
  // without it, an amount that isn't a number yet is left out (for drawing the sentence while typing).
  function ruleFromForm(screen, strict = true) {
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
      if (Number.isFinite(n) && n >= 0) when[key] = n;
      else if (strict) throw new Error(`${key === "minAmount" ? "Lowest" : "Highest"} amount must be a number`);
    }
    const rule = { when, set: f.category ? { category: f.category } : {} };
    if (strict) compileRules([rule]);
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
    const hits = tag(allTx().filter(compileRules([rule])[0].matches)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const more = hits.length > 5 ? `<div class="li plain"><span class="muted">+${hits.length - 5} more</span></div>` : "";
    return `<div class="sh">Matches ${plural(hits.length, "transaction")}</div><div class="group">${hits.slice(0, 5).map(txRow).join("")}${more}</div>`;
  }

  // The parts the sheet edits: what each "Add to the sentence" row says, and whether the rule has it.
  const RULE_PARTS = [
    ["names", (f) => ({ out: "Name you pay", in: "Name you get money from" }[f.direction] || "Name you pay or get money from"), (f) => f.recipients.length > 0],
    ["amount", () => "Amount", (f) => Boolean(f.minAmount.trim() || f.maxAmount.trim())],
    ["account", () => "Account", (f) => Boolean(f.account.trim())],
    ["words", () => "Word the SMS says", (f) => f.words.length > 0],
  ];

  // Rows with Remove for a list field ("recipients" or "words"), then an input with Add.
  function wordRows(screen, list, input, placeholder) {
    const rows = screen.fields[list].map((w, i) => `<div class="li plain"><div class="main"><div class="t1">${esc(w)}</div></div>
      <button class="danger" data-act="remove-word" data-list="${list}" data-i="${i}">Remove</button></div>`).join("");
    return `${rows}<div class="li plain"><input class="left" data-field="${input}" value="${esc(screen.fields[input])}" placeholder="${esc(placeholder)}" autocapitalize="off" autocorrect="off">
      <button class="link" data-act="add-word" data-list="${list}">Add</button></div>`;
  }

  const removePart = (kind) => `<div class="group"><button class="li plain" data-act="clear-part" data-value="${kind}"><span class="danger">Remove from Sentence</span></button></div>`;

  function ruleSheet(screen) {
    const f = screen.fields;
    const tick = (on) => (on ? `<span class="link">✓</span>` : "");
    const amountRow = (key, label, placeholder) => `<div class="li plain"><span>${label}</span><input data-field="${key}" value="${esc(f[key])}" placeholder="${placeholder}" inputmode="decimal"></div>`;
    const body = {
      dir: () => `<div class="sh">When I …</div><div class="group">${[["out", "pay", "money goes out"], ["in", "receive money", "money comes in"], ["", "pay or get money", "either way"]]
        .map(([v, label, note]) => `<button class="li plain" data-act="dir" data-value="${v}"><div class="main"><div class="t1">${label}</div><div class="t2">${note}</div></div>${tick(f.direction === v)}</button>`).join("")}</div>`,
      names: () => `<div class="sh">Names</div><div class="group">${wordRows(screen, "recipients", "recipientInput", "Name, e.g. Swiggy")}</div>
        <div class="sh">A name matches</div><div class="group">
          <button class="li plain" data-act="match-mode" data-value="contains"><div class="main"><div class="t1">Part of the name</div><div class="t2">swiggy matches SWIGGY BANGALORE</div></div>${tick(!f.exact)}</button>
          <button class="li plain" data-act="match-mode" data-value="is"><div class="main"><div class="t1">Exactly</div><div class="t2">the whole name, as the SMS gives it</div></div>${tick(f.exact)}</button></div>
        <div class="sf">Capital letters don't matter.</div>${f.recipients.length ? removePart("names") : ""}`,
      words: () => `<div class="sh">The SMS says</div><div class="group">${wordRows(screen, "words", "wordInput", "Word, e.g. cashback")}</div>
        <div class="sf">Any of these anywhere in the message. Capital letters don't matter.</div>${f.words.length ? removePart("words") : ""}`,
      amount: () => `<div class="sh">Amount in ₹</div><div class="group">${amountRow("minAmount", "At least", "any")}${amountRow("maxAmount", "Up to", "any")}</div>
        <div class="sf">Leave one empty for no limit that way.</div>${f.minAmount.trim() || f.maxAmount.trim() ? removePart("amount") : ""}`,
      account: () => `<div class="sh">Account</div><div class="group"><div class="li plain"><span>Last digits</span><input data-field="account" value="${esc(f.account)}" placeholder="1234" inputmode="numeric"></div></div>
        <div class="sf">The account or card digits the SMS shows.</div>${f.account.trim() ? removePart("account") : ""}`,
      category: () => {
        const choices = knownCategories();
        if (f.category && !choices.includes(f.category)) choices.unshift(f.category);
        return `<div class="sh">It's</div><div class="group">${choices.map((name) => `<button class="li" data-act="rule-cat" data-value="${esc(name)}">${icon(name)}<div class="main"><div class="t1">${esc(name)}</div></div>${tick(f.category === name)}</button>`).join("")}
          <button class="li plain" data-act="new-category"><span class="link">New Category…</span></button></div>`;
      },
    }[screen.sheet];
    return `<div class="sheet-dim" data-act="close-sheet"></div><div class="sheet"><div class="grab"></div>
      <div class="nav"><span></span><span class="mid"></span><button class="end" data-act="close-sheet"><b>Done</b></button></div>${body()}</div>`;
  }

  function ruleView(screen) {
    const f = screen.fields;
    const editable = { dir: true, names: Boolean(f.recipients.length || f.recipientInput.trim()), words: Boolean(f.words.length || f.wordInput.trim()), amount: true, account: true, category: true };
    const rule = ruleFromForm(screen, false);
    const adds = RULE_PARTS.filter(([kind, , has]) => !has(f) && !(kind === "names" && screen.extra.merchant) && !(kind === "words" && screen.extra.text))
      .map(([kind, label]) => `<button class="li plain" data-act="open-sheet" data-value="${kind}"><span class="link">+ ${esc(label(f))}</span></button>`).join("");
    const editing = screen.index != null;
    return `<div class="nav"><button data-act="back">Cancel</button><span class="mid">${editing ? "Edit Rule" : "New Rule"}</span><button class="end" data-act="save-rule"><b>Save</b></button></div>
      <div style="height:8px"></div>
      <div class="group rule-sentence">${sentence(rule, (kind) => (editable[kind] ? "open-sheet" : ""))}</div>
      <div class="sf">Tap an outlined word to change it.</div>
      ${adds ? `<div class="sh">Add to the sentence</div><div class="group">${adds}</div>` : ""}
      <div id="preview">${previewHtml(screen)}</div>
      ${editing ? `<div class="group"><button class="li plain" data-act="delete-rule"><span class="danger">Delete Rule</span></button></div>` : ""}
      ${screen.sheet ? ruleSheet(screen) : ""}`;
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
    commit({ rules: next }, "Rule saved", describeRule(rule, rupees), { pop: true });
  }

  // ---- Saving through Scriptable ----

  function commit(payload, title, detail, options = {}) {
    const undo = {};
    if (payload.rules) undo.rules = state.rules;
    if (payload.categories) undo.categories = state.categories;
    if (payload.accounts) undo.accounts = state.accounts;
    if (payload.manual) {
      const before = (m) => ({ ...m, manual: (findTx(m.ym, m.id) || {}).manual || {} });
      undo.manual = Array.isArray(payload.manual) ? payload.manual.map(before) : before(payload.manual);
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
    setAccounts(data.accounts || []);
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
    if (p.payload.accounts) setAccounts(p.payload.accounts);
    for (const m of [].concat(p.payload.manual || [])) {
      const tx = findTx(m.ym, m.id);
      if (tx) tx.manual = m.manual;
    }
    const changed = txs.filter((tx, i) => JSON.stringify(tagsFor(state.compiled, tx)) !== before[i]).length;
    state.stack.length = Math.max(0, state.stack.length - (p.pop === true ? 1 : p.pop || 0));
    // An undone accounts change leaves any open bank or card page out of date.
    if (p.isUndo && p.payload.accounts) state.stack = state.stack.slice(0, state.stack.findIndex((s) => s.type === "accounts") + 1);
    if (p.after) p.after();
    if (!p.quiet) {
      const selfCount = tag(txs).filter((tx) => tx.self).length;
      state.dialog = {
        title: p.title,
        text: p.detailOnly
          ? p.detail
          : `${p.detail}\n${p.payload.accounts ? `${plural(selfCount, "self transfer")} across all your transactions.` : `${plural(changed, "transaction")} changed category.`}`,
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

  const TAB_LABELS = { spending: "Spending", trends: "Insights", rules: "Rules", more: "More" };
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
    const views = { tx: txView, list: listView, rule: ruleView, unparsed: unparsedView, categories: categoriesView, category: categoryView, merge: mergeView,
      accounts: accountsView, "add-bank": addBankView, bank: bankView, account: accountView, card: cardView };
    let body = screen ? views[screen.type](screen) : { spending: spendingView, trends: trendsView, rules: rulesView, more: moreView }[state.tab]();
    if (!screen && state.tab !== "rules" && state.tabHistory.length) body = `<div class="nav">${tabBack()}<span class="mid"></span><span class="end"></span></div>${body}`;
    const tabs = screen ? "" : `<nav class="tabbar">${["spending", "trends", "rules", "more"]
      .map((id) => `<button data-act="tab" data-value="${id}" class="${state.tab === id ? "on" : ""}">${TAB_ICONS[id]}${TAB_LABELS[id]}</button>`).join("")}</nav>`;
    app.innerHTML = `<div class="screen ${screen ? "no-tabs" : ""}">${body}</div>${tabs}${dialogView()}`;
    const strip = app.querySelector(".strip");
    const on = strip && strip.querySelector(".on");
    if (on) strip.scrollLeft = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
  }

  function startAdding(kind) {
    top()[`adding_${kind}`] = true;
    render();
    const box = app.querySelector(`[data-field="${kind}Input"]`);
    if (box) box.focus();
  }

  const ITEM_LISTS = { upi: (s) => s.draft.upi, payee: (s) => s.draft.names, bill: (s) => s.draft.bills };

  // Adds what is typed in `<kind>Input` to the screen's list, once whatever the capitals.
  function addItem(kind) {
    const s = top();
    const list = ITEM_LISTS[kind](s);
    const value = (s[`${kind}Input`] || "").trim();
    if (value && !list.some((x) => x.toLowerCase() === value.toLowerCase())) list.push(value);
    s[`${kind}Input`] = "";
    render();
    const box = app.querySelector(`[data-field="${kind}Input"]`);
    if (box) box.focus();
  }

  function removeItem(kind, el) {
    ITEM_LISTS[kind](top()).splice(Number(el.dataset.i), 1);
    render();
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
    tab: (el) => { switchTab(el.dataset.value); render(); window.scrollTo(0, 0); },
    "tab-back": () => {
      state.tab = state.tabHistory.pop();
      state.stack = [];
      render();
      window.scrollTo(0, 0);
    },
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
      const tx = tag([findTx(el.dataset.ym, el.dataset.id)])[0];
      push({ type: "tx", ym: el.dataset.ym, id: tx.id, draft: tx.category, always: false });
    },
    "pick-cat": (el) => { top().draft = el.dataset.value; render(); },
    "pick-emoji": (el) => { top().newLook.emoji = el.dataset.value; top().lookTouched = true; top().emojiOpen = false; render(); },
    "any-emoji": () => {
      top().emojiOpen = true;
      render();
      const box = app.querySelector('[data-field="emojiInput"]');
      if (box) box.focus();
    },
    "pick-colour": (el) => { top().newLook.colour = el.dataset.value; top().lookTouched = true; render(); },
    "open-categories": () => push({ type: "categories" }),
    "open-category": (el) => push({ type: "category", name: el.dataset.value, nameInput: el.dataset.value, newLook: null, showLook: false }),
    "new-category": () => {
      if (top() && top().type === "rule") top().sheet = null;
      push({ type: "category", name: null, nameInput: "", newLook: { name: "", emoji: DEFAULT_EMOJI, colour: "#8e8e93" }, showLook: true, lookTouched: false });
    },
    "toggle-look": () => {
      const s = top();
      s.showLook = !s.showLook;
      if (s.showLook && !s.newLook) s.newLook = startLook(s.name);
      render();
    },
    "save-category": () => saveCategory(top()),
    "open-hand": (el) => push({ type: "list", hand: el.dataset.value }),
    "merge-category": () => push({ type: "merge", from: top().name }),
    "merge-into": (el) => {
      const from = top().from;
      const to = el.dataset.value;
      const u = usageOf(from);
      showDialog(`Merge ${from} into ${to}?`, `${plural(u.rules, "rule")} and ${plural(u.hand, "hand-set transaction")} move to ${to}, and ${from} goes away.`,
        [["Cancel", "close"], ["Merge", "merge-confirm", true]], { from, to });
    },
    "merge-confirm": () => {
      const { from, to } = state.dialog;
      state.dialog = null;
      commit(moveCategory(from, to), "Categories merged", `${from} is now part of ${to}.`, { pop: 2 });
    },
    "delete-category": () => {
      const name = top().name;
      showDialog(`Delete ${name}?`, `${plural(usageOf(name).rules, "rule")} that set it will be removed.`, [["Cancel", "close"], ["Delete", "delete-category-confirm", true]], { name });
    },
    "delete-category-confirm": () => {
      const { name } = state.dialog;
      state.dialog = null;
      commit(moveCategory(name, null), "Category deleted", `${name} is gone.`, { pop: true });
    },
    "see-trend": (el) => {
      switchTab("trends");
      state.trends = "trends";
      state.trendCategory = el.dataset.value;
      render();
      window.scrollTo(0, 0);
    },
    "toggle-always": () => { top().always = !top().always; render(); },
    "save-tx": () => saveTx(top()),
    "tx-menu": () => { top().txMenu = !top().txMenu; render(); },
    "close-tx-menu": () => { top().txMenu = false; render(); },
    "mark-self": () => {
      top().txMenu = false;
      showDialog(
        "Mark as Self Transfer?",
        "It will not count as spending or money received.",
        [["Cancel", "close"], ["Mark", "mark-self-confirm"]],
      );
    },
    "mark-self-confirm": () => setManualSelf(true),
    "unmark-self": () => setManualSelf(false),
    "new-rule": (el) => push({ type: "rule", index: null, ...fieldsFromRule(el.dataset.category ? { set: { category: el.dataset.category } } : {}) }),
    reorder: () => {
      const order = state.reorder;
      if (!order) {
        state.reorder = state.rules.map((_, i) => i);
        return render();
      }
      state.reorder = null;
      if (order.every((i, position) => i === position)) return render();
      render();
      commit({ rules: order.map((i) => state.rules[i]) }, "Order saved", "Rules are now checked in the new order.");
    },
    "reorder-cancel": () => { state.reorder = null; render(); },
    "edit-rule": (el) => { const i = Number(el.dataset.i); push({ type: "rule", index: i, ...fieldsFromRule(state.rules[i]) }); },
    dir: (el) => { top().fields.direction = el.dataset.value; top().sheet = null; render(); },
    "rule-cat": (el) => { top().fields.category = el.dataset.value; top().sheet = null; render(); },
    "match-mode": (el) => { top().fields.exact = el.dataset.value === "is"; render(); },
    "open-sheet": (el) => {
      top().sheet = el.dataset.value;
      render();
      const box = app.querySelector(".sheet input");
      if (box && !box.value && el.dataset.value !== "names" && el.dataset.value !== "words") box.focus();
    },
    "close-sheet": () => { top().sheet = null; render(); },
    "clear-part": (el) => {
      const f = top().fields;
      ({ names: () => { f.recipients = []; f.recipientInput = ""; }, words: () => { f.words = []; f.wordInput = ""; },
        amount: () => { f.minAmount = ""; f.maxAmount = ""; }, account: () => { f.account = ""; } })[el.dataset.value]();
      top().sheet = null;
      render();
    },
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
      commit(undo, "Undone", "Back to how it was.", { isUndo: true, detailOnly: true });
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
    "open-accounts": () => push({ type: "accounts" }),
    "add-bank": () => push({ type: "add-bank", otherInput: "" }),
    "pick-bank": (el) => {
      state.stack.pop();
      push({ type: "bank", index: null, draft: { bank: el.dataset.value, account: null, cards: [] } });
    },
    "add-other-bank": () => {
      const name = top().otherInput.trim();
      if (!name) return showDialog("Name needed", "Type the bank's name.");
      if (hasBank(name)) return showDialog("Already added", `${name} is already in My Accounts.`);
      actions["pick-bank"]({ dataset: { value: name } });
    },
    "open-bank": (el) => {
      const bank = copyOf(state.accounts[Number(el.dataset.i)]);
      push({ type: "bank", index: Number(el.dataset.i), draft: { ...bank, cards: bank.cards || [] } });
    },
    "open-account": () => {
      const account = copyOf(top().draft.account);
      push({ type: "account", isNew: false, draft: { ...account, names: account.names || [] }, upiInput: "", payeeInput: "" });
    },
    "add-account": () => push({ type: "account", isNew: true, draft: { last4: "", name: "", upi: [], names: [] }, upiInput: "", payeeInput: "" }),
    "save-account": () => saveAccount(top()),
    "delete-account": () => showDialog(`Delete ${accountLabel("", top().draft).trim()}?`,
      `Its UPI IDs and names go too; ${parentBank().draft.bank}'s cards stay. Payments to and from it count as spending again.`,
      [["Cancel", "close"], ["Delete", "delete-account-confirm", true]]),
    "delete-account-confirm": () => { state.dialog = null; saveAccount(top(), true); },
    "add-upi": () => addItem("upi"),
    "remove-upi": (el) => removeItem("upi", el),
    "start-upi": () => startAdding("upi"),
    "add-payee": () => addItem("payee"),
    "remove-payee": (el) => removeItem("payee", el),
    "start-payee": () => startAdding("payee"),
    "start-bill": () => startAdding("bill"),
    "delete-bank": () => {
      const name = top().draft.bank;
      showDialog(`Delete ${name}?`, "Its account, UPI IDs and cards are removed from My Accounts. Payments to and from them count as spending again.",
        [["Cancel", "close"], ["Delete", "delete-bank-confirm", true]]);
    },
    "delete-bank-confirm": () => {
      state.dialog = null;
      saveAccounts(top().index, null, "Bank deleted", `${top().draft.bank} is gone.`, { pop: true });
    },
    "open-card": (el) => {
      const i = Number(el.dataset.i);
      push({ type: "card", cardIndex: i, draft: copyOf(top().draft.cards[i]), billInput: "" });
    },
    "add-card": () => push({ type: "card", cardIndex: null, draft: { last4: "", name: "", bills: [] }, billInput: "" }),
    "add-bill": () => addItem("bill"),
    "remove-bill": (el) => removeItem("bill", el),
    "save-card": () => saveCard(top()),
    "delete-card": () => showDialog("Delete Card?", `${accountLabel("", top().draft).trim()} is removed. Paying its bill counts as spending again.`,
      [["Cancel", "close"], ["Delete", "delete-card-confirm", true]]),
    "delete-card-confirm": () => { state.dialog = null; saveCard(top(), true); },
  };

  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
  });

  // Reordering rules: a card follows the finger by its ≡ and swaps places with a neighbour once
  // it passes that neighbour's middle. The order is kept in state.reorder when the finger lifts.
  app.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".grip");
    if (!grip || !state.reorder) return;
    e.preventDefault();
    const card = grip.closest(".sentence");
    const list = card.parentElement;
    const gap = parseFloat(getComputedStyle(card).marginBottom) || 0;
    let lastY = e.clientY;
    let lastScroll = window.scrollY;
    let offset = 0;
    card.classList.add("lifted");
    const move = (ev) => {
      offset += ev.clientY - lastY + window.scrollY - lastScroll;
      lastY = ev.clientY;
      lastScroll = window.scrollY;
      const prev = card.previousElementSibling;
      const next = card.nextElementSibling;
      const centre = card.offsetTop + offset + card.offsetHeight / 2;
      if (prev && prev.classList.contains("moving") && centre < prev.offsetTop + prev.offsetHeight / 2) {
        list.insertBefore(card, prev);
        offset += prev.offsetHeight + gap;
      } else if (next && next.classList.contains("moving") && centre > next.offsetTop + next.offsetHeight / 2) {
        list.insertBefore(next, card);
        offset -= next.offsetHeight + gap;
      }
      card.style.transform = `translateY(${offset}px)`;
      list.querySelectorAll(".pos").forEach((pos, position) => { pos.textContent = position + 1; });
      if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 8);
      else if (ev.clientY < 110) window.scrollBy(0, -8);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      card.classList.remove("lifted");
      card.style.transform = "";
      if (state.reorder) state.reorder = [...list.querySelectorAll(".moving")].map((c) => Number(c.dataset.i));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });

  app.addEventListener("input", (e) => {
    const name = e.target.dataset && e.target.dataset.field;
    const screen = top();
    if (!name || !screen) return;
    if (screen.type === "category" && name === "emojiInput") {
      const emoji = firstEmoji(e.target.value);
      if (!emoji) return;
      screen.newLook = { ...(screen.newLook || startLook(screen.name)), emoji };
      screen.lookTouched = true;
      screen.emojiOpen = false;
      return render();
    }
    if (screen.type === "category" || screen.type === "add-bank") screen[name] = e.target.value;
    // The picker's "For <name>" icons follow the name as it is typed, without redrawing the name box.
    if (screen.type === "category" && name === "nameInput") {
      if (screen.name == null && !screen.lookTouched) {
        const typed = screen.nameInput.trim();
        const [c, emoji] = typed ? suggestLook(typed) : ["#8e8e93", DEFAULT_EMOJI];
        screen.newLook = { name: typed, emoji, colour: c };
        const head = app.querySelector(".ic.xl");
        if (head) {
          head.style.background = c;
          head.textContent = emoji;
          head.nextElementSibling.textContent = typed || "New Category";
        }
      }
      const picker = document.getElementById("look-picker");
      const lk = screen.newLook || startLook(screen.name);
      if (picker) picker.outerHTML = lookPicker(lk, screen.nameInput, screen.emojiOpen);
    }
    if (screen.type === "account") {
      if (name === "upiInput" || name === "payeeInput") screen[name] = e.target.value;
      else screen.draft[name] = e.target.value;
    }
    if (screen.type === "card") {
      if (name === "billInput") screen.billInput = e.target.value;
      else screen.draft[name] = e.target.value;
    }
    if (screen.type === "rule") {
      screen.fields[name] = e.target.value;
      document.getElementById("preview").innerHTML = previewHtml(screen);
    }
  });

  // A new category's suggested icon follows its name until an icon is picked by hand.
  app.addEventListener("change", (e) => {
    const screen = top();
    if (!screen || screen.type !== "category" || screen.name != null || screen.lookTouched) return;
    const name = screen.nameInput.trim();
    const [c, emoji] = name ? suggestLook(name) : ["#8e8e93", DEFAULT_EMOJI];
    screen.newLook = { name, emoji, colour: c };
    render();
  });

  // Enter in a list's input works like its Add button: [action, list].
  const ENTER_ADDS = { recipientInput: ["add-word", "recipients"], wordInput: ["add-word", "words"], upiInput: ["add-upi"], payeeInput: ["add-payee"], billInput: ["add-bill"], otherInput: ["add-other-bank"] };
  app.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset && e.target.dataset.field === "nameInput") return e.target.blur();
    const add = e.key === "Enter" && e.target.dataset && ENTER_ADDS[e.target.dataset.field];
    if (!add) return;
    e.preventDefault();
    actions[add[0]]({ dataset: { list: add[1] } });
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
