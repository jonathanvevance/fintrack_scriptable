---
artifact_contract: "ce-handoff/v1"
created_at: "2026-10-27T08:49:01Z"
title: "Private household money manager for iPhone: Scriptable core + read-only PWA viewer"
summary: "Design handoff for a Fold-like personal finance app for two iPhones, built on Scriptable with iCloud files and a read-only PWA dashboard."
keywords: ["scriptable", "ios", "pwa", "personal-finance", "icloud", "rule-engine", "india", "fold-money"]
cwd: "/workspace"
resume_focus: "Set up a new local repo and run the feasibility spikes before building milestone 1."
---
# Handoff: private household money manager (Scriptable + read-only PWA)

This handoff carries a design discussion over to the agent that will build the app in a new local repo. **No production code exists yet.** An earlier throwaway PWA prototype proved that a Home Screen web app works on iPhone. It is deliberately not the starting point; ignore it.
Labels used below:

- **[User]**: the user stated it.
- **[Agent]**: the previous agent's recommendation or inference. Confirm with the user before treating it as fixed.

## 1. Goal

- **[User]** A personal app like [Fold Money](https://fold.money), used only by the user and his wife, each on their own iPhone. India: INR, Indian banks, UPI.
- **[User]** It tracks bank accounts, credit cards, FDs (fixed deposits) and investments.
- **[User]** No third party gets access to their finances: no account aggregator and no bank logins.
- **[User]** Fully hands-free entry is **not** required. Data comes in by uploading statements and tagging them at first. Rules generated from those tags should then take over categorising, and later SMS capture can reduce manual work.
- **[User]** Sharing between the two phones is optional and only needs to cover reports or a monthly review. A shared Google Sheet or Apple Numbers was mentioned as an alternative.
- **[User]** **Scriptable (the iOS app) is the platform.** The **PWA only reads a data file uploaded from iCloud Drive and presents it.** It does no data entry and no syncing.

## 2. Architecture

```
            ┌───────────── iPhone (each spouse) ───────────--──┐
 Bank SMS ─▶│ Shortcuts automation ─▶ Scriptable: capture.js   │
 Statement ▶│ Share menu ───────────▶ Scriptable: import.js    │
 (CSV/PDF)  │                         │ parse → normalise →    │
            │                         │ dedupe → rules → review│
            │                         ▼                        │
            │        iCloud Drive / <app folder>  (JSON files) │◀─ source of truth
            │                         │                        │
            │   Scriptable: widgets, notifications, monthly    │
            │   close, export.js ──▶ export/dashboard.json     │
            │                                     │            │
            │   PWA (Safari, Home Screen) ◀── user picks file  │
            │   read-only dashboards, cached in IndexedDB      │
            └───────────────────────────────────────────────--─┘
```

- **Scriptable handles everything with side effects:** taking data in, parsing, tagging, rules, storage, notifications, widgets and the monthly close.
- **The PWA is a static, read-only viewer** with no backend and no network calls after it loads. The user picks `dashboard.json` through the iOS file picker, and the PWA keeps the last loaded copy so it works offline.
- **[Agent]** Since the PWA is read-only, **tagging during statement review has to happen in Scriptable**, using `UITable` lists, `Alert` action sheets or a `WebView` form. Confirm this with the user, because it was a consequence of his decision rather than something he said.

## 3. iOS facts this design relies on (verify on a device)

- **Scriptable cannot open the installed PWA.** Opening the PWA's URL from Scriptable or Shortcuts opens a Safari tab. Home Screen web apps also keep storage separate from Safari, so deep links can't hand data to them. All data passes through files.
- **A PWA cannot appear in the iOS Share menu.** Scriptable can, so statements are shared to Scriptable.
- **A PWA can read user-picked files.** `<input type="file">` opens the Files picker, including iCloud Drive.
- **A PWA cannot read SMS.** iOS Shortcuts has a personal automation that triggers on incoming messages ("Message contains …") and can run without asking on iOS 17 and later. It can pass the message text to a Scriptable script.
- **Scriptable APIs the design uses (check against the [docs](https://docs.scriptable.app)):**
  - `FileManager.iCloud()`. Files may not be downloaded to the phone yet, so call `downloadFileFromiCloud()` before reading.
  - `fm.bookmarkedPath(name)`, for folders the user adds under Settings → File Bookmarks.
  - `args.fileURLs` / `args.plainTexts` / `args.shortcutParameter` and `Script.setShortcutOutput()`.
  - `config.runsInActionExtension` / `runsInWidget`.
  - `ListWidget`, `Notification` (with `setTriggerDate`, plus `allPending` / `removePending` for scheduling), `Request`, `Keychain`, `UITable`, `Alert`, `WebView` (with `evaluateJavaScript`), and `importModule()`.
- **Constraints:**
  - The Share-menu extension has a tight memory limit, so keep work there small or hand off to running in the app.
  - Widgets refresh when iOS decides to, so they should only read a precomputed summary file.
  - Scriptable runs plain JavaScript in JavaScriptCore. There's no Node, no npm at runtime, and modules use `module.exports` with `importModule`.
  - **Scriptable has no built-in way to read text from a PDF.**

## 4. Feasibility spikes to run before building

The plan depends on these. They are listed by risk, and none has been tested yet.

1. **Shared iCloud folder between two Apple IDs.** Share an iCloud Drive folder with the wife's Apple ID and bookmark it in Scriptable on both phones. Check that reading and writing work, and what happens when both phones write. If it fails, fall back to Scriptable's own iCloud folder on each phone, plus one of these for sharing: a monthly report file sent by AirDrop or WhatsApp, or a Google Sheet that both phones push to through Google Apps Script.
2. **PDF text extraction**, in particular **password-protected** PDFs. The mutual fund consolidated account statement (CAS) from CAMS/KFintech uses the PAN as its password, and many card statements are protected too. Options:
   - Load pdf.js (bundled with the scripts) in a Scriptable `WebView` and call it through `evaluateJavaScript`.
   - Use the Shortcuts "Get Text from PDF" action, which probably can't open password-protected files.
   - Ask the user to export CSV/XLS from the bank instead.
3. **SMS automation.** Confirm that a message automation runs immediately and passes the full message text into Scriptable, with real SMS from the user's banks.
4. **Share menu with real files.** Share a CSV and a PDF statement from the bank app or Mail to Scriptable and confirm `args.fileURLs` can be read within the extension's memory limit.

## 5. Data model (proposal; store money as integer paise)

The source of truth is JSON in the app's iCloud folder. Each spouse writes only to their own folder so iCloud never has two phones editing the same file.

```
<app folder>/
  household.json            members [{id:"me"|"wife", name}], categories, schemaVersion
  members/<memberId>/
    accounts.json
    transactions/YYYY-MM.json
    holdings.json
    rules.json              user + accepted rules
    merchant-map.json       merchantKey → {category, kind, count, lastTagged}
    inbox.json              SMS captures waiting for review or matching
    snapshots/YYYY-MM.json  frozen at monthly close
  raw/<memberId>/YYYY-MM/   original statements and SMS text (for re-parsing)
  export/dashboard.json     generated for the PWA (both members merged)
  export/summary.json       small file the widgets read
```

- **Account:**
  - Basic fields: `id`, `name`, `owner: me|wife|joint`, `institution`, `last4`.
  - `type`: `bank | credit_card | fd | mutual_fund | stock | ppf | epf | nps | gold | loan | cash | other`.
  - Extra details by type:
    - FD: `principal`, `ratePct`, `startDate`, `tenureMonths`, `compounding`, `payout`.
    - Card: `statementDay`, `dueDay`, `limit`.
    - Loan: `emi`, `rate`, `tenure`.
  - `manualBalance` + `balanceAsOf`, for types that are only checked monthly (PPF, EPF, NPS, gold).
- **Transaction:**
  - Core fields: `id`, `accountId`, `date`, `amountPaise` (negative is money out), `rawDescription`, `merchantKey`, `category`.
  - `kind`: `expense | income | transfer | investment | refund`.
  - Bookkeeping fields: `tags[]`, `source: statement|sms|manual`, `sourceRef`, `ruleId`, `confidence`, `reviewed`, `dedupeKey`, `matchedId`.
- **Holding:** `accountId`, `schemeCode | isin | symbol`, `units`, `avgCostPaise`, `asOf`.
- **Snapshot:** for one month, the balance of each account, net worth (split by owner), cash flow, totals by category, savings rate, and upcoming events.

## 6. Statement import, tagging and the rule engine

This is the core of the "start manual, become automatic" requirement.

1. **Parse** with one adapter per institution (`parsers/<bank>-<format>.js`), each turning a file into raw rows. Start with CSV/XLS, then PDF once spike 2 succeeds. The user's banks, cards and broker are **not known yet**; ask.
2. **Normalise the merchant.** Indian statement lines look like `UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/…`, `POS 4321 AMAZON PAY`, `NEFT-…`. Pull out the UPI ID or payee name, remove reference numbers, card digits and dates, and produce a stable `merchantKey`. **Most of the accuracy comes from this step**, so build a test case from every real string you see.
3. **Remove duplicates.** The same transaction can arrive from an SMS and later from a statement. Treat them as one when account, amount and date within ±1 day match. The statement copy wins, and the SMS copy is marked `matchedId`.
4. **Categorise, in this order of trust:**
   1. User rules, by priority.
   2. Accepted suggested rules.
   3. An exact match in `merchant-map`.
   4. Built-in keyword guesses (Swiggy/Zomato → Food, Uber/Ola → Transport, …).
   5. Otherwise, the "needs review" queue.

      ll in a category automatically only above a confidence threshold; below it, show a suggestion.
5. **Transfers are a separate kind**, never spending, otherwise money gets counted twice:
   - credit card bill payments
   - moving money between your own accounts
   - booking an FD
   - SIP (regular mutual fund investment) debits
   - payments between the spouses
    They need their own rules.
6. **Learn from tags.** Every review records the merchant key with the chosen category and kind. Once a merchant key has been tagged the same way 2 or 3 times in a row, suggest a rule, which the user accepts or edits. For merchants that are tagged inconsistently (Amazon can be groceries or shopping), suggest rules that add a condition on amount range, account or day of month, or keep asking.
7. **Rule format:** `{id, priority, when: {merchantKey?, contains?, regex?, accountId?, amountMinPaise?, amountMaxPaise?, dayOfMonth?}, then: {category, kind, tags?}, origin: user|suggested, hits, lastHit}`.

- **[Agent]** Plain lookups plus rules the user approves should cover most of a household's repeat transactions after a couple of months. That is an estimate, not a measurement. Hold off on machine learning.
- **[Agent]** How Fold categorises internally is unknown; don't assume a particular design.

## 7. What gets tracked and how data gets in

| What | How it comes in | What the app works out |
|---|---|---|
| Bank accounts | Statement import, SMS, monthly balance check | Cash flow, categories, balance |
| Credit cards | Statement import, SMS | Statement amount, due-date notification, spend per card |
| FDs | Entered once | Interest earned so far, maturity value, maturity notification |
| Mutual funds | CAS PDF (spike 2) or manual units | Value from live NAV via `https://api.mfapi.in/mf/<schemeCode>/latest` (free; check rate limits) |
| Stocks | Broker holdings CSV (e.g. Zerodha Console) | Value, gains and losses. Live prices are optional and there's no good free source, so update monthly by hand. |
| PPF / EPF / NPS / gold / loans | Manual balance at monthly close | Net worth, allocation |
**Monthly close** (a Scriptable script that walks through these steps):

1. Confirm each account's balance (last month's value filled in).
2. Import the remaining statements.
3. Clear the review queue.
4. Freeze `snapshots/YYYY-MM.json`.

## 8. SMS coverage for next month (open work)

Accounts in use: SBI and HSBC bank accounts (UPI from both, mainly HSBC), the SBI Cashback card and the
HSBC Premier card. ICICI templates stay for older transactions.

Decisions:

- Self transfers are not counted as spend; everything else that goes out is (bill payments such as phone
  recharge, and Zerodha investments, counted once).
- Paying a credit card bill is a self transfer: the card purchases are already counted. This covers the
  SBI card bill paid through PhonePe from SBI or HSBC UPI.
- Self transfers are recognised from exact SMS templates, not guessed. Templates stay generic; which
  UPI IDs and accounts are the user's own is private data under `fintrack/data`, never in this repo
  (tests use made-up IDs).
- Foreign-currency card spends stay separate from the INR total.

Already covered: HSBC UPI payment (`hsbc-account-paid`), SBI UPI payment (`sbi-upi-debit`), SBI card
spend in INR (`sbi-cc-spend`), SBI card cashback (`sbi-cc-cashback`), HSBC card spend in any currency
(`hsbc-cc-spend`), HSBC NEFT out (`hsbc-neft-out`), HSBC money received by UPI (`hsbc-upi-credit`), AutoPay reminders
ignored.

To do (each needs a real SMS with numbers and names replaced):

- [ ] Self transfers SBI → HSBC and HSBC → SBI, both the money-out and money-in SMS. Have: SBI → HSBC
      by UPI, HSBC side (`hsbc-upi-credit`). Still need: SBI side of it, and HSBC → SBI both sides.
- [ ] SBI card bill paid through PhonePe: the SBI / HSBC UPI debit and SBI Card's payment-received SMS.
- [ ] HSBC Premier card bill payment and any SMS it sends.
- [x] Money received by UPI into HSBC (`hsbc-upi-credit`).
- [ ] Money received by UPI into SBI.
- [ ] Zerodha from SBI (UPI AutoPay, UPI or NEFT/IMPS).
- [ ] Find out from the phone's messages whether Zerodha's own SMS reach FinTrack (the SMS automation's
      sender filter). If they do, the investment would be counted twice.
- [ ] Refunds or reversals on either card.
- [ ] SBI card spend in a foreign currency, if it happens.
- [ ] Salary or other incoming NEFT/IMPS into HSBC or SBI.
- [ ] Then: mark self transfers in the templates and leave them out of Spending totals (still listed).

