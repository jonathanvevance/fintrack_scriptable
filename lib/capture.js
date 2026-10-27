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

  const tx = {
    id: store.hashText(sms),
    ...parsed,
    raw: sms,
    capturedAt: receivedAt.toISOString(),
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

module.exports = { capture };
