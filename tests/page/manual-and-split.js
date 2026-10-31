(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const app = document.getElementById("app");
  const q = (selector) => app.querySelector(selector);
  const text = () => app.innerText.replace(/\s+/g, " ").trim();
  const click = (selector, match) => {
    const element = [...app.querySelectorAll(selector)].find((item) => !match || match.test(item.innerText));
    if (!element) throw new Error(`no element ${selector} ${match || ""}`);
    element.click();
  };
  const type = (field, value) => {
    const input = q(`[data-field="${field}"]`);
    if (!input) throw new Error(`no input ${field}`);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const sent = [];
  const send = fintrack.send;
  fintrack.send = (message) => {
    sent.push(message);
    send(message);
  };

  try {
    const splitTx = {
      id: "split-test", template: "test", confidence: "high", bank: "SBI",
      accountType: "credit_card", account: "5678", merchant: "Furniture Store",
      currency: "INR", amountPaise: -10000000, date: "2026-10-30",
      raw: "Fake test SMS", capturedAt: "2026-10-30T10:00:00Z",
      manual: { category: "Shopping" },
    };
    months["2026-10"].unshift(splitTx);
    fintrack.load({ months, rules, categories: {}, accounts, unparsed, version: "preview", currentMonth: "2026-10" });

    click('[data-act="tab"][data-value="more"]');
    ok("More is simplified", /Add Transaction/.test(text()) && /Import from Clipboard/.test(text()) &&
      /Message Review/.test(text()) && /App & Updates/.test(text()) && !/Check Guessed Transactions/.test(text()), text());
    click('[data-act="new-manual"]');
    ok("manual form supports paid and received", /New Transaction/.test(text()) && /Paid/.test(text()) && /Received/.test(text()), text());
    const dateStyle = getComputedStyle(q('[data-field="date"]'));
    ok("manual date is right aligned", dateStyle.textAlign === "right" && dateStyle.maxWidth !== "none",
      `${dateStyle.textAlign} / ${dateStyle.maxWidth}`);
    type("amount", "1234.56");
    type("merchant", "Local Store");
    type("date", "2026-10-29");
    type("note", "Bought without an SMS");
    click('[data-act="manual-category"]');
    click('[data-act="choose-manual-category"]', /Shopping/);
    click('[data-act="save-manual"]');
    const added = sent[sent.length - 1];
    ok("manual transaction sends exact fields", added.action === "addManual" && added.amountPaise === 123456 &&
      added.direction === "out" && added.merchant === "Local Store" && added.category === "Shopping", JSON.stringify(added));
    await wait(250);
    ok("manual detail is explicit and has no fake message", /Entered manually/.test(text()) &&
      /Bought without an SMS/.test(text()) && !/Original Message/.test(text()), text());

    click('[data-act="back"]');
    click(`[data-act="open-tx"][data-id="${splitTx.id}"]`);
    click('[data-act="open-split"]');
    ok("even split uses a typed number", !!q('[data-field="people"]') && !/[−+]/.test(text()), text());
    type("people", "5");
    ok("five-way preview is correct", /Your share ₹20,000/.test(text()) && /To get back ₹80,000/.test(text()), text());
    click('[data-act="save-split"]');
    const saved = sent[sent.length - 1];
    ok("even split stores two allocations", saved.action === "save" && saved.manual.manual.split.people === 5 &&
      saved.manual.manual.split.ownPaise === 2000000 && saved.manual.manual.split.ownCategory === "Shopping" &&
      saved.manual.manual.split.lentCategory === "Lent", JSON.stringify(saved));
    await wait(250);
    ok("detail shows both parts", /Shopping Your share ₹20,000/.test(text()) && /Lent To get back ₹80,000/.test(text()), text());

    click('[data-act="open-split"]');
    ok("split labels use approved wording", /Evenly/.test(text()) && /By shares/.test(text()) && /By amount/.test(text()) &&
      !/Your fraction/.test(text()), text());
    click('[data-act="split-mode"][data-value="shares"]');
    type("ownShares", "2");
    type("otherShares", "3");
    ok("share split calculates two fifths without showing a fraction row",
      /Your share ₹40,000/.test(text()) && /To get back ₹60,000/.test(text()) && !/Your fraction/.test(text()), text());
    click('[data-act="save-split"]');
    const shares = sent[sent.length - 1];
    ok("share split stores both share counts", shares.manual.manual.split.mode === "shares" &&
      shares.manual.manual.split.ownShares === 2 && shares.manual.manual.split.otherShares === 3 &&
      shares.manual.manual.split.ownPaise === 4000000, JSON.stringify(shares));
    await wait(250);

    click('[data-act="open-split"]');
    click('[data-act="split-mode"][data-value="amount"]');
    type("ownAmount", "35000");
    click('[data-act="save-split"]');
    const amount = sent[sent.length - 1];
    ok("amount split stores only own amount", amount.manual.manual.split.mode === "amount" &&
      amount.manual.manual.split.ownPaise === 3500000 && !("people" in amount.manual.manual.split), JSON.stringify(amount));
    await wait(250);
    click('[data-act="open-split"]');
    click('[data-act="remove-split"]');
    await wait(250);
    ok("split can be removed", /Split Transaction/.test(text()) && !/Your share ₹35,000/.test(text()), text());
  } catch (error) {
    out.push(`FAIL exception ${error.message} ${(error.stack || "").split("\n")[1]}`);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
