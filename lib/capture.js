// SMS text -> stored transaction. Shared by "FinTrack SMS" (Shortcuts) and the paste flow in "FinTrack".

const sibling = (name) => module.filename.replace(/[^/]+$/, name);
const { parseSms } = importModule(sibling("parse.js"));
const store = importModule(sibling("store.js"));
const { money } = importModule(sibling("format.js"));

/**
 * Returns { status: "saved" | "duplicate" | "unparsed" | "empty", tx?, summary }.
 * `summary` is a one-line human description for notifications and Shortcuts output.
 */
async function capture(text, receivedAt = new Date()) {
  const sms = String(text || "").trim();
  if (!sms) return { status: "empty", summary: "No message text received" };

  const parsed = parseSms(sms, receivedAt);
  if (!parsed) {
    await store.addUnparsed(sms, receivedAt);
    return { status: "unparsed", summary: "Saved to Unparsed: " + sms.slice(0, 80) };
  }

  const capturedAt = receivedAt.toISOString();
  const tx = {
    id: store.hashText(sms + "|" + capturedAt),
    textHash: store.hashText(sms),
    ...parsed,
    raw: sms,
    capturedAt,
  };
  const { duplicate } = await store.addTransaction(tx);
  const who = tx.merchant || tx.bank || "Unknown";
  const verb = tx.amountPaise < 0 ? "spent at" : "received from";
  const flag = tx.confidence === "low" ? " (check)" : "";
  return {
    status: duplicate ? "duplicate" : "saved",
    tx,
    summary: `${money(tx.amountPaise < 0 ? -tx.amountPaise : tx.amountPaise, tx.currency)} ${verb} ${who}${flag}`,
  };
}

/**
 * Saves messages "FinTrack SMS" stashed after a failure, then re-parses with the current
 * templates: low-confidence transactions in month `ym` that a template now recognises,
 * and unrecognised messages that now parse. Returns how many were fixed.
 */
async function recheck(ym) {
  let fixed = 0;
  const pending = await store.listPending();
  if (pending.length) {
    for (const p of pending) await capture(p.text, new Date(p.receivedAt));
    store.setPending([]);
    fixed += pending.length;
  }
  for (const t of await store.listMonth(ym)) {
    if (t.confidence !== "low") continue;
    const parsed = parseSms(t.raw, new Date(t.capturedAt));
    if (!parsed || parsed.confidence !== "high") continue;
    if (parsed.date.slice(0, 7) === ym) {
      await store.updateTransaction(ym, t.id, parsed);
    } else {
      await store.deleteTransaction(ym, t.id);
      await store.addTransaction({ ...t, ...parsed });
    }
    fixed++;
  }
  for (const u of await store.listUnparsed()) {
    const result = await capture(u.text, new Date(u.receivedAt));
    if (result.status === "saved" || result.status === "duplicate") {
      await store.deleteUnparsed(u.id);
      fixed++;
    }
  }
  return fixed;
}

module.exports = { capture, recheck };
