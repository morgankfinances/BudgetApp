// src/lib/balances.js
// Estimated account balances. Coinrose isn't connected to any bank, so a
// balance is only an estimate: the starting balance someone entered (as of
// the end of a given day) plus the transactions they've uploaded since.
//
// An account's starting balance is stored as
//   startingBalance: { amount, date: "YYYY-MM-DD", owed }
// where `owed` marks a credit card or loan: the amount is what's owed, so
// purchases (money out) increase it and payments (money in) reduce it.

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
  let latestDate = null;
  transactions.forEach((t) => {
    if (t.accountId !== account.id || t.skippedDuplicateOf || !t.date) return;
    if (!latestDate || t.date > latestDate) latestDate = t.date;
    if (t.date <= date) return;
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
