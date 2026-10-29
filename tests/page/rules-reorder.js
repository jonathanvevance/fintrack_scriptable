(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.getElementById("app");
  const plainText = (t) => t.replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u2600-\u27BF\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
  const text = () => plainText(app.innerText);
  const q = (s) => app.querySelector(s);
  const sent = [];
  const send = fintrack.send;
  fintrack.send = (m) => { sent.push(m); send(m); };
  const pe = (type, target, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 300, clientY: y, pointerId: 1 }));
  const cardOrder = () => [...app.querySelectorAll(".sentence.moving")].map((c) => Number(c.dataset.i));
  try {
    q('[data-act="tab"][data-value="rules"]').click();
    const before = JSON.parse(JSON.stringify(window.__rules || []));
    ok("normal: reorder icon and plus", q('[data-act="reorder"]') && !q('[data-act="reorder"]').classList.contains("on") && q('[data-act="new-rule"]'));
    ok("normal: no grips", !q(".grip"));
    const n = app.querySelectorAll('[data-act="edit-rule"]').length;

    q('[data-act="reorder"]').click();
    ok("lit: icon on", q('[data-act="reorder"]').classList.contains("on"));
    ok("lit: plus hidden", !q('[data-act="new-rule"]'));
    ok("lit: cancel", q('[data-act="reorder-cancel"]') && /Cancel/.test(q('[data-act="reorder-cancel"]').innerText));
    ok("lit: hint", /Drag ≡ to change the order. Tap again to save./.test(text()), text().slice(0, 200));
    ok("lit: grips on every card", app.querySelectorAll(".grip").length === n, app.querySelectorAll(".grip").length + " vs " + n);
    ok("lit: cards not editable", !q('[data-act="edit-rule"]'));

    // Drag the first card to the bottom.
    const first = app.querySelector(".sentence.moving");
    const grip = first.querySelector(".grip");
    const y0 = first.getBoundingClientRect().top + 20;
    pe("pointerdown", grip, y0);
    for (let y = y0; y < y0 + 3000; y += 20) { pe("pointermove", window, y); }
    pe("pointerup", window, y0 + 3000);
    const after = cardOrder();
    ok("drag: first moved to last", after[after.length - 1] === 0 && after[0] === 1, after.join());
    ok("drag: positions renumbered", [...app.querySelectorAll(".pos")].map((p) => p.textContent).join() === after.map((_, i) => i + 1).join());

    // Save by tapping the lit icon.
    const rulesBefore = sent.length;
    q('[data-act="reorder"]').click();
    await wait(400);
    const save = sent[sent.length - 1];
    ok("save: sent", sent.length === rulesBefore + 1 && save.action === "save" && save.rules.length === n, JSON.stringify(save).slice(0, 200));
    ok("save: back to normal", q('[data-act="new-rule"]') && !q('[data-act="reorder"]').classList.contains("on") && !q(".grip"));
    ok("save: dialog", /Order saved/.test(text()), text().slice(-200));
    const lastCard = [...app.querySelectorAll('[data-act="edit-rule"]')].pop();
    ok("save: list shows new order", /cashback/i.test(lastCard.innerText) && /^\s*\S+ transactions?\s*\d+/i.test(lastCard.innerText) && lastCard.querySelector(".pos").textContent === String(n), lastCard.innerText);
    q('[data-act="close"]').click();

    // Cancel throws the order away.
    q('[data-act="reorder"]').click();
    const c1 = app.querySelector(".sentence.moving");
    const y1 = c1.getBoundingClientRect().top + 20;
    pe("pointerdown", c1.querySelector(".grip"), y1);
    for (let y = y1; y < y1 + 400; y += 20) pe("pointermove", window, y);
    pe("pointerup", window, y1 + 400);
    const sentBefore = sent.length;
    q('[data-act="reorder-cancel"]').click();
    ok("cancel: nothing sent", sent.length === sentBefore);
    ok("cancel: back to normal, old order", q('[data-act="new-rule"]') && /cashback/i.test([...app.querySelectorAll('[data-act="edit-rule"]')].pop().innerText));

    // Tapping the icon without moving anything saves nothing.
    q('[data-act="reorder"]').click();
    q('[data-act="reorder"]').click();
    await wait(300);
    ok("no change: nothing sent", sent.length === sentBefore);

    // Leaving the tab while lit drops reorder mode.
    q('[data-act="reorder"]').click();
    q('[data-act="tab"][data-value="spending"]').click();
    q('[data-act="tab"][data-value="rules"]').click();
    ok("tab switch: not lit", !q(".grip") && q('[data-act="new-rule"]'));
    ok("no JS errors", errors.length === 0, errors.join("; "));
  } catch (e) {
    out.push("FAIL exception " + e.message + " " + (e.stack || "").split("\n")[1]);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
