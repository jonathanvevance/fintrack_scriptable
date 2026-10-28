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

Rules live only on the phone, in `fintrack/data/rules.json` (never in this repo, never touched by updates). The format is in `lib/tags.js`; `rules.example.json` has samples. A rule sets one thing: the category. In the dashboard, tap a transaction and pick a category; turn on **Always** to make it a rule, or leave it off for just that transaction. The **Rules** tab edits the full list in plain words (recipient **is** / **contains** a list of names, money in or out, amount, and under More conditions what the SMS mentions or the account). A new category gets an emoji and colour (suggested from its name, changeable), kept in `fintrack/data/categories.json`. Older rules with `owner` or `tags` still load; those parts are ignored.

## Dashboard

Opening `FinTrack` shows the page in `dashboard/`, run by Scriptable in a web view (`lib/dashboard.js`) with every month, the rules and unrecognised messages handed in directly: no file picker, no network. Tabs: **Spending** (swipe the month pills, or **All YYYY** for the whole year with a bar per month; total, spend per category, latest transactions), **Insights** (Trends: one category's line over 6 or 12 months against its average; **Recurring** payments spotted automatically, coming up and paid this month; **Recipients** as bubbles sized by spend for a month or a year), **Rules** (add, edit, reorder, delete, each with its match count; the **Categories** row at the top opens every category, where you can rename one, change its icon, see and add the rules that set it, merge it into another or delete it) and **More** (add an SMS from the clipboard, unrecognised messages, update, version). The page cannot write files: it asks Scriptable (`fintrack://do?...`), which checks the request, does it and replies. Saving a rule sends the whole list, which Scriptable validates before writing `rules.json`; the saved alert has **Undo**.

To work on it on a laptop, open `dashboard/preview.html` (fake data; requests are logged to the console).

## Adding a bank template

Templates live in `lib/parse.js` (`TEMPLATES`). Messages no template recognises go to the generic parser (marked "check") or to **More → Unrecognised Messages** in `FinTrack`, where tapping a message (or **Copy All for Review**) gives you the exact wording to add a template and a test case for.

## Tests

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/run.js
```
