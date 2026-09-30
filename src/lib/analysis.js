
export function computeDuplicates(transactions) {
  const map = {};
  transactions.forEach((t) => {
    if (t.notDuplicate) return; // explicitly dismissed by the user — never re-flag
    const amt = t.amountOut != null ? t.amountOut : t.amountIn;
    if (amt == null || !t.date) return;
    const direction = t.amountOut != null ? "out" : "in";
    const key = `${t.date}|${Math.abs(amt).toFixed(2)}|${direction}`;
    if (!map[key]) map[key] = [];
    map[key].push(t.id);
  });
  const dupIds = new Set();
  const groupByKey = {};
  const keyByTxId = {};
  const byId = new Map(transactions.map((t) => [t.id, t]));
  Object.entries(map).forEach(([key, ids]) => {
    // Transactions that all carry different bank transaction IDs are clearly
    // separate, even with the same date and amount.
    const bankIds = ids.map((id) => byId.get(id).externalId);
    if (bankIds.every(Boolean) && new Set(bankIds).size === bankIds.length) return;
    if (ids.length > 1) {
      ids.forEach((id) => {
        dupIds.add(id);
        keyByTxId[id] = key;
      });
      groupByKey[key] = ids;
    }
  });
  return { dupIds, groupByKey, keyByTxId };
}


// For every currently-uncategorized transaction, suggest a category based
// on the most common category among the 10 most recent OTHER transactions
// that share the exact same (trimmed, case-insensitive) description and
// are themselves confirmed — actually categorized by a person, not just
// carrying an earlier unconfirmed suggestion. That last part matters: if
// a wrong guess could feed the next guess, mistakes would compound
// instead of getting corrected. This never touches categoryId itself —
// it's a pure, read-only suggestion the UI overlays on top of a
// genuinely uncategorized transaction, so nothing here changes what
// counts as "uncategorized" anywhere else in the app until a person
// actually confirms it.
export function buildCategorySuggestions(transactions, categories) {
  const validCategoryIds = new Set(categories.map((c) => c.id));
  const byDescription = new Map();
  transactions.forEach((t) => {
    // Learn only from categories a person chose or confirmed, never from
    // suggestions that were applied automatically and not yet confirmed
    // (otherwise one wrong guess would reinforce itself).
    if (!t.categoryId || t.categorySuggested || !validCategoryIds.has(t.categoryId)) return;
    const norm = (t.description || "").trim().toLowerCase();
    if (!norm) return;
    if (!byDescription.has(norm)) byDescription.set(norm, []);
    byDescription.get(norm).push(t);
  });
  byDescription.forEach((list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));

  const suggestionByTxnId = new Map();
  transactions.forEach((t) => {
    if (t.categoryId || (Array.isArray(t.splits) && t.splits.length)) return; // categorized, or split
    const norm = (t.description || "").trim().toLowerCase();
    if (!norm) return;
    const candidates = (byDescription.get(norm) || []).slice(0, 10);
    if (candidates.length === 0) return;
    const counts = {};
    candidates.forEach((c) => {
      counts[c.categoryId] = (counts[c.categoryId] || 0) + 1;
    });
    let best = null;
    let bestCount = 0;
    candidates.forEach((c) => {
      const n = counts[c.categoryId];
      if (n > bestCount) {
        bestCount = n;
        best = c.categoryId;
      }
    });
    if (best) suggestionByTxnId.set(t.id, best);
  });
  return suggestionByTxnId;
}

// Fills in suggested categories as real ones, marked categorySuggested so
// they show as "Suggested" until someone confirms or changes them. They
// count toward budgets and reports right away. With onlyIds, only those
// transactions are considered (for example, just the ones being imported).
// Returns the updated list and how many were filled in.
export function applyCategorySuggestions(transactions, categories, onlyIds = null) {
  const suggestions = buildCategorySuggestions(transactions, categories);
  let applied = 0;
  const next = transactions.map((t) => {
    if (onlyIds && !onlyIds.has(t.id)) return t;
    const categoryId = suggestions.get(t.id);
    if (!categoryId) return t;
    applied += 1;
    return { ...t, categoryId, categorySuggested: true };
  });
  return { transactions: applied ? next : transactions, applied };
}

// A transaction whose category a person has chosen or confirmed.
export function withoutSuggestedFlag(t) {
  if (!("categorySuggested" in t)) return t;
  const { categorySuggested, ...rest } = t; // eslint-disable-line no-unused-vars
  return rest;
}

// Transactions showing a suggested category nobody has confirmed yet.
export function isUnconfirmedSuggestion(t) {
  return !!(t.categoryId && t.categorySuggested);
}

/* ------------------------------------------------------------------ */
/* Skipping duplicates on import                                        */
/* ------------------------------------------------------------------ */

const sameText = (text) => String(text || "").trim().replace(/\s+/g, " ").toLowerCase();

// What makes two transactions "exactly the same" without bank IDs: same
// account, date, amount, direction, and description (ignoring
// capitalization and extra spaces).
function exactKey(t) {
  const out = t.amountOut != null;
  const amount = Math.abs(out ? t.amountOut : t.amountIn || 0).toFixed(2);
  return `${t.accountId}|${t.date}|${out ? "out" : "in"}|${amount}|${sameText(t.description)}`;
}

// Sorts transactions being imported into the ones to import and the ones
// already in the ledger.
//
// - With a bank transaction ID on both sides, the ID decides: same ID means
//   the same transaction, different IDs mean different ones.
// - Otherwise it falls back to an exact match (see exactKey).
// - Each existing transaction can match only one incoming one, so a file
//   with two identical purchases, where the ledger has one, imports one
//   and skips one.
// - Something matching a transaction that was already skipped once is
//   dropped, so re-importing the same file never piles up copies.
//
// Returns { imported, skipped: [{ transaction, duplicateOf, by }], alreadySkipped }, where `by`
// says how each match was made: "id" (bank transaction ID) or "details".
export function sortImportDuplicates(existing, incoming) {
  const byBankId = new Map();
  const byKey = new Map();
  existing.forEach((t) => {
    if (t.externalId) byBankId.set(`${t.accountId}|${t.externalId}`, t);
    const key = exactKey(t);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  });
  const used = new Set();
  const seenBankIds = new Set();
  const imported = [];
  const skipped = [];
  let alreadySkipped = 0;
  const settle = (t, match, by) => {
    used.add(match.id);
    if (match.skippedDuplicateOf) alreadySkipped += 1;
    else skipped.push({ transaction: t, duplicateOf: match.id, by });
  };
  incoming.forEach((t) => {
    if (t.externalId) {
      const bankKey = `${t.accountId}|${t.externalId}`;
      if (seenBankIds.has(bankKey)) {
        alreadySkipped += 1; // listed twice in the same file
        return;
      }
      seenBankIds.add(bankKey);
      const match = byBankId.get(bankKey);
      if (match && !used.has(match.id)) return settle(t, match, "id");
    }
    // Fallback: an exact match with a transaction that has no bank ID (or
    // when this one has none). A different bank ID means a different
    // transaction.
    const candidates = byKey.get(exactKey(t)) || [];
    const match = candidates.find((c) => !used.has(c.id) && (!c.externalId || !t.externalId));
    if (match) return settle(t, match, "details");
    imported.push(t);
  });
  return { imported, skipped, alreadySkipped };
}

// Transactions the app treats as real: everything except skipped duplicates.
export function isSkippedDuplicate(t) {
  return !!t.skippedDuplicateOf;
}
