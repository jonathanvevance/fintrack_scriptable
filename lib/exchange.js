// Transaction-date foreign-currency conversion. Only currency codes and date ranges are sent to
// Frankfurter; transactions never leave the phone. Rates are cached under fintrack/data.

const API = "https://api.frankfurter.dev/v1";
const EMPTY = () => ({ version: 1, provider: "frankfurter", quote: "INR", rates: {} });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function cleanCache(value) {
  if (!value || value.version !== 1 || value.provider !== "frankfurter" || value.quote !== "INR" || !value.rates || typeof value.rates !== "object") {
    return EMPTY();
  }
  return value;
}

function before(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Exact transaction-date rate first; otherwise the latest cached rate before it (offline fallback).
function rateFor(cache, currency, date) {
  const rates = (cleanCache(cache).rates[currency] || {});
  if (Number.isFinite(rates[date]) && rates[date] > 0) return { rate: rates[date], date };
  const prior = Object.keys(rates).filter((d) => d <= date && Number.isFinite(rates[d]) && rates[d] > 0).sort().pop();
  return prior ? { rate: rates[prior], date: prior } : null;
}

function annotateTransaction(tx, cache) {
  if (!tx || tx.currency === "INR" || !CURRENCY.test(tx.currency || "") || !DATE.test(tx.date || "")) return tx;
  const found = rateFor(cache, tx.currency, tx.date);
  if (!found) return tx;
  return {
    ...tx,
    inrPaise: Math.round(tx.amountPaise * found.rate),
    exchangeRate: found.rate,
    exchangeRateDate: found.date,
  };
}

function annotateMonths(months, cache) {
  const converted = {};
  for (const [ym, list] of Object.entries(months || {})) converted[ym] = list.map((tx) => annotateTransaction(tx, cache));
  return converted;
}

function neededDates(months, cache) {
  const needed = {};
  for (const tx of Object.values(months || {}).flat()) {
    if (!tx || tx.currency === "INR" || !CURRENCY.test(tx.currency || "") || !DATE.test(tx.date || "")) continue;
    if (((cleanCache(cache).rates[tx.currency] || {})[tx.date]) > 0) continue;
    if (!needed[tx.currency]) needed[tx.currency] = new Set();
    needed[tx.currency].add(tx.date);
  }
  return needed;
}

function pickRate(apiRates, date) {
  const found = Object.keys(apiRates || {}).filter((d) => d <= date && Number.isFinite(apiRates[d].INR) && apiRates[d].INR > 0).sort().pop();
  return found ? apiRates[found].INR : null;
}

async function requestJson(url) {
  const request = new Request(url);
  request.timeoutInterval = 10;
  return request.loadJSON();
}

// One range request per currency fills every missing transaction date, including weekends by using
// Frankfurter's latest prior working-day observation. Any network/API failure leaves the cache alone.
async function refreshRates(months, store, fetchJson = requestJson) {
  let cache;
  try {
    cache = cleanCache(await store.readExchangeRates());
  } catch (_) {
    cache = EMPTY();
  }
  const needed = neededDates(months, cache);
  let changed = false;
  for (const [currency, set] of Object.entries(needed)) {
    const dates = [...set].sort();
    if (!dates.length) continue;
    const start = before(dates[0], 7);
    const end = dates[dates.length - 1];
    const url = `${API}/${start}..${end}?base=${encodeURIComponent(currency)}&symbols=INR`;
    try {
      const result = await fetchJson(url);
      if (!result || result.base !== currency || !result.rates || typeof result.rates !== "object") continue;
      const saved = { ...(cache.rates[currency] || {}) };
      for (const date of dates) {
        const rate = pickRate(result.rates, date);
        if (rate) {
          saved[date] = rate;
          changed = true;
        }
      }
      cache.rates[currency] = saved;
    } catch (_) {
      // Offline, unsupported currency, timeout or bad response: existing cached rates still work.
    }
  }
  if (changed) store.writeExchangeRates(cache);
  return cache;
}

module.exports = { annotateMonths, annotateTransaction, cleanCache, neededDates, pickRate, rateFor, refreshRates };
