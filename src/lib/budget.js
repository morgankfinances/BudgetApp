import { enumeratePeriodsBetween, getMonthStartISO, getWeekStartISO } from "./periods.js";


export function computeBudgetPeriodData(transactions, budgetItems, periodType) {
  const periodKeyFn = periodType === "weekly" ? getWeekStartISO : getMonthStartISO;
  const budgeted = budgetItems.filter((b) => {
    if ((b.budgetPeriod || "monthly") !== periodType) return false;
    if (b.isUnassignedPseudo) return true;
    return b.budgetAmount != null && b.budgetAmount > 0;
  });
  if (budgeted.length === 0) return null;

  const currentKey = periodKeyFn(new Date().toISOString().slice(0, 10));
  const spendMap = {};
  const periodSet = new Set([currentKey]);

  const spendItems = budgeted.filter((b) => b.budgetType !== "accumulate");
  transactions.forEach((t) => {
    if (!t.categoryId || !t.date) return;
    const pKey = periodKeyFn(t.budgetPeriodOverride || t.date);
    const spent = (t.amountOut || 0) - (t.amountIn || 0);
    spendItems.forEach((b) => {
      if (b.categoryIds.has(t.categoryId)) {
        periodSet.add(pKey);
        if (!spendMap[b.id]) spendMap[b.id] = {};
        spendMap[b.id][pKey] = (spendMap[b.id][pKey] || 0) + spent;
      }
    });
  });

  // Accumulate items don't derive from transactions at all — each period
  // defaults to "the full planned contribution happened," unless the user
  // has explicitly logged what was actually set aside that period.
  const accumulateItems = budgeted.filter((b) => b.budgetType === "accumulate");
  accumulateItems.forEach((b) => {
    const startKey = b.createdAt ? periodKeyFn(b.createdAt.slice(0, 10)) : currentKey;
    const itemPeriods = enumeratePeriodsBetween(startKey, currentKey, periodType);
    Object.keys(b.accumulateActuals || {}).forEach((k) => {
      if (!itemPeriods.includes(k)) itemPeriods.push(k);
    });
    spendMap[b.id] = {};
    itemPeriods.forEach((pKey) => {
      periodSet.add(pKey);
      const override = (b.accumulateActuals || {})[pKey];
      spendMap[b.id][pKey] = override != null ? override : b.budgetAmount;
    });
  });

  const periods = Array.from(periodSet).sort();

  return { budgeted, periods, spendMap, currentKey };
}


/* ------------------------------------------------------------------ */
/* Overview                                                             */
/*                                                                      */
/* A single at-a-glance landing page: this period's totals, where the   */
/* money actually went, and anything that needs attention (a budget     */
/* over or nearing its limit, transactions with nowhere assigned yet).  */
/* Reuses the same period preference set in Reports and the same pure   */
/* budget-computation functions Budget itself uses — not a parallel     */
/* re-implementation of either.                                        */
/* ------------------------------------------------------------------ */

export function flagForBudgetItem(item, spent) {
  const budget = item.budgetAmount || 0;
  if (budget <= 0) return "ok";
  const ratio = spent / budget;
  if (item.budgetType === "accumulate") {
    if (ratio >= 1) return "ok";
    if (ratio >= 0.8) return "warn";
    return "bad";
  }
  if (ratio >= 1) return "bad";
  if (ratio >= 0.8) return "warn";
  return "ok";
}


// Positive = good, negative = bad, regardless of item type — for a Spend
// item, coming in under budget is good; for an Accumulate item, meeting
// or beating the planned contribution is good, which is the opposite
// direction. This is what lets a chart or total blend both types into
// one consistent number instead of contradicting the per-item coloring.
export function budgetPerformance(item, actual) {
  const budget = item.budgetAmount || 0;
  return item.budgetType === "accumulate" ? actual - budget : budget - actual;
}


