(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = document.getElementById("app");
  const plainText = (text) => text.replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u2600-\u27BF\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
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
    Object.values(months).flat().forEach((tx) => {
      if (tx.confidence === "low") tx.manual = { ...(tx.manual || {}), lowConfidenceReviewed: true };
    });
    const guess = months["2026-10"].find((tx) => tx.merchant === "BIGBASKET");
    guess.confidence = "low";
    delete guess.manual;
    const guessedSms = guess.raw;
    const missedSms = "ABC Bank card ending 9876 charged INR 860.00 at CITY BOOKS on 29-Oct-26.";
    unparsed.splice(0, unparsed.length, { id: "missed-1", text: missedSms, receivedAt: "2026-10-29T10:00:00Z" });
    fintrack.load({ months, rules, categories: {}, accounts, unparsed, version: "preview", currentMonth: "2026-10" });

    click('[data-act="tab"][data-value="more"]');
    const moreRows = [...app.querySelectorAll(".group .li")].map((row) => plainText(row.innerText));
    ok("More explains guessed transactions affect totals", moreRows.some((row) => /Check Guessed Transactions Already included in your totals 1/.test(row)), moreRows.join(" | "));
    ok("More explains missed messages do not affect totals", moreRows.some((row) => /Messages FinTrack Missed Not included in your totals 1/.test(row)), moreRows.join(" | "));
    ok("More offers code-editor copy", app.querySelector('[data-act="copy-review"]') && /code editor's AI chat/.test(text()));
    const copyReview = app.querySelector('[data-act="copy-review"]');
    click('[data-act="copy-review"]');
    const everything = sent[sent.length - 1];
    ok("copy everything keeps both exact SMS bodies", everything.action === "copy" && everything.text.includes(guessedSms) && everything.text.includes(missedSms), JSON.stringify(everything));
    ok("copy everything labels both states", /guessed — included in totals/.test(everything.text) && /unrecognised — not in totals/.test(everything.text), everything.text);
    await wait(250);
    ok("copy confirms inline without a window", /Copied/.test(copyReview.innerText) && !app.querySelector(".alert"), text().slice(-200));

    click('[data-act="open-guessed"]');
    ok("guessed queue shows parsed summary and exact SMS", /Check Guesses These already affect your totals/.test(text()) && text().includes(guessedSms), text().slice(0, 400));
    ok("guessed queue has only copy and mark actions", app.querySelector('[data-act="copy-guessed"]') && app.querySelector('[data-act="mark-guessed"]') && !/Fix|Edit/.test(text()));
    const copyGuessed = app.querySelector('[data-act="copy-guessed"]');
    click('[data-act="copy-guessed"]');
    ok("single guessed copy is raw SMS only", sent[sent.length - 1].action === "copy" && sent[sent.length - 1].text === guessedSms, JSON.stringify(sent[sent.length - 1]));
    await wait(250);
    ok("single guessed copy confirms inline", /Copied/.test(copyGuessed.innerText) && !app.querySelector(".alert"));
    click('[data-act="mark-guessed"]');
    const marked = sent[sent.length - 1];
    ok("mark correct saves a review flag only", marked.action === "save" && marked.manual.id === guess.id && marked.manual.manual.lowConfidenceReviewed === true, JSON.stringify(marked));
    await wait(250);
    ok("mark correct explains result", /stays in your totals and is removed from Review/.test(text()), text().slice(-220));
    click('[data-act="close"]');
    ok("marked guess leaves queue", /All guesses marked correct/.test(text()), text());
    click('[data-act="back"]');
    ok("More guessed count becomes zero", [...app.querySelectorAll(".group .li")].some((row) => /Check Guessed Transactions Already included in your totals 0/.test(plainText(row.innerText))), text().slice(0, 300));

    click('[data-act="open-unparsed"]');
    ok("missed queue says not in totals and shows exact SMS", /Messages FinTrack Missed These do not affect your totals/.test(text()) && text().includes(missedSms), text().slice(0, 400));
    ok("missed queue only offers copy", app.querySelector('[data-act="copy-unparsed"]') && !/Add Transaction|Ignore|Delete|Clear/.test(text()));
    const copyUnparsed = app.querySelector('[data-act="copy-unparsed"]');
    click('[data-act="copy-unparsed"]');
    ok("single missed copy is raw SMS only", sent[sent.length - 1].action === "copy" && sent[sent.length - 1].text === missedSms, JSON.stringify(sent[sent.length - 1]));
    await wait(250);
    ok("single missed copy confirms inline", /Copied/.test(copyUnparsed.innerText) && !app.querySelector(".alert"));
  } catch (error) {
    out.push(`FAIL exception ${error.message} ${(error.stack || "").split("\n")[1]}`);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
