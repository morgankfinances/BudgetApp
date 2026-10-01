// src/lib/balances.js
// Estimated account balances. Coinrose isn't connected to any bank, so a
// balance is only an estimate: the starting balance someone entered (as of
// the end of a given day) plus the transactions they've uploaded since.
//
// An account's starting balance is stored as
//   startingBalance: { amount, date: "YYYY-MM-DD", owed }
// where `owed` marks a credit card or loan: the amount is what's owed, so
// purchases (money out) increase it and payments (money in) reduce it.

import { addDaysISO } from "./periods.js";

const cents = (n) => Math.round(Number(n || 0) * 100);

export function hasStartingBalance(account) {
  const b = account && account.startingBalance;
  return !!(b && /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") && Number.isFinite(Number(b.amount)));
}

// The estimate for one account, or null when it has no starting balance.
// Counts every transaction after the starting date (transfers and excluded
// categories too: moving money between accounts really does change each
// balance), but never skipped duplicates.
export function estimateBalance(account, transactions) {
  if (!hasStartingBalance(account)) return null;
  const { amount, date, owed } = account.startingBalance;
  let net = 0;
  let count = 0;
  let earlierCount = 0; // on or before the starting date: worked out backward
  let latestDate = null;
  transactions.forEach((t) => {
    if (t.accountId !== account.id || t.skippedDuplicateOf || !t.date) return;
    if (!latestDate || t.date > latestDate) latestDate = t.date;
    if (t.date <= date) {
      earlierCount += 1;
      return;
    }
    net += cents(t.amountIn) - cents(t.amountOut);
    count += 1;
  });
  const current = owed ? cents(amount) - net : cents(amount) + net;
  return {
    startAmount: Number(amount),
    startDate: date,
    owed: !!owed,
    current: current / 100,
    count,
    earlierCount,
    // The newest transaction uploaded for this account: the estimate can't
    // know about anything after it.
    latestDate,
  };
}

// Totals across accounts with a starting balance: what's in accounts, what's
// owed on cards and loans, and the difference.
export function totalBalances(accounts, transactions) {
  let have = 0;
  let owe = 0;
  let tracked = 0;
  accounts.forEach((a) => {
    const e = estimateBalance(a, transactions);
    if (!e) return;
    tracked += 1;
    if (e.owed) owe += cents(e.current);
    else have += cents(e.current);
  });
  return { tracked, have: have / 100, owe: owe / 100, net: (have - owe) / 100 };
}

// An account's estimated balance over time, worked out in both directions
// from the starting balance (as of the end of its date):
//   - forward: each later transaction is added or subtracted;
//   - backward: the balance at the end of an earlier day is the starting
//     balance with every transaction since then undone.
// So the history reaches back to just before the earliest uploaded
// transaction. That first point is marked `edge` (the real account goes
// back further; Coinrose just has no earlier data), and the starting
// balance's own point is marked `anchor`. Returns [{ date, value, edge?,
// anchor? }], oldest first (empty without a starting balance). For a card
// or loan, the value is what's owed.
export function balanceHistory(account, transactions) {
  if (!hasStartingBalance(account)) return [];
  const { amount, date, owed } = account.startingBalance;
  const sign = owed ? -1 : 1; // money in lowers what's owed
  const byDay = new Map();
  transactions.forEach((t) => {
    if (t.accountId !== account.id || t.skippedDuplicateOf || !t.date) return;
    byDay.set(t.date, (byDay.get(t.date) || 0) + cents(t.amountIn) - cents(t.amountOut));
  });
  const days = [...byDay.keys()].sort();
  const anchor = cents(amount);

  // Backward: undo each day's transactions, from the starting date back.
  const earlier = [];
  let back = anchor;
  days
    .filter((d) => d <= date)
    .reverse()
    .forEach((d) => {
      if (d < date) earlier.unshift({ date: d, value: back / 100 }); // end of that day
      back -= sign * byDay.get(d);
    });
  const before = [];
  if (days.length && days[0] <= date) {
    before.push({ date: addDaysISO(days[0], -1), value: back / 100, edge: true });
  }

  // Forward: add each later day's transactions.
  const later = [];
  let forward = anchor;
  days
    .filter((d) => d > date)
    .forEach((d) => {
      forward += sign * byDay.get(d);
      later.push({ date: d, value: forward / 100 });
    });
  return [...before, ...earlier, { date, value: anchor / 100, anchor: true }, ...later];
}

// All tracked accounts together: what's in accounts minus what's owed, over
// time, from the first day every tracked account's balance is known.
export function combinedHistory(accounts, transactions) {
  const tracked = accounts.filter(hasStartingBalance);
  if (!tracked.length) return [];
  const histories = tracked.map((a) => ({ owed: !!a.startingBalance.owed, points: balanceHistory(a, transactions) }));
  // The first day every tracked account's balance is known.
  const start = histories.reduce((latest, h) => (h.points[0].date > latest ? h.points[0].date : latest), "");
  const valueOn = (points, day) => {
    let value = points[0].value;
    for (const p of points) {
      if (p.date > day) break;
      value = p.value;
    }
    return value;
  };
  const days = new Set([start]);
  histories.forEach((h) => h.points.forEach((p) => p.date > start && days.add(p.date)));
  return [...days].sort().map((day) => ({
    date: day,
    value: histories.reduce((sum, h) => sum + (h.owed ? -1 : 1) * cents(valueOn(h.points, day)), 0) / 100,
  }));
}

// The headline numbers for a history: where it started and ended, the
// change, and its lowest and highest points.
export function summarizeHistory(points) {
  if (!points.length) return null;
  const low = points.reduce((a, b) => (b.value < a.value ? b : a));
  const high = points.reduce((a, b) => (b.value > a.value ? b : a));
  const first = points[0];
  const last = points[points.length - 1];
  return { start: first, end: last, change: (cents(last.value) - cents(first.value)) / 100, low, high };
}
