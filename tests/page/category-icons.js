(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.getElementById("app");
  const q = (s) => app.querySelector(s);
  const sent = [];
  const send = fintrack.send;
  fintrack.send = (m) => { sent.push(m); send(m); };
  const type = (field, value) => {
    const box = q(`[data-field="${field}"]`);
    box.value = value;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const labels = () => [...app.querySelectorAll(".emoji-label")].map((l) => l.textContent);
  const rowOf = (i) => [...app.querySelectorAll(".emojis")][i] ? [...[...app.querySelectorAll(".emojis")][i].querySelectorAll("button")].map((b) => b.dataset.value) : [];
  const selected = () => [...app.querySelectorAll('[data-act="pick-emoji"]')].filter((b) => b.getAttribute("style")).map((b) => b.dataset.value);
  try {
    q('[data-act="tab"][data-value="rules"]').click();
    q('[data-act="open-categories"]').click();
    q('[data-act="new-category"]').click();
    ok("new: no name row yet", labels().join() === "Used by your categories,Picked" || labels()[0] === "Used by your categories", labels().join());
    ok("new: used icons include Food", rowOf(0).includes("🍜"), rowOf(0).join(" "));
    ok("new: any emoji button", !!q('[data-act="any-emoji"]'));
    ok("new: no old 36 grid", app.querySelectorAll('[data-act="pick-emoji"]').length < 30, app.querySelectorAll('[data-act="pick-emoji"]').length);

    const nameBox = q('[data-field="nameInput"]');
    type("nameInput", "Pets");
    ok("typing keeps the name box", q('[data-field="nameInput"]') === nameBox);
    ok("for Pets row", labels()[0] === "For “Pets”" && rowOf(0).join("") === "🐾🐶🐱🦴🐟", labels().join() + " / " + rowOf(0).join(""));
    ok("head icon follows name", q(".ic.xl").textContent === "🐾", q(".ic.xl").textContent);
    ok("suggested is selected", selected().join() === "🐾", selected().join());
    ok("used row has no duplicates of for-row", !rowOf(1).some((e) => rowOf(0).includes(e)), rowOf(1).join(""));

    q('[data-act="pick-emoji"][data-value="🐶"]').click();
    ok("pick dog", q(".ic.xl").textContent === "🐶" && selected().join() === "🐶", q(".ic.xl").textContent + " " + selected().join());

    q('[data-act="any-emoji"]').click();
    ok("any emoji opens box", !!q('[data-field="emojiInput"]') && document.activeElement === q('[data-field="emojiInput"]'));
    type("emojiInput", "ab");
    ok("letters ignored", !!q('[data-field="emojiInput"]') && q(".ic.xl").textContent === "🐶");
    type("emojiInput", "ab🦜 x");
    ok("keyboard emoji picked", q(".ic.xl").textContent === "🦜" && !q('[data-field="emojiInput"]'), q(".ic.xl").textContent);
    ok("picked emoji shown first and selected", rowOf(0)[0] === "🦜" && selected().join() === "🦜", rowOf(0).join(""));

    q('[data-act="any-emoji"]').click();
    type("emojiInput", "🇮🇳");
    ok("flag is one emoji", q(".ic.xl").textContent === "🇮🇳", q(".ic.xl").textContent);
    q('[data-act="any-emoji"]').click();
    type("emojiInput", "👍🏽");
    ok("skin tone kept", q(".ic.xl").textContent === "👍🏽", q(".ic.xl").textContent);

    q('[data-act="save-category"]').click();
    await wait(400);
    const save = sent[sent.length - 1];
    ok("saved", save && save.categories && save.categories.Pets && save.categories.Pets.emoji === "👍🏽", JSON.stringify(save && save.categories && save.categories.Pets));
    const close = q('[data-act="close"]'); if (close) close.click();

    // Existing category: Food, with rules (this page broke when ruleCard changed).
    const food = [...app.querySelectorAll('[data-act="open-category"]')].find((b) => b.dataset.value === "Food");
    food.click();
    ok("food page draws with its rules", /Rules that set Food/i.test(app.innerText) && app.querySelectorAll('[data-act="edit-rule"]').length > 0, app.innerText.slice(0, 300).replace(/\n/g, " "));
    q('[data-act="toggle-look"]').click();
    ok("food: for Food row", labels()[0] === "For “Food”" && rowOf(0)[0] === "🍜", labels().join() + " / " + rowOf(0).join(""));
    ok("no JS errors", errors.length === 0, errors.join("; "));
  } catch (e) {
    out.push("FAIL exception " + e.message + " " + (e.stack || "").split("\n")[1]);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
