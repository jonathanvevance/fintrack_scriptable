(async () => {
  const out = [];
  const ok = (name, cond, extra = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
  const app = document.getElementById("app");
  const plainText = (text) => text.replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u2600-\u27BF\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
  const text = () => plainText(app.innerText);
  const click = (selector, match) => {
    const found = [...app.querySelectorAll(selector)].find((element) => !match || match.test(plainText(element.innerText)));
    if (!found) throw new Error(`no element ${selector} ${match}`);
    found.click();
  };

  try {
    const usd = months["2026-10"].find((tx) => tx.id === "usd");
    const isSelf = FT.accounts.compileAccounts(accounts);
    const counted = months["2026-10"].filter((tx) => !isSelf(tx));
    const expected = FT.format.totals(counted).INR.out;
    ok("converted USD joins INR spending total", app.querySelector(".big").innerText === FT.format.money(expected), `${app.querySelector(".big").innerText} vs ${FT.format.money(expected)}`);
    ok("spending summary has no currency-conversion suffix", !/includes \$20|date rates/.test(text()), text().slice(0, 250));

    click('[data-act="open-list"][data-filter="all"]');
    const row = [...app.querySelectorAll('[data-act="open-tx"]')].find((element) => /OPENAI/.test(element.innerText));
    ok("foreign row keeps USD and shows INR estimate", /\$20/.test(row.innerText) && /≈ ₹1,898.60/.test(row.innerText), plainText(row.innerText));
    row.click();
    ok("foreign detail explains conversion", /\$20 ≈ ₹1,898.60 at transaction-date rate/.test(text()), text().slice(0, 250));
    click('[data-act="back"]');
    click('[data-act="back"]');

    delete usd.inrPaise;
    delete usd.exchangeRate;
    delete usd.exchangeRateDate;
    fintrack.load({ months, rules, categories: {}, accounts, unparsed, version: "preview", currentMonth: "2026-10" });
    click('[data-act="open-list"][data-filter="all"]');
    const unavailableRow = [...app.querySelectorAll('[data-act="open-tx"]')].find((element) => /OPENAI/.test(element.innerText));
    ok("unavailable rate leaves foreign amount separate", /\$20/.test(unavailableRow.innerText) && !/₹1,898.60/.test(unavailableRow.innerText), plainText(unavailableRow.innerText));
    unavailableRow.click();
    ok("foreign detail says when the INR rate is unavailable", /INR rate unavailable/.test(text()), text().slice(0, 250));
  } catch (error) {
    out.push(`FAIL exception ${error.message} ${(error.stack || "").split("\n")[1]}`);
  }
  document.body.setAttribute("data-result", out.join(" | "));
})();
