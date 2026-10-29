(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.getElementById("app");
  const plainText = (t) => t.replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u2600-\u27BF\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
  const text = () => plainText(app.innerText);
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
    const { totals } = FT.format;
    const isSelf = FT.accounts.compileAccounts(accounts);
    const oct = months["2026-10"];
    const spentAll = totals(oct).INR.out, spentCounted = totals(oct.filter((t) => !isSelf(t))).INR.out;
    const big = app.querySelector(".big").innerText;
    ok("spent excludes self transfers", big === FT.format.money(spentCounted) && spentAll !== spentCounted, `${big} vs ${FT.format.money(spentCounted)}`);
    ok("latest hides self transfers", !/Self transfer/.test(text()));
    click('[data-act="open-list"][data-filter="all"]');
    ok("See All lists 5 self transfers", (text().match(/Self transfer/g) || []).length === 5, text().slice(0, 300));
    click('[data-act="open-tx"]', /SBI CARDS/);
    ok("self tx explains bill", /Self Transfer/.test(text()) && /SBI CARDS is how your SBI Cashback ··5678 bill shows/.test(text()), text().slice(0, 500));
    ok("self tx has no category picker", !app.querySelector('[data-act="pick-cat"]'));
    click('[data-act="back"]');
    click('[data-act="open-tx"]', /A KUMAR/);
    ok("self tx explains name", /A KUMAR is how your HSBC Savings ··6001 shows when paid/.test(text()), text().slice(0, 500));
    click('[data-act="back"]');
    click('[data-act="open-tx"]', /ARJUN MEHTA/);
    ok("self tx explains NEFT", /SBIN ··4321 is your SBI Savings ··4321/.test(text()), text().slice(0, 500));
    click('[data-act="back"]');
    click('[data-act="open-tx"]', /HSBC Card/);
    ok("self tx explains card bill", /it pays your HSBC Premier ··9012 bill/.test(text()), text().slice(0, 500));
    click('[data-act="back"]');
    click('[data-act="open-tx"]', /ACME TECH/);
    ok("salary is not a self transfer", !/Self Transfer/.test(text()), text().slice(0, 300));
    click('[data-act="back"]'); click('[data-act="back"]');

    click('[data-act="tab"][data-value="more"]');
    ok("More shows summary", /My Accounts 2 bank accounts · 2 cards/.test(text()), text().slice(0, 200));
    click('[data-act="open-accounts"]');
    ok("list shows one row per bank", /SBI Savings ··4321 · 1 card HSBC Savings ··6001 · 1 card Add Bank/.test(text()), text());

    click('[data-act="open-bank"]', /^SBI/);
    ok("bank page lists rows", /Bank account Savings ··4321 1 UPI ID Cards Cashback ··5678 Bill shows as SBI CARDS Add Card Delete SBI/i.test(text()) && !app.querySelector("input"), text());
    click('[data-act="open-account"]');
    ok("account page", /Cancel Savings ··4321 Save/.test(text()) && /you\.name@sbi Remove/.test(text()) && /Delete Savings ··4321/.test(text()), text());
    click('[data-act="start-upi"]'); type("upiInput", "you@oksbi"); enter("upiInput");
    click('[data-act="save-account"]');
    await wait(300);
    ok("save sends accounts", sent[sent.length - 1].accounts[0].account.upi.join() === "you.name@sbi,you@oksbi", JSON.stringify(sent[sent.length - 1]));
    ok("saved dialog counts self transfers", /SBI Savings ··4321 is saved\. 5 self transfers across all your transactions\./.test(text()), text().slice(-200));
    click('[data-act="close"]');
    click('[data-act="back"]');

    click('[data-act="add-bank"]');
    click('[data-act="pick-bank"]', /ICICI/);
    click('[data-act="add-card"]');
    type("last4", "3456"); type("name", "Amazon Pay"); click('[data-act="start-bill"]'); type("billInput", "ICICI CARD");
    click('[data-act="save-card"]');
    await wait(300);
    ok("card save saves new bank", JSON.stringify(sent[sent.length - 1].accounts[2]) === JSON.stringify({ bank: "ICICI", account: null, cards: [{ last4: "3456", name: "Amazon Pay", bills: ["ICICI CARD"] }] }), JSON.stringify(sent[sent.length - 1].accounts[2]));
    click('[data-act="close"]');
    const before = sent.length;
    click('[data-act="add-account"]'); type("last4", "12"); click('[data-act="save-account"]');
    ok("bad last 4 refused", sent.length === before && /ICICI account: last 4 digits must be 4 digits/.test(text()), text().slice(-200));
    click('[data-act="close"]'); click('[data-act="back"]'); click('[data-act="back"]');

    click('[data-act="open-bank"]', /^HSBC/);
    click('[data-act="open-account"]');
    click('[data-act="delete-account"]');
    click('[data-act="delete-account-confirm"]');
    await wait(300);
    const h = sent[sent.length - 1].accounts[1];
    ok("delete account keeps cards", h.account === null && h.cards.length === 1, JSON.stringify(h));
    click('[data-act="close"]');
    click('[data-act="delete-bank"]'); click('[data-act="delete-bank-confirm"]');
    await wait(300);
    click('[data-act="undo"]');
    await wait(300);
    click('[data-act="close"]');
    ok("undo restores HSBC", /HSBC No account · 1 card/.test(text()), text());
  } catch (e) {
    out.push("FAIL exception " + e.message + " " + (e.stack || "").split("\n")[1]);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
