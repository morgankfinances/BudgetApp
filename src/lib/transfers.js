// src/lib/transfers.js
// Transfers between a household's own accounts (checking to savings, paying
// the credit card) aren't spending or income. Counted as ordinary
// transactions, the money would show up twice: once going out and once
// coming in.
//
// Marking a pair as a transfer puts both sides in an excluded "Transfers"
// category, which every budget, report, and total already skips, and links
// them (transferWith) so the app can show and undo the pairing.

import { uid } from "./utils.js";

// Card payments and bank transfers often post a day or more apart.
export const TRANSFER_WINDOW_DAYS = 4;

const cents = (n) => Math.round(Math.abs(n || 0) * 100);
const dayGap = (a, b) => Math.abs((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 864e5);

// Finds likely transfers: money leaving one account and the same amount
// arriving in a different account within TRANSFER_WINDOW_DAYS. Only
// transactions that currently count (not in an excluded category, not
// already paired) are considered, and pairs someone said weren't transfers
// are never suggested again. Each transaction pairs at most once; the
// closest dates win.
//
// Returns [{ outId, inId, amount, days }], oldest first.
export function findTransferPairs(transactions, categories) {
  const excluded = new Set(categories.filter((c) => c.excluded).map((c) => c.id));
  const eligible = transactions.filter(
    (t) =>
      t.date && !t.transferWith && !t.skippedDuplicateOf && !(t.splits && t.splits.length) && !(t.categoryId && excluded.has(t.categoryId))
  );
  const incomingByAmount = new Map();
  eligible.forEach((t) => {
    if (t.amountIn == null || t.amountOut != null) return;
    const key = cents(t.amountIn);
    if (!incomingByAmount.has(key)) incomingByAmount.set(key, []);
    incomingByAmount.get(key).push(t);
  });

  const candidates = [];
  eligible.forEach((out) => {
    if (out.amountOut == null) return;
    const matches = incomingByAmount.get(cents(out.amountOut)) || [];
    matches.forEach((into) => {
      if (into.accountId === out.accountId) return;
      const days = dayGap(out.date, into.date);
      if (days > TRANSFER_WINDOW_DAYS) return;
      if ((out.notTransferWith || []).includes(into.id) || (into.notTransferWith || []).includes(out.id)) return;
      candidates.push({ outId: out.id, inId: into.id, amount: out.amountOut, days, date: out.date });
    });
  });

  // Closest dates first, so each transaction goes to its best match.
  candidates.sort((a, b) => a.days - b.days || a.date.localeCompare(b.date));
  const used = new Set();
  const pairs = [];
  candidates.forEach((c) => {
    if (used.has(c.outId) || used.has(c.inId)) return;
    used.add(c.outId);
    used.add(c.inId);
    pairs.push({ outId: c.outId, inId: c.inId, amount: c.amount, days: c.days, date: c.date });
  });
  pairs.sort((a, b) => a.date.localeCompare(b.date));
  return pairs.map(({ outId, inId, amount, days }) => ({ outId, inId, amount, days }));
}

// The excluded category transfers go into: an existing excluded category
// named "Transfers" if there is one, otherwise a new one. (A "Transfers"
// category someone uses for something else, not excluded, is left alone.)
function transferCategory(categories) {
  const existing = categories.find((c) => c.excluded && /^transfers?$/i.test(c.name.trim()));
  if (existing) return { category: existing, categories };
  const taken = new Set(categories.map((c) => c.name.trim().toLowerCase()));
  const name = taken.has("transfers") ? "Transfers between accounts" : "Transfers";
  const category = {
    id: uid(),
    name,
    excluded: true,
    isIncome: false,
    budgetType: "spend",
    accumulateActuals: {},
    fundAdjustments: [],
    createdAt: new Date().toISOString(),
  };
  return { category, categories: [...categories, category] };
}

// Marks pairs as transfers. Returns the updated transactions and categories
// (a "Transfers" category is added if needed).
export function linkTransfers(transactions, categories, pairs) {
  if (!pairs.length) return { transactions, categories };
  const { category, categories: nextCategories } = transferCategory(categories);
  const partner = new Map();
  pairs.forEach(({ outId, inId }) => {
    partner.set(outId, inId);
    partner.set(inId, outId);
  });
  const nextTransactions = transactions.map((t) => {
    if (!partner.has(t.id)) return t;
    const { categorySuggested, ...rest } = t; // eslint-disable-line no-unused-vars
    return { ...rest, categoryId: category.id, transferWith: partner.get(t.id) };
  });
  return { transactions: nextTransactions, categories: nextCategories };
}

// Undoes a pairing: both sides lose the link and go back to uncategorized.
export function unlinkTransfer(transactions, id) {
  const t = transactions.find((x) => x.id === id);
  if (!t || !t.transferWith) return transactions;
  const ids = new Set([id, t.transferWith]);
  return transactions.map((x) => {
    if (!ids.has(x.id)) return x;
    const { transferWith, ...rest } = x; // eslint-disable-line no-unused-vars
    return { ...rest, categoryId: null };
  });
}

// "Not a transfer": remember it on both sides so it's never suggested again.
export function dismissTransferPair(transactions, { outId, inId }) {
  return transactions.map((t) => {
    if (t.id === outId) return { ...t, notTransferWith: [...(t.notTransferWith || []), inId] };
    if (t.id === inId) return { ...t, notTransferWith: [...(t.notTransferWith || []), outId] };
    return t;
  });
}

// When one side of a pair gets a different category, or is deleted, the
// other side is no longer paired either. Returns the transactions with any
// broken links removed.
export function removeBrokenTransferLinks(transactions) {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  let changed = false;
  const next = transactions.map((t) => {
    if (!t.transferWith) return t;
    const other = byId.get(t.transferWith);
    const intact = other && other.transferWith === t.id && other.categoryId === t.categoryId && t.categoryId;
    if (intact) return t;
    changed = true;
    const { transferWith, ...rest } = t; // eslint-disable-line no-unused-vars
    return rest;
  });
  return changed ? next : transactions;
}