// The actual money currently sitting in an Accumulate fund: everything
// contributed since it started (the same total already shown as
// "cumulative saved"), less anything actually spent from it — a real
// transaction tagged to the category, not the assumed per-period
// contribution — plus any manual corrections the user has logged. This
// is deliberately derived fresh from current data rather than an
// incrementally-updated counter: if a withdrawal transaction later gets
// recategorized away, it stops counting against this fund automatically,
// with no special "give it back" logic needed.
export function computeFundBalance(item, contributionsTotal, transactions) {
  let netWithdrawn = 0;
  transactions.forEach((t) => {
    if (t.categoryId && item.categoryIds && item.categoryIds.has(t.categoryId)) {
      netWithdrawn += (t.amountOut || 0) - (t.amountIn || 0);
    }
  });
  const adjusted = (item.fundAdjustments || []).reduce((s, a) => s + (a.amount || 0), 0);
  return {
    balance: contributionsTotal - netWithdrawn + adjusted,
    contributed: contributionsTotal,
    withdrawn: netWithdrawn,
    adjusted,
  };
}


// Same contribution math computeBudgetPeriodData uses for Accumulate
// items, but for a single category or group in isolation — used where
// pulling in the whole Budget pipeline would be overkill, like a delete
// confirmation warning.
export function computeAccumulateContributionTotal(item) {
  if (item.budgetType !== "accumulate" || !item.budgetAmount) return 0;
  const periodType = item.budgetPeriod || "monthly";
  const periodKeyFn = periodType === "weekly" ? getWeekStartISO : getMonthStartISO;
  const currentKey = periodKeyFn(new Date().toISOString().slice(0, 10));
  const startKey = item.createdAt ? periodKeyFn(item.createdAt.slice(0, 10)) : currentKey;
  const periods = enumeratePeriodsBetween(startKey, currentKey, periodType);
  Object.keys(item.accumulateActuals || {}).forEach((k) => {
    if (!periods.includes(k)) periods.push(k);
  });
  return periods.reduce((sum, p) => {
    const override = (item.accumulateActuals || {})[p];
    return sum + (override != null ? override : item.budgetAmount);
  }, 0);
}


export function computeItemFundBalance(item, categoryIds, transactions) {
  const contributionsTotal = computeAccumulateContributionTotal(item);
  return computeFundBalance({ ...item, categoryIds }, contributionsTotal, transactions).balance;
}


// A category's spending counts as genuinely tracked only if it (or the
// group it belongs to) has an actual positive budget — matching exactly
// what computeBudgetPeriodData will include. A category sitting in a
// group that itself has no budget set is just as untracked as one with
// no group at all, even though it looks "handled" at a glance.
// Categories excluded from totals (e.g. Transfers) are never "unassigned"
// spending — they're deliberately outside budget tracking altogether.
// Neither is a category flagged as Income (paychecks etc.) — it isn't
// expense spending at all, so it should never count as untracked
// spending regardless of whether it has a budget.
export function getUnassignedCategoryIds(categories, budgetGroups) {
  const trackedByGroup = new Set();
  budgetGroups.forEach((g) => {
    if (g.budgetAmount != null && g.budgetAmount > 0) {
      (g.categoryIds || []).forEach((id) => trackedByGroup.add(id));
    }
  });
  const unassigned = new Set();
  categories.forEach((c) => {
    if (c.excluded) return;
    if (c.isIncome) return;
    if (trackedByGroup.has(c.id)) return;
    if (c.budgetAmount != null && c.budgetAmount > 0) return;
    unassigned.add(c.id);
  });
  return unassigned;
}


export function buildBudgetItems(categories, budgetGroups) {
  const groupedCategoryIds = new Set();
  budgetGroups.forEach((g) => (g.categoryIds || []).forEach((id) => groupedCategoryIds.add(id)));

  const groupItems = budgetGroups.map((g) => ({
    id: "group:" + g.id,
    name: g.name,
    budgetAmount: g.budgetAmount,
    budgetPeriod: g.budgetPeriod,
    budgetType: g.budgetType || "spend",
    accumulateTarget: g.accumulateTarget,
    accumulateActuals: g.accumulateActuals || {},
    createdAt: g.createdAt,
    categoryIds: new Set(g.categoryIds || []),
    isGroup: true,
  }));

  const categoryItems = categories
    .filter((c) => !groupedCategoryIds.has(c.id))
    .map((c) => ({
      id: "cat:" + c.id,
      name: c.name,
      budgetAmount: c.budgetAmount,
      budgetPeriod: c.budgetPeriod,
      budgetType: c.budgetType || "spend",
      accumulateTarget: c.accumulateTarget,
      accumulateActuals: c.accumulateActuals || {},
      createdAt: c.createdAt,
      categoryIds: new Set([c.id]),
      isGroup: false,
    }));

  return [...groupItems, ...categoryItems];
}
