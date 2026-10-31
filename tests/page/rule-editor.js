(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.getElementById("app");
  const plainText = (t) => t.replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u2600-\u27BF\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
  const text = () => plainText(app.innerText);
  const sentenceText = () => plainText(app.querySelector(".rule-sentence").innerText).replace(/ ▾/g, "");
  const sheetText = () => plainText((app.querySelector(".sheet") || { innerText: "" }).innerText);
  const click = (sel, match) => {
    const els = [...app.querySelectorAll(sel)].filter((e) => !match || match.test(plainText(e.innerText)));
    if (!els.length) throw new Error("no element " + sel + " " + match);
    els[0].click();
  };
  const type = (field, value) => {
    const box = app.querySelector(`[data-field="${field}"]`);
    box.value = value;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const enter = (field) => app.querySelector(`[data-field="${field}"]`).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const sent = [];
  const send = fintrack.send;
  fintrack.send = (m) => { sent.push(m); send(m); };
  try {
    click('[data-act="tab"][data-value="rules"]');
    const t = text();
    ok("list: cashback sentence", /When I receive money and the SMS says cashback, it's Cashback/.test(t), t.slice(0, 600));
    ok("list: pay names", /When I pay swiggy or zomato, it's Food/.test(t), t.slice(0, 600));
    ok("list: three names", /When I pay or get money from airtel, bescom or rent, it's Bills/.test(t), t);
    ok("list: exactly", /When I pay or get money from exactly Amazon, it's Shopping/.test(t), t);
    ok("list: no edit buttons", !app.querySelector(".tok.edit"));

    click('[data-act="edit-rule"]', /cashback/);
    ok("editor sentence", sentenceText() === "When I receive money and the SMS says cashback, it's Cashback", sentenceText());
    ok("editor: outlined parts", app.querySelectorAll(".rule-sentence .tok.edit").length === 3);
    ok("editor: add rows", /Add to the sentence \+ Name you get money from \+ Amount \+ Account/i.test(text()) && !/\+ Word the SMS says/i.test(text()), text());
    ok("editor: no x pills", !app.querySelector(".namechip") && !/×/.test(app.innerHTML));
    ok("editor: preview", /Matches 6 transactions/i.test(text()), text());

    click('.rule-sentence [data-value="dir"]');
    ok("dir sheet", /When I … pay money goes out receive money money comes in pay or get money either way/i.test(sheetText()), sheetText());
    ok("rule sheet locks the screen behind it",
      document.body.classList.contains("scroll-locked") && getComputedStyle(document.body).position === "fixed" &&
      getComputedStyle(app.querySelector(".sheet")).overflowY === "auto");
    click('.sheet [data-act="dir"][data-value="out"]');
    ok("dir picked closes sheet", !app.querySelector(".sheet") && sentenceText().startsWith("When I pay and the SMS says cashback"), sentenceText());
    ok("closing rule sheet unlocks the screen", !document.body.classList.contains("scroll-locked"));

    click('[data-act="open-sheet"][data-value="names"]');
    ok("names sheet", /Names Add A name matches Part of the name .*Exactly/i.test(sheetText()) && !/Remove from Sentence/i.test(sheetText()), sheetText());
    type("recipientInput", "swiggy"); enter("recipientInput");
    type("recipientInput", "Zomato"); click('.sheet [data-act="add-word"]');
    ok("names as rows", /swiggy Remove Zomato Remove/.test(sheetText()) && /Remove from Sentence/.test(sheetText()), sheetText());
    click('.sheet [data-act="match-mode"][data-value="is"]');
    click('.sheet [data-act="close-sheet"]');
    ok("names in sentence", sentenceText() === "When I pay exactly swiggy or Zomato and the SMS says cashback, it's Cashback", sentenceText());

    click('[data-act="open-sheet"][data-value="amount"]');
    type("minAmount", "100"); type("maxAmount", "abc");
    click('.sheet-dim');
    ok("bad amount warns", /Highest amount must be a number/.test(text()) && /at least ₹100/.test(sentenceText()), text().slice(0, 500));
    click('.rule-sentence [data-value="amount"]');
    type("maxAmount", "");
    click('.sheet [data-act="clear-part"]');
    ok("remove amount", !/₹/.test(sentenceText()) && /\+ Amount/.test(text()), sentenceText());

    click('.rule-sentence [data-value="words"]');
    click('.sheet [data-act="clear-part"]');
    ok("remove words", sentenceText() === "When I pay exactly swiggy or Zomato, it's Cashback" && /\+ Word the SMS says/.test(text()), sentenceText());

    click('.rule-sentence [data-value="category"]');
    ok("category sheet", /It's .*Cashback/i.test(sheetText()) && /New Category…/i.test(sheetText()), sheetText());
    click('.sheet [data-act="rule-cat"][data-value="Food"]');
    ok("category picked", sentenceText() === "When I pay exactly swiggy or Zomato, it's Food", sentenceText());

    click('[data-act="save-rule"]');
    await wait(300);
    const r = sent[sent.length - 1].rules[0];
    ok("saved rule", JSON.stringify(r) === JSON.stringify({ when: { merchant: "^swiggy$|^Zomato$", direction: "out" }, set: { category: "Food" } }), JSON.stringify(r));
    ok("saved dialog wording", /When I pay "swiggy" or "Zomato"|When I pay exactly "swiggy" or "Zomato", it's Food/.test(text()), text().slice(-300));
    click('[data-act="close"]');

    // New rule from +.
    click('[data-act="new-rule"]');
    ok("new rule sentence", sentenceText() === "When I pay or get money, it's pick a category", sentenceText());
    ok("new rule add rows", /\+ Name you pay or get money from \+ Amount \+ Account \+ Word the SMS says/.test(text()), text());
    click('[data-act="open-sheet"][data-value="account"]');
    type("account", "6001");
    click('.sheet [data-act="close-sheet"]');
    ok("account in sentence", sentenceText() === "When I pay or get money on account ··6001, it's pick a category", sentenceText());
    ok("no JS errors", errors.length === 0, errors.join("; "));
  } catch (e) {
    out.push("FAIL exception " + e.message + " " + (e.stack || "").split("\n")[1]);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
