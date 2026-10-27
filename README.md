# fintrack_scriptable

Private household money tracking on iPhone, built on [Scriptable](https://scriptable.app). v0 does one thing: bank SMS → transactions list.

Code lives here; data never does. Transactions are stored as JSON in Scriptable's iCloud folder on the phone (`fintrack/data/`).

## What gets installed

| Scriptable script | What it does |
|---|---|
| `FinTrack Update` | Downloads the latest code from this repo (files listed in `manifest.json`). Never touches `fintrack/data/`. |
| `FinTrack SMS` | Run by a Shortcuts message automation. Parses the SMS, saves it, posts a notification. No network. |
| `FinTrack` | Month view: totals, transactions, unrecognised messages, paste-an-SMS, update. Also works as a widget. |

Library code goes to `fintrack/lib/` inside Scriptable's folder.

## One-time iPhone setup

1. **Install.** In Safari on the iPhone, open [`scripts/FinTrack Update.js` (raw)](https://raw.githubusercontent.com/jonathanvevance/fintrack_scriptable/master/scripts/FinTrack%20Update.js), select all, copy. In Scriptable tap **+**, paste, rename the script to exactly `FinTrack Update`, tap **Done**, then run it. `FinTrack` and `FinTrack SMS` appear in the list.
2. **Try it.** Copy any bank SMS from Messages, run `FinTrack`, tap **Add SMS from clipboard**.
3. **Automate.** Shortcuts → **Automation** → **+** → **Message**:
   - **Message Contains**: `debited` (leave Sender empty) → **Run Immediately** → **Next**.
   - **New Blank Automation** → add action **Scriptable → Run Script** → Script: `FinTrack SMS`.
   - Tap **Parameter** → **Shortcut Input**, then tap the inserted variable and choose **Content**. Leave **Run In App** off.
   - Repeat for `used at` (HSBC card), `credited` and `spent`. One keyword per automation.
4. **Widget (optional).** Add a Scriptable widget to the Home Screen, long-press → **Edit Widget** → Script: `FinTrack`.

## Updating

Push to `master`, then on the phone run `FinTrack Update` (or tap **Update FinTrack** at the bottom of `FinTrack`).

If `FinTrack SMS` fails, it keeps the message on the phone (`fintrack-pending.json` in Scriptable's local folder) and notifies you; opening `FinTrack` saves it. A data file that cannot be read is never overwritten: it is copied to `*.corrupt-<time>.json` and FinTrack shows the error.

## Adding a bank template

Templates live in `lib/parse.js` (`TEMPLATES`). Messages no template recognises go to the generic parser (marked "check") or to **Unrecognised** in `FinTrack`, where **Copy text** gives you the exact wording to add a template and a test case for.

## Tests

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/run.js
```
