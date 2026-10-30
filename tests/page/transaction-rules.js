(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const app = document.getElementById("app");
  const plainText = (value) => value.replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u2600-\u27BF\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
  const text = () => plainText(app.innerText);
  const click = (selector, match) => {
    const found = [...app.querySelectorAll(selector)].find((element) => !match || match.test(plainText(element.innerText)));
    if (!found) throw new Error(`no element ${selector} ${match}`);
    found.click();
  };
  const sent = [];
  const send = fintrack.send;
  fintrack.send = (message) => {
    sent.push(message);
    send(message);
  };

  try {
    click('[data-act="open-list"][data-filter="all"]');
    click('[data-act="open-tx"]', /BIGBASKET/);
    ok("applied rule is shown", /Rule 8 applied/.test(text()) && /BIGBASKET.*Groceries/.test(text()), text().slice(0, 500));
    ok("only the winning rule is shown", !/other matching rule/i.test(text()));
    ok("transaction page has no Save button", !app.querySelector('[data-act="save-tx"]'));
    ok("original message is visible", /Rs 1845 debited from A\/c XX1234 towards BIGBASKET/.test(text()), text());
    const copyMessage = app.querySelector('[data-act="copy-sms"]');
    click('[data-act="copy-sms"]');
    await wait(250);
    ok("message copy confirms inline without a window", /Copied/.test(copyMessage.innerText) && !app.querySelector(".alert"), text().slice(-200));

    click('[data-act="change-tx-category"]');
    ok("category choice is a focused page", /Choose Category/.test(text()) && !/Original message/.test(text()), text().slice(0, 400));
    click('[data-act="choose-tx-category"][data-value="Food"]');
    await wait(300);
    const manual = sent[sent.length - 1];
    ok("category choice saves immediately", manual.action === "save" && manual.manual.manual.category === "Food", JSON.stringify(manual));
    ok("manual choice returns to detail", /Food Applied only to this transaction/.test(text()), text().slice(0, 400));
    ok("manual choice offers both rule paths", /Add a New Rule/.test(text()) && /Add to an Existing Rule/.test(text()), text());
    ok("message stays visible after manual choice", /towards BIGBASKET/.test(text()));

    click('[data-act="add-to-rule"]');
    ok("existing-rule picker shows a safe matching rule", /Rule 2/.test(text()) && /swiggy.*zomato.*Food/i.test(text()), text());
    click('[data-act="include-in-rule"]');
    await wait(300);
    const extended = sent[sent.length - 1];
    ok("existing rule gains merchant and clears manual choice",
      extended.action === "save" && /BIGBASKET/.test(extended.rules[1].when.merchant) && !("category" in extended.manual.manual),
      JSON.stringify(extended));
    click('[data-act="close"]');
    ok("extended rule now explains the category", /Rule 2 applied/.test(text()) && !/Use this category again/.test(text()), text().slice(0, 500));

    click('[data-act="change-tx-category"]');
    click('[data-act="choose-tx-category"][data-value="Travel"]');
    await wait(300);
    click('[data-act="new-rule-from-tx"]');
    ok("new-rule path is prefilled", /New Rule/.test(text()) && /BIGBASKET/.test(text()) && /Travel/.test(text()), text().slice(0, 500));
    click('[data-act="save-rule"]');
    await wait(300);
    const created = sent[sent.length - 1];
    ok("new rule is first and clears manual choice",
      created.action === "save" && created.rules[0].set.category === "Travel" && /BIGBASKET/.test(created.rules[0].when.merchant) && !("category" in created.manual.manual),
      JSON.stringify(created));
  } catch (error) {
    out.push(`FAIL exception ${error.message} ${(error.stack || "").split("\n")[1]}`);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
