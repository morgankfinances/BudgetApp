
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
  Object.entries(map).forEach(([key, ids]) => {
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
    if (t.categoryId) return;
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
