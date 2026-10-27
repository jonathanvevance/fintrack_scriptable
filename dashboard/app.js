// FinTrack dashboard. Scriptable shows this page in a WebView and calls fintrack.load(data) with
//   { months: { "YYYY-MM": [tx] }, rules: [rule], currentMonth: "YYYY-MM" }.
// The page never writes files: rule changes go out through fintrack.send(rules), and the page
// applies them only when Scriptable answers fintrack.saved(ok, message).
// Needs FT.tags (lib/tags.js) and FT.format (lib/format.js) loaded first.

(function () {
  const { compileRules, tagsFor, tagAll, describeRule } = FT.tags;
  const { money, monthLabel, shiftMonth, totals, categoryTotals } = FT.format;
  const app = document.getElementById("app");

  const rupees = (n) => money(Math.round(n * 100));
  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const FORM_CONDITIONS = ["merchant", "text", "direction", "minAmount", "maxAmount", "account"];

  const state = {
    months: {},
    rules: [],
    compiled: [],
    ym: null,
    tab: "month",
    form: null, // { index (null for new), fields, extra (conditions the form does not show) }
    dialog: null, // { title, text, actions: [[label, act, danger?]], ... }
    pending: null, // rules sent to Scriptable, waiting for fintrack.saved
  };

  function allTx() {
    return [].concat(...Object.values(state.months));
  }

  function setRules(rules) {
    state.rules = rules;
    state.compiled = compileRules(rules);
  }

  function signed(tx) {
    return `<span class="amt ${tx.amountPaise < 0 ? "out" : "in"}">${esc(money(tx.amountPaise, tx.currency))}</span>`;
  }

  function chips(tx) {
    const out = [];
    if (tx.category) out.push(`<span class="chip cat-chip">${esc(tx.category)}</span>`);
    if (tx.owner) out.push(`<span class="chip">${esc(tx.owner)}</span>`);
    for (const tag of tx.tags) out.push(`<span class="chip">#${esc(tag)}</span>`);
    if (!tx.category) out.push(`<span class="chip none">untagged · tap to add rule</span>`);
    return out.join("");
  }

  // ---- Month ----

  function monthView() {
    const list = tagAll(state.compiled, state.months[state.ym] || []);
    const t = totals(list);
    const inr = t.INR || { out: 0, in: 0 };
    const foreign = Object.keys(t).filter((c) => c !== "INR").map((c) => `${money(t[c].out, c)} out`);
    const cats = categoryTotals(list);
    const max = cats.length ? cats[0].paise : 1;

    const bars = cats
      .map(({ category, paise }) => {
        const cls = category ? "" : " untagged";
        return `<div class="cat"><span class="name${cls}">${esc(category || "Untagged")}</span>
          <div class="track"><div class="fill${cls}" style="width:${Math.max(2, (100 * paise) / max)}%"></div></div>
          <span class="v">${esc(money(paise))}</span></div>`;
      })
      .join("");

    const rows = list
      .map(
        (tx) => `<button class="tx" data-act="rule-from" data-id="${esc(tx.id)}">
          <div style="min-width:0"><div class="who">${esc(tx.merchant || tx.bank || "Unknown")}</div>
          <div class="meta">${esc(tx.date.slice(5))}${tx.account ? " · ··" + esc(tx.account) : ""}</div>${chips(tx)}</div>
          ${signed(tx)}</button>`
      )
      .join("");

    return `
      <div class="card">
        <div class="month"><button data-act="prev">‹</button>${esc(monthLabel(state.ym))}<button data-act="next">›</button></div>
        <div class="totals">
          <div><div class="k">Spent</div><div class="v">${esc(money(inr.out))}</div></div>
          <div><div class="k">Received</div><div class="v">${esc(money(inr.in))}</div></div>
        </div>
        ${foreign.length ? `<div class="foreign">Also ${esc(foreign.join(", "))}</div>` : ""}
      </div>
      ${cats.length ? `<div class="card"><div class="heading">Where it went</div>${bars}</div>` : ""}
      <div class="card">${rows || `<div class="empty">No transactions this month</div>`}</div>`;
  }

  // ---- Rules ----

  function rulesView() {
    const txs = allTx();
    const rows = state.rules
      .map((rule, i) => {
        const matches = state.compiled[i].matches;
        const hits = txs.filter(matches).length;
        return `<div class="rule">${esc(describeRule(rule, rupees))}
          <div class="acts"><span>${hits} transaction${hits === 1 ? "" : "s"}</span>
            <button data-act="edit" data-i="${i}">edit</button>
            ${i > 0 ? `<button data-act="up" data-i="${i}">move up</button>` : ""}
            ${i < state.rules.length - 1 ? `<button data-act="down" data-i="${i}">move down</button>` : ""}
            <button class="danger" data-act="delete" data-i="${i}">delete</button></div></div>`;
      })
      .join("");
    return `
      <button class="primary" data-act="new">＋ New rule</button>
      <div class="card">${rows || `<div class="empty">No rules yet. Tap a transaction on the Month tab to start one.</div>`}</div>
      <div class="card note">Rules are checked top to bottom; for category and owner the first match wins.
        Saved by Scriptable in iCloud Drive / Scriptable / fintrack / data / rules.json.</div>`;
  }

  // ---- Trends ----

  function trendsView() {
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(state.ym, -i));
    const rows = months.map((ym) => {
      const list = tagAll(state.compiled, state.months[ym] || []);
      return { ym, spent: (totals(list).INR || { out: 0 }).out, top: categoryTotals(list).slice(0, 3) };
    });
    const max = Math.max(1, ...rows.map((r) => r.spent));
    const html = rows
      .map(
        (r) => `<div class="cat"><span class="name">${esc(monthLabel(r.ym))}</span>
          <div class="track"><div class="fill" style="width:${(100 * r.spent) / max}%"></div></div>
          <span class="v">${esc(money(r.spent))}</span></div>
          <div class="note" style="margin:-2px 0 8px">${esc(r.top.map((c) => `${c.category || "Untagged"} ${money(c.paise)}`).join(" · ") || "No spending")}</div>`
      )
      .join("");
    return `<div class="card"><div class="heading">Spent per month, top categories</div>${html}</div>`;
  }

  // ---- Rule form ----

  function fieldsFromRule(rule) {
    const when = rule.when || {};
    const set = rule.set || {};
    const extra = {};
    for (const key of Object.keys(when)) if (!FORM_CONDITIONS.includes(key)) extra[key] = when[key];
    return {
      extra,
      fields: {
        merchant: when.merchant || "",
        text: when.text || "",
        direction: when.direction || "",
        minAmount: when.minAmount != null ? String(when.minAmount) : "",
        maxAmount: when.maxAmount != null ? String(when.maxAmount) : "",
        account: when.account || "",
        category: set.category || "",
        owner: set.owner || "",
        tags: (set.tags || []).join(", "),
      },
    };
  }

  // Throws a readable message when a field is invalid.
  function ruleFromForm(form) {
    const f = form.fields;
    const when = { ...form.extra };
    for (const key of ["merchant", "text", "direction", "account"]) if (f[key].trim()) when[key] = f[key].trim();
    for (const key of ["minAmount", "maxAmount"]) {
      if (!f[key].trim()) continue;
      const n = Number(f[key].replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new Error(`${key === "minAmount" ? "Min" : "Max"} ₹ must be a number`);
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

  function cleanError(e) {
    return String(e.message || e).replace(/^rules\.json rule \d+: /, "");
  }

  function previewHtml() {
    let rule;
    try {
      rule = ruleFromForm(state.form);
    } catch (e) {
      return `<div class="error">${esc(cleanError(e))}</div>`;
    }
    if (!Object.keys(rule.when).length) return `<div class="note">Add at least one condition to see what it matches.</div>`;
    const matches = compileRules([rule])[0].matches;
    const hits = allTx().filter(matches).sort((a, b) => (a.date < b.date ? 1 : -1));
    const shown = hits
      .slice(0, 4)
      .map((tx) => `<div class="tx"><div class="who">${esc(tx.merchant || tx.bank || "Unknown")} <span class="note">${esc(tx.date)}</span></div>${signed(tx)}</div>`)
      .join("");
    const more = hits.length > 4 ? `<div class="note" style="padding-top:6px">+${hits.length - 4} more</div>` : "";
    return `<div class="heading">Would match ${hits.length} past transaction${hits.length === 1 ? "" : "s"}</div>${shown}${more}`;
  }

  function input(field, label, placeholder) {
    return `<label>${label}</label><input data-field="${field}" value="${esc(state.form.fields[field])}" placeholder="${esc(placeholder)}" autocapitalize="off" autocorrect="off">`;
  }

  function formView() {
    const dir = state.form.fields.direction;
    const seg = [["out", "Money out"], ["in", "Money in"], ["", "Either"]]
      .map(([v, label]) => `<button data-act="dir" data-value="${v}" class="${dir === v ? "on" : ""}">${label}</button>`)
      .join("");
    const extra = Object.keys(state.form.extra).length
      ? `<div class="note" style="margin-top:10px">Also keeps: ${esc(describeRule({ when: state.form.extra }, rupees).replace(/ → .*$/, ""))}</div>`
      : "";
    return `
      <div style="height:10px"></div>
      <div class="card"><div class="heading"><b>When</b></div>
        ${input("merchant", "Merchant contains (use | between names)", "swiggy|zomato")}
        ${input("text", "SMS mentions", "cashback")}
        <label>Direction</label><div class="seg">${seg}</div>
        <div class="two"><div>${input("minAmount", "Min ₹", "any")}</div><div>${input("maxAmount", "Max ₹", "any")}</div></div>
        ${input("account", "Account (last digits)", "any")}
        ${extra}
      </div>
      <div class="card"><div class="heading"><b>Then</b></div>
        ${input("category", "Category", "Food")}
        ${input("owner", "Owner", "optional")}
        ${input("tags", "Tags (comma separated)", "optional")}
      </div>
      <div class="card" id="preview">${previewHtml()}</div>`;
  }

  // ---- Saving (through Scriptable) ----

  function commit(next, title, detail, options = {}) {
    state.pending = { next, previous: state.rules, title, detail, ...options };
    fintrack.send(next);
  }

  function saved(ok, message) {
    const p = state.pending;
    state.pending = null;
    if (!p) return;
    if (!ok) {
      state.dialog = { title: "Not saved", text: message || "Scriptable could not save the rules.", actions: [["OK", "close"]] };
      return render();
    }
    const txs = allTx();
    const before = txs.map((tx) => JSON.stringify(tagsFor(state.compiled, tx)));
    setRules(p.next);
    const changed = txs.filter((tx, i) => JSON.stringify(tagsFor(state.compiled, tx)) !== before[i]).length;
    state.form = null;
    if (!p.quiet) {
      state.dialog = {
        title: p.title,
        text: `${p.detail}\n${changed} transaction${changed === 1 ? "" : "s"} re-tagged.`,
        actions: p.isUndo ? [["OK", "close"]] : [["Undo", "undo"], ["OK", "close"]],
        undo: p.previous,
      };
    }
    render();
  }

  function saveForm() {
    let rule;
    try {
      rule = ruleFromForm(state.form);
      if (!Object.keys(rule.when).length) throw new Error("Add at least one condition.");
      if (!Object.keys(rule.set).length) throw new Error("Set a category, owner or tag.");
    } catch (e) {
      state.dialog = { title: "Can't save yet", text: cleanError(e), actions: [["OK", "close"]] };
      return render();
    }
    const next = state.rules.slice();
    if (state.form.index == null) next.unshift(rule);
    else next[state.form.index] = rule;
    commit(next, "Rule saved", describeRule(rule, rupees));
  }

  // ---- Rendering and events ----

  function dialogView() {
    const d = state.dialog;
    if (!d) return "";
    const acts = d.actions
      .map(([label, act, danger]) => `<button data-act="${act}" class="${danger ? "danger" : ""}">${esc(label)}</button>`)
      .join("");
    return `<div class="dim"><div class="alert"><div class="body"><h3>${esc(d.title)}</h3>
      <p>${esc(d.text).replace(/\n/g, "<br>")}</p></div><div class="acts">${acts}</div></div></div>`;
  }

  function render() {
    if (!state.ym) {
      app.innerHTML = `<div class="card empty" style="margin-top:20px">Loading…</div>`;
      return;
    }
    const bar = state.form
      ? `<div class="bar"><button class="side" data-act="cancel">Cancel</button><span class="title">${state.form.index == null ? "New rule" : "Edit rule"}</span><button class="side" data-act="save"><b>Save</b></button></div>`
      : `<div class="bar"><span class="side"></span><span class="title">FinTrack</span><span class="side"></span></div>`;
    const tabs = [["month", "Month"], ["rules", "Rules"], ["trends", "Trends"]]
      .map(([id, label]) => `<button data-act="tab" data-value="${id}" class="${state.tab === id ? "on" : ""}">${label}</button>`)
      .join("");
    const body = state.form
      ? formView()
      : `<div class="tabs">${tabs}</div>` + { month: monthView, rules: rulesView, trends: trendsView }[state.tab]();
    app.innerHTML = bar + body + dialogView();
  }

  function moveRule(i, delta) {
    const next = state.rules.slice();
    const [rule] = next.splice(i, 1);
    next.splice(i + delta, 0, rule);
    commit(next, "", "", { quiet: true });
  }

  const actions = {
    tab: (el) => { state.tab = el.dataset.value; render(); },
    prev: () => { state.ym = shiftMonth(state.ym, -1); render(); },
    next: () => { state.ym = shiftMonth(state.ym, 1); render(); },
    new: () => { state.form = { index: null, ...fieldsFromRule({}) }; render(); },
    edit: (el) => { const i = Number(el.dataset.i); state.form = { index: i, ...fieldsFromRule(state.rules[i]) }; render(); },
    "rule-from": (el) => {
      const tx = (state.months[state.ym] || []).find((t) => t.id === el.dataset.id);
      if (!tx) return;
      const form = { index: null, ...fieldsFromRule({}) };
      if (tx.merchant) form.fields.merchant = escapeRegex(tx.merchant);
      form.fields.direction = tx.amountPaise < 0 ? "out" : "in";
      state.form = form;
      render();
    },
    dir: (el) => { state.form.fields.direction = el.dataset.value; render(); },
    cancel: () => { state.form = null; render(); },
    save: saveForm,
    up: (el) => moveRule(Number(el.dataset.i), -1),
    down: (el) => moveRule(Number(el.dataset.i), 1),
    delete: (el) => {
      const i = Number(el.dataset.i);
      state.dialog = {
        title: "Delete rule?",
        text: describeRule(state.rules[i], rupees),
        actions: [["Cancel", "close"], ["Delete", "delete-confirm", true]],
        index: i,
      };
      render();
    },
    "delete-confirm": () => {
      const i = state.dialog.index;
      const rule = state.rules[i];
      state.dialog = null;
      render();
      commit(state.rules.filter((_, j) => j !== i), "Rule deleted", describeRule(rule, rupees));
    },
    undo: () => {
      const previous = state.dialog.undo;
      state.dialog = null;
      render();
      commit(previous, "Undone", "Rules are back to how they were.", { isUndo: true });
    },
    close: () => { state.dialog = null; render(); },
  };

  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
  });

  app.addEventListener("input", (e) => {
    const field = e.target.dataset && e.target.dataset.field;
    if (!field || !state.form) return;
    state.form.fields[field] = e.target.value;
    document.getElementById("preview").innerHTML = previewHtml();
  });

  function load(data) {
    state.months = data.months || {};
    setRules(data.rules || []);
    state.ym = data.currentMonth || Object.keys(state.months).sort().pop() || "2026-01";
    render();
  }

  window.fintrack = {
    load,
    saved,
    send: (rules) => {
      location.href = "fintrack://saveRules?data=" + encodeURIComponent(JSON.stringify(rules));
    },
  };
  render();
})();
