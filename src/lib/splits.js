// src/lib/splits.js
// Split transactions: one line on a statement (a $180 Target run) divided
// among several categories (groceries $120, household $60).
//
// A split transaction stays one real transaction, holding
//   splits: [{ categoryId, amount }]   (amounts add up to its total)
// and no categoryId of its own. Budgets, reports, and the Overview see its
// pieces instead, through expandSplits(), in one central place, so those
// calculations never need to know about splits.

const toCents = (n) => Math.round(Number(n || 0) * 100);
const fromCents = (c) => c / 100;

export function hasSplits(t) {
  return Array.isArray(t.splits) && t.splits.length > 0;
}

// Uncategorized means no category and no split.
export function isUncategorized(t) {
  return !t.categoryId && !hasSplits(t);
}

export function transactionTotal(t) {
  return t.amountOut != null ? t.amountOut : t.amountIn || 0;
}

// Whether a transaction's split still adds up to its amount.
export function splitsFitAmount(t) {
  if (!hasSplits(t)) return true;
  return t.splits.reduce((sum, s) => sum + toCents(s.amount), 0) === toCents(transactionTotal(t));
}

// For budgets, reports, and totals: each split transaction becomes one piece
// per line, with that line's category and amount (money out stays money
// out). Returns the same list when nothing is split.
export function expandSplits(transactions) {
  if (!transactions.some(hasSplits)) return transactions;
  const out = [];
  transactions.forEach((t) => {
    if (!hasSplits(t)) {
      out.push(t);
      return;
    }
    const isOut = t.amountOut != null;
    t.splits.forEach((s, i) => {
      const { splits, ...rest } = t; // eslint-disable-line no-unused-vars
      out.push({
        ...rest,
        id: `${t.id}::${i + 1}`,
        splitOf: t.id,
        categoryId: s.categoryId || null,
        amountOut: isOut ? s.amount : null,
        amountIn: isOut ? null : s.amount,
      });
    });
  });
  return out;
}

// An even split of total into `parts`, to the cent: leftover cents go to
// the first lines, so it always adds up exactly ($100 in 3 parts:
// 33.34, 33.33, 33.33).
export function evenSplit(total, parts) {
  const cents = toCents(total);
  const base = Math.floor(cents / parts);
  const extra = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => fromCents(base + (i < extra ? 1 : 0)));
}

// Amounts for percentages of total, to the cent. If the percentages add up
// to 100, the amounts add up to exactly the total (leftover cents go to the
// lines with the largest remainders).
export function percentsToAmounts(total, percents) {
  const cents = toCents(total);
  const exact = percents.map((p) => (cents * (Number(p) || 0)) / 100);
  const floors = exact.map(Math.floor);
  const sumPercent = percents.reduce((sum, p) => sum + (Number(p) || 0), 0);
  if (Math.abs(sumPercent - 100) < 1e-9) {
    let leftover = cents - floors.reduce((a, b) => a + b, 0);
    const order = exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; leftover > 0 && k < order.length; k += 1, leftover -= 1) floors[order[k][1]] += 1;
  }
  return floors.map(fromCents);
}

// How a split in progress adds up: what's assigned, what's left, and
// whether it can be saved (at least two lines, each with a category and a
// positive amount, adding up exactly).
export function checkSplit(total, lines) {
  const assigned = lines.reduce((sum, l) => sum + toCents(l.amount), 0);
  const remaining = toCents(total) - assigned;
  const complete = lines.every((l) => l.categoryId && toCents(l.amount) > 0);
  return {
    assigned: fromCents(assigned),
    remaining: fromCents(remaining),
    ok: lines.length >= 2 && complete && remaining === 0,
  };
}

// Lines ready to save: amounts as numbers, lines with the same category
// combined.
export function cleanSplitLines(lines) {
  const byCategory = new Map();
  lines.forEach((l) => {
    byCategory.set(l.categoryId, (byCategory.get(l.categoryId) || 0) + toCents(l.amount));
  });
  return [...byCategory].map(([categoryId, cents]) => ({ categoryId, amount: fromCents(cents) }));
}

// When a category is merged into another (toId) or deleted (toId null),
// update the split lines that use it. Merging can leave two lines with the
// same category; they're combined.
export function remapSplitCategory(t, fromId, toId) {
  if (!hasSplits(t) || !t.splits.some((s) => s.categoryId === fromId)) return t;
  const remapped = t.splits.map((s) => (s.categoryId === fromId ? { ...s, categoryId: toId } : s));
  return { ...t, splits: toId ? cleanSplitLines(remapped) : remapped };
}
