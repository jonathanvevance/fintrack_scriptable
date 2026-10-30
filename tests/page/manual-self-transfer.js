(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.getElementById("app");
  const plainText = (t) => t.replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u2600-\u27BF\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
  const text = () => plainText(app.innerText);
  const click = (sel, match) => {
    const els = [...app.querySelectorAll(sel)].filter((e) => !match || match.test(plainText(e.innerText)));
    if (!els.length) throw new Error(`no element ${sel} ${match}`);
    els[0].click();
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
    ok("normal transaction is read-only with more menu", !app.querySelector('[data-act="save-tx"]') && app.querySelector('[data-act="tx-menu"]'));
    ok("self-transfer action starts hidden", !app.querySelector('[data-act="mark-self"]'));

    click('[data-act="tx-menu"]');
    ok("more menu has rare transaction actions", /Mark as Self Transfer/.test(text()) && /Delete Transaction/.test(text()) && /Cancel/.test(text()), text().slice(0, 260));
    click('[data-act="mark-self"]');
    ok("mark asks for confirmation", /Mark as Self Transfer\? It will not count as spending or money received/.test(text()), text().slice(-180));
    click('[data-act="mark-self-confirm"]');
    await wait(300);
    const marked = sent[sent.length - 1];
    ok("mark saves only this transaction", marked.action === "save" && marked.manual.id === "2026-10-8" && marked.manual.manual.selfTransfer === true, JSON.stringify(marked));
    ok("save explains the effect", /This transaction will not count as spending or money received/.test(text()), text().slice(-180));

    click('[data-act="close"]');
    ok("manual self transfer has new SVG icon", app.querySelector(".self-icon svg") && !/↔/.test(text()), text().slice(0, 180));
    ok("manual reason is shown", /you marked this transaction by hand/.test(text()), text().slice(0, 260));
    ok("manual self transfer has no category picker", !app.querySelector('[data-act="pick-cat"]'));
    ok("manual self transfer can become payment again", app.querySelector('[data-act="unmark-self"]'));

    click('[data-act="unmark-self"]');
    await wait(300);
    const unmarked = sent[sent.length - 1];
    ok("change to payment removes manual mark", unmarked.action === "save" && Object.keys(unmarked.manual.manual).length === 0, JSON.stringify(unmarked));
    click('[data-act="close"]');
    ok("payment category control returns", app.querySelector('[data-act="change-tx-category"]') && !app.querySelector(".self-icon"));
  } catch (e) {
    out.push(`FAIL exception ${e.message} ${(e.stack || "").split("\n")[1]}`);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
