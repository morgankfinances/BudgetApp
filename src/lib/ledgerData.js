import { loadLedger } from "../ledgerStore.js";
import { uid } from "./utils.js";


export const DEFAULT_CATEGORY_NAMES = [
  "Groceries",
  "Dining & Restaurants",
  "Transportation",
  "Bills & Utilities",
  "Shopping",
  "Entertainment",
  "Health",
  "Income",
  "Transfers",
];


export function createDefaultCategories() {
  return DEFAULT_CATEGORY_NAMES.map((name) => ({ id: uid(), name, excluded: name === "Transfers" }));
}


// The subset of a loadData() result that actually gets merged/compared
// across clients — same shape either way, so this can be applied to
// both "what I just loaded" and "what I'm about to save."
export function normalizeSnapshot(data) {
  return {
    accounts: data.accounts || [],
    transactions: data.transactions || [],
    categories: data.categories || [],
    budgetGroups: data.budgetGroups || [],
    plannedIncome: data.plannedIncome != null ? data.plannedIncome : null,
    incomeWarningDismissed: !!data.incomeWarningDismissed,
    hiddenBudgetMonths: data.hiddenBudgetMonths || [],
    excludeUnassignedFromBudget: !!data.excludeUnassignedFromBudget,
  };
}


// Applies the app's defaults and cleanup to freshly loaded data. For a
// household that has never saved anything, categories comes in as
// undefined and gets the default set.
export function normalizeLoadedLedger(parsed) {
  const categories = Array.isArray(parsed.categories) ? parsed.categories : createDefaultCategories();
  const budgetGroups = Array.isArray(parsed.budgetGroups) ? parsed.budgetGroups : [];
  const normalizeBudgetItem = (b) => ({
    ...b,
    budgetType: b.budgetType === "accumulate" ? "accumulate" : "spend",
    accumulateTarget: b.accumulateTarget != null ? b.accumulateTarget : null,
    accumulateActuals: b.accumulateActuals && typeof b.accumulateActuals === "object" ? b.accumulateActuals : {},
    fundAdjustments: Array.isArray(b.fundAdjustments) ? b.fundAdjustments : [],
  });
  return {
    accounts: parsed.accounts || [],
    transactions: parsed.transactions || [],
    categories: categories.map((c) => normalizeBudgetItem({ ...c, excluded: !!c.excluded, isIncome: !!c.isIncome })),
    budgetGroups: budgetGroups.map(normalizeBudgetItem),
    plannedIncome: parsed.plannedIncome != null ? parsed.plannedIncome : null,
    incomeWarningDismissed: !!parsed.incomeWarningDismissed,
    hiddenBudgetMonths: Array.isArray(parsed.hiddenBudgetMonths) ? parsed.hiddenBudgetMonths : [],
    excludeUnassignedFromBudget: !!parsed.excludeUnassignedFromBudget,
  };
}


// Loads the household's data from the database tables. Returns:
//   snapshot   what the app shows
//   savedBase  what the database actually holds (for working out what
//              changed at the next save)
//   version    the household's change counter
// Throws if the data can't be loaded, rather than quietly showing an
// empty ledger that the next save could then build on.
export async function loadData() {
  const { data, settingsSaved, version } = await loadLedger();
  const neverSaved =
    !settingsSaved && data.accounts.length === 0 && data.categories.length === 0 && data.transactions.length === 0;
  const snapshot = normalizeSnapshot(
    normalizeLoadedLedger({ ...data, categories: neverSaved ? undefined : data.categories })
  );
  // A brand-new household's default categories exist only in the app until
  // the first save, so they're left out of what the database holds.
  const savedBase = { ...snapshot, categories: neverSaved ? [] : snapshot.categories, settingsSaved };
  return { snapshot, savedBase, version };
}
