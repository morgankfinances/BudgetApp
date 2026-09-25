import { describe, it, expect, vi, beforeEach } from "vitest";

// A plain stand-in for the database load (Vitest's tracked mocks can
// re-raise a rejected promise even after the code under test handles it).
let loadLedgerImpl = async () => { throw new Error("not set"); };
const loadLedger = {
  mockResolvedValue: (v) => { loadLedgerImpl = async () => v; },
  mockImplementation: (fn) => { loadLedgerImpl = fn; },
  mockReset: () => { loadLedgerImpl = async () => { throw new Error("not set"); }; },
};
vi.mock("../../ledgerStore.js", () => ({ loadLedger: (...a) => loadLedgerImpl(...a) }));
const { DEFAULT_CATEGORY_NAMES, createDefaultCategories, normalizeSnapshot, normalizeLoadedLedger, loadData } = await import("../ledgerData.js");

describe("default categories", () => {
  it("creates one uncategorized-flag-free category per default name, each with its own id", () => {
    const cats = createDefaultCategories();
    expect(cats.map((c) => c.name)).toEqual(DEFAULT_CATEGORY_NAMES);
    expect(new Set(cats.map((c) => c.id)).size).toBe(cats.length);
  });
});

describe("normalizeSnapshot", () => {
  it("fills every field with a safe default", () => {
    expect(normalizeSnapshot({})).toEqual({ accounts: [], transactions: [], categories: [], budgetGroups: [],
      plannedIncome: null, incomeWarningDismissed: false, hiddenBudgetMonths: [], excludeUnassignedFromBudget: false });
    expect(normalizeSnapshot({ plannedIncome: 0, incomeWarningDismissed: 1 })).toMatchObject({ plannedIncome: 0, incomeWarningDismissed: true });
  });
});

describe("normalizeLoadedLedger", () => {
  it("gives a never-saved household the default categories", () => {
    expect(normalizeLoadedLedger({}).categories.map((c) => c.name)).toEqual(DEFAULT_CATEGORY_NAMES);
  });
  it("cleans up budget settings on categories and groups", () => {
    const r = normalizeLoadedLedger({
      categories: [{ id: "c", name: "C", budgetType: "weird", accumulateActuals: "bad", fundAdjustments: "bad" }],
      budgetGroups: [{ id: "g", budgetType: "accumulate", accumulateTarget: 50, accumulateActuals: { "2026-09-01": 5 }, fundAdjustments: [{ amount: 1 }] }],
      hiddenBudgetMonths: "not a list", plannedIncome: 2700,
    });
    expect(r.categories[0]).toMatchObject({ budgetType: "spend", accumulateTarget: null, accumulateActuals: {}, fundAdjustments: [],
      excluded: false, isIncome: false });
    expect(r.budgetGroups[0]).toMatchObject({ budgetType: "accumulate", accumulateTarget: 50, accumulateActuals: { "2026-09-01": 5 } });
    expect(r.hiddenBudgetMonths).toEqual([]);
    expect(r.plannedIncome).toBe(2700);
  });
  it("keeps an explicitly empty category list empty", () => {
    expect(normalizeLoadedLedger({ categories: [] }).categories).toEqual([]);
  });
});

describe("loadData", () => {
  beforeEach(() => loadLedger.mockReset());
  it("a brand-new household sees default categories that aren't marked as saved yet", async () => {
    loadLedger.mockResolvedValue({ data: { accounts: [], categories: [], transactions: [], budgetGroups: [] }, settingsSaved: false, version: 0 });
    const { snapshot, savedBase, version } = await loadData();
    expect(snapshot.categories.length).toBe(DEFAULT_CATEGORY_NAMES.length);
    expect(savedBase.categories).toEqual([]);
    expect(savedBase.settingsSaved).toBe(false);
    expect(version).toBe(0);
  });
  it("an existing household loads as-is, marked as saved", async () => {
    const cat = { id: "c1", name: "Groceries" };
    loadLedger.mockResolvedValue({ data: { accounts: [], categories: [cat], transactions: [], budgetGroups: [], plannedIncome: 9 },
      settingsSaved: true, version: 7 });
    const { snapshot, savedBase, version } = await loadData();
    expect(snapshot.categories).toHaveLength(1);
    expect(savedBase.categories).toBe(snapshot.categories);
    expect(savedBase.settingsSaved).toBe(true);
    expect(snapshot.plannedIncome).toBe(9);
    expect(version).toBe(7);
  });
  it("a household that deleted every category isn't handed the defaults again", async () => {
    loadLedger.mockResolvedValue({ data: { accounts: [{ id: "a" }], categories: [], transactions: [], budgetGroups: [] }, settingsSaved: true, version: 3 });
    expect((await loadData()).snapshot.categories).toEqual([]);
  });
  it("passes load failures on, instead of showing an empty ledger", async () => {
    loadLedger.mockImplementation(async () => { throw new Error("offline"); });
    let error = null;
    try {
      await loadData();
    } catch (e) {
      error = e;
    }
    expect(error?.message).toBe("offline");
  });
});
