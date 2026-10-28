# fintrack_scriptable

Private household money tracking on iPhone, built on [Scriptable](https://scriptable.app). v0 does one thing: bank SMS → transactions list.

Code lives here; data never does. Transactions are stored as JSON in Scriptable's iCloud folder on the phone (`fintrack/data/`).

## What gets installed

| Scriptable script | What it does |
|---|---|
| `FinTrack Update` | Downloads the latest code from this repo (files listed in `manifest.json`). Never touches `fintrack/data/`. |
| `FinTrack SMS` | Run by a Shortcuts message automation. Parses the SMS, saves it, posts a notification. No network. |
| `FinTrack` | Opens the dashboard (see below). Also works as a widget. |

Library code goes to `fintrack/lib/` inside Scriptable's folder.

## One-time iPhone setup

1. **Install.** In Safari on the iPhone, open [`scripts/FinTrack Update.js` (raw)](https://raw.githubusercontent.com/jonathanvevance/fintrack_scriptable/master/scripts/FinTrack%20Update.js), select all, copy. In Scriptable tap **+**, paste, rename the script to exactly `FinTrack Update`, tap **Done**, then run it. `FinTrack` and `FinTrack SMS` appear in the list.
2. **Try it.** Copy any bank SMS from Messages, run `FinTrack`, go to **More** and tap **Add SMS from Clipboard**.
3. **Automate.** Shortcuts → **Automation** → **+** → **Message**:
   - **Message Contains**: `debited` (leave Sender empty) → **Run Immediately** → **Next**.
   - **New Blank Automation** → add action **Scriptable → Run Script** → Script: `FinTrack SMS`.
   - Tap **Parameter** → **Shortcut Input**, then tap the inserted variable and choose **Content**. Leave **Run In App** off.
   - Repeat for `used at` (HSBC card), `credited` and `spent`. One keyword per automation.
4. **Widget (optional).** Add a Scriptable widget to the Home Screen, long-press → **Edit Widget** → Script: `FinTrack`.

## Updating

Push to `master`, then on the phone run `FinTrack Update` (or tap **More → Update FinTrack** in `FinTrack`).

If `FinTrack SMS` fails, it keeps the message on the phone (`fintrack-pending.json` in Scriptable's local folder) and notifies you; opening `FinTrack` saves it. A data file that cannot be read is never overwritten: it is copied to `*.corrupt-<time>.json` and FinTrack shows the error.

## Tagging

Rules live only on the phone, in `fintrack/data/rules.json` (never in this repo, never touched by updates). The format is in `lib/tags.js`; `rules.example.json` has samples. A rule sets one thing: the category. In the dashboard, tap a transaction and pick a category; turn on **Always** to make it a rule, or leave it off for just that transaction. The **Rules** tab edits the full list in plain words (**Paid** / **Received**, the name it was paid to or received from **is** / **contains** a list of names, amount, and under More conditions what the SMS mentions or the account). New categories are made in one place, the New Category screen (Rules → Categories, also reached from a transaction's **Manage Categories…**, or from the rule editor): a name plus an emoji and colour suggested from it, kept in `fintrack/data/categories.json`. A transaction only picks from existing categories. Older rules with `owner` or `tags` still load; those parts are ignored.

Self transfers move money between your own accounts, so they count as neither spent nor received. List your own banks under **More → My Accounts**: one page per bank with its account (optional: leave it out if you only have a card there), the account's UPI IDs, and its cards with the name each card's bill payment shows as in your bank's SMS. A transaction paid to or received from one of your UPI IDs, or paid to a name containing a card's bill name, is marked **↔︎ Self Transfer**. It is left out of every total, category, Insights view and the widget. It still appears in See All, and opening it says which account it matched. The list is kept in `fintrack/data/accounts.json` (format in `lib/accounts.js`). It is never in this repo and never touched by updates. Changing it re-marks every month at once.

## Dashboard

Opening `FinTrack` shows the page in `dashboard/`, run by Scriptable in a web view (`lib/dashboard.js`) with every month, the rules and unrecognised messages handed in directly: no file picker, no network. Tabs: **Spending** (swipe the month pills, or **All YYYY** for the whole year with a bar per month; total spent and a **Received** line that opens what came in, spend per category, latest transactions), **Insights** (Trends: one category's line over 6 or 12 months against its average; **Recurring** payments spotted automatically, coming up and paid this month; **Paid To** as bubbles sized by spend for a month or a year), **Rules** (add, edit, reorder, delete, each with its match count; the **Categories** row at the top opens every category, where you can rename one, change its icon, see and add the rules that set it, merge it into another or delete it) and **More** (My Accounts, add an SMS from the clipboard, unrecognised messages, update, version). The page cannot write files: it asks Scriptable (`fintrack://do?...`), which checks the request, does it and replies. Saving a rule sends the whole list, which Scriptable validates before writing `rules.json`; the saved alert has **Undo**.

To work on it on a laptop, open `dashboard/preview.html` (fake data; requests are logged to the console).

## Adding a bank template

Templates live in `lib/parse.js` (`TEMPLATES`). Messages no template recognises go to the generic parser (marked "check") or to **More → Unrecognised Messages** in `FinTrack`, where tapping a message (or **Copy All for Review**) gives you the exact wording to add a template and a test case for.

## Tests

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/run.js
```
