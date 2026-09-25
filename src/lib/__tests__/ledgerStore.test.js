import { describe, it, expect, vi, beforeEach } from "vitest";

// A stand-in for Supabase: serves rows per table, honoring order and page
// ranges, and records every save.
const db = {};
const calls = [];
let failTable = null;
let rpcResult = { data: 8, error: null };
function builder(table) {
  const orders = [];
  const rows = () => [...(db[table] || [])].sort((a, b) => {
    for (const c of orders) { if (a[c] < b[c]) return -1; if (a[c] > b[c]) return 1; }
    return 0;
  });
  const b = {
    select() { return b; },
    order(col) { orders.push(col); return b; },
    range(from, to) {
      calls.push(`${table} ${from}-${to}`);
      if (failTable === table) return Promise.resolve({ data: null, error: new Error(`${table} failed`) });
      return Promise.resolve({ data: rows().slice(from, to + 1), error: null });
    },
    maybeSingle() {
      if (failTable === table) return Promise.resolve({ data: null, error: new Error(`${table} failed`) });
      return Promise.resolve({ data: rows()[0] ?? null, error: null });
    },
  };
  return b;
}
vi.mock("../../supabaseClient.js", () => ({
  supabase: { from: (t) => builder(t), rpc: (name, args) => { calls.push({ name, args }); return Promise.resolve(rpcResult); } },
}));
const store = await import("../../ledgerStore.js");
const { accountToRow, categoryToRow, groupToRow, transactionToRow, loadLedger, fetchLedgerVersion, computeLedgerChanges, hasChanges, saveLedgerChanges } = store;

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  calls.length = 0; failTable = null; rpcResult = { data: 8, error: null };
});

describe("app items -> database rows", () => {
  it("accounts, categories, and groups keep their extra settings in props and their position", () => {
    expect(accountToRow({ id: "a", name: "Checking", dateCol: "Date" }, 2)).toEqual({ id: "a", name: "Checking", sort_order: 2, props: { dateCol: "Date" } });
    expect(categoryToRow({ id: "c", name: "Fund", isIncome: 1, budgetAmount: 5 }, 0))
      .toEqual({ id: "c", name: "Fund", excluded: false, is_income: true, sort_order: 0, props: { budgetAmount: 5 } });
    expect(groupToRow({ id: "g", categoryIds: ["c"], budgetAmount: 1 }, 1))
      .toEqual({ id: "g", name: "", sort_order: 1, category_ids: ["c"], props: { budgetAmount: 1 } });
    expect(groupToRow({ id: "g", name: "G" }, 0).category_ids).toEqual([]);
    expect(accountToRow({ id: "a" }, 0).name).toBe("");
    expect(categoryToRow({ id: "c" }, 0).name).toBe("");
  });
  it("transactions: account name isn't stored (it comes from the account), blanks become null", () => {
    expect(transactionToRow({ id: "t", accountId: "a", accountName: "Checking", date: "2026-09-05", description: "x",
      amountOut: 5, notDuplicate: true })).toEqual({
      id: "t", account_id: "a", category_id: null, date: "2026-09-05", description: "x", amount_out: 5, amount_in: null,
      upload_batch_id: null, uploaded_at: null, raw: null, props: { notDuplicate: true } });
    expect(transactionToRow({ id: "t", accountId: "a" })).toMatchObject({ date: null, description: "" });
  });
});

describe("loadLedger", () => {
  it("rebuilds the app's data from rows: order, group members, account names, exact amounts, settings", async () => {
    db.accounts = [{ id: "a2", name: "Card", sort_order: 1, props: {} }, { id: "a1", name: "Checking", sort_order: 0, props: { dateCol: "Date" } }];
    db.categories = [{ id: "c1", name: "Groceries", excluded: false, is_income: false, sort_order: 0, props: { budgetAmount: 240 } }];
    db.budget_groups = [{ id: "g1", name: "Food", sort_order: 0, props: {} }, { id: "g2", name: "Empty", sort_order: 1, props: {} }];
    db.budget_group_categories = [{ group_id: "g1", category_id: "c2", position: 2 }, { group_id: "g1", category_id: "c1", position: 1 }];
    db.transactions = [
      { id: "t1", account_id: "a1", category_id: "c1", date: "2026-09-05", description: "Grocer", amount_out: "24.23", amount_in: null,
        upload_batch_id: "b1", uploaded_at: "2026-09-05T10:00:00Z", raw: { Date: "9/5" }, props: { notDuplicate: true } },
      { id: "t2", account_id: "gone", category_id: null, date: "2026-09-06", description: "Orphan", amount_out: null, amount_in: 10,
        upload_batch_id: null, uploaded_at: null, raw: null, props: {} },
    ];
    db.household_settings = [{ props: { plannedIncome: 2700 } }];
    db.households = [{ data_version: 7 }];
    const { data, settingsSaved, version } = await loadLedger();
    expect(data.accounts.map((a) => a.name)).toEqual(["Checking", "Card"]);
    expect(data.accounts[0]).toEqual({ dateCol: "Date", id: "a1", name: "Checking" });
    expect(data.categories[0]).toEqual({ budgetAmount: 240, id: "c1", name: "Groceries", excluded: false, isIncome: false });
    expect(data.budgetGroups.map((g) => g.categoryIds)).toEqual([["c1", "c2"], []]);
    expect(data.transactions[0]).toEqual({ notDuplicate: true, id: "t1", accountId: "a1", accountName: "Checking", categoryId: "c1",
      date: "2026-09-05", description: "Grocer", amountOut: 24.23, amountIn: null, raw: { Date: "9/5" }, uploadBatchId: "b1",
      uploadedAt: "2026-09-05T10:00:00Z" });
    expect(data.transactions[1]).toMatchObject({ accountName: "", amountOut: null, amountIn: 10 });
    expect(data.transactions[1]).not.toHaveProperty("uploadBatchId");
    expect(data.plannedIncome).toBe(2700);
    expect(settingsSaved).toBe(true);
    expect(version).toBe(7);
  });
  it("fetches large tables in pages of 1,000 until everything has arrived", async () => {
    db.transactions = Array.from({ length: 2500 }, (_, i) => ({ id: `t${String(i).padStart(5, "0")}`, account_id: "a", date: "2026-01-01",
      description: "", amount_out: 1, amount_in: null, upload_batch_id: null, uploaded_at: null, raw: null, props: {} }));
    const { data } = await loadLedger();
    expect(data.transactions).toHaveLength(2500);
    expect(calls.filter((c) => typeof c === "string" && c.startsWith("transactions"))).toEqual(
      ["transactions 0-999", "transactions 1000-1999", "transactions 2000-2999"]);
  });
  it("a household with no settings row and no version is treated as never saved", async () => {
    const r = await loadLedger();
    expect(r.settingsSaved).toBe(false);
    expect(r.version).toBeNull();
  });
  it("any failed query fails the whole load", async () => {
    for (const t of ["transactions", "household_settings", "households"]) {
      failTable = t;
      await expect(loadLedger()).rejects.toThrow(`${t} failed`);
    }
  });
});

describe("fetchLedgerVersion", () => {
  it("reads just the change counter", async () => {
    db.households = [{ data_version: 12 }];
    expect(await fetchLedgerVersion()).toBe(12);
    delete db.households;
    expect(await fetchLedgerVersion()).toBeNull();
    failTable = "households";
    await expect(fetchLedgerVersion()).rejects.toThrow();
  });
});

describe("computeLedgerChanges", () => {
  const base = {
    accounts: [{ id: "a1", name: "Checking" }],
    categories: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }, { id: "c3", name: "C" }],
    budgetGroups: [{ id: "g1", name: "G", categoryIds: ["c1"] }],
    transactions: [{ id: "t1", accountId: "a1", amountOut: 5 }, { id: "t2", accountId: "a1", amountOut: 6 }],
    plannedIncome: 100, incomeWarningDismissed: false, hiddenBudgetMonths: [], excludeUnassignedFromBudget: false,
    settingsSaved: true,
  };
  it("nothing changed -> nothing to send", () => {
    const c = computeLedgerChanges(base, { ...base });
    expect(c).toEqual({});
    expect(hasChanges(c)).toBe(false);
  });
  it("an edited copy with identical content isn't sent (and undefined fields don't count)", () => {
    const next = { ...base, transactions: [{ ...base.transactions[0], extra: undefined }, base.transactions[1]] };
    expect(computeLedgerChanges(base, next)).toEqual({});
  });
  it("sends only changed, added, and removed rows", () => {
    const next = { ...base,
      transactions: [{ ...base.transactions[0], categoryId: "c1" }, { id: "t3", accountId: "a1", amountIn: 1 }],
      budgetGroups: [{ ...base.budgetGroups[0], categoryIds: [] }] };
    const c = computeLedgerChanges(base, next);
    expect(c.upserts.transactions.map((r) => r.id)).toEqual(["t1", "t3"]);
    expect(c.upserts.budget_groups[0].category_ids).toEqual([]);
    expect(c.deletes).toEqual({ transactions: ["t2"] });
    expect(c.upserts.categories).toBeUndefined();
    expect(c.settings).toBeUndefined();
    expect(hasChanges(c)).toBe(true);
  });
  it("moving an item resends it with its new position", () => {
    const next = { ...base, categories: [base.categories[1], base.categories[0], base.categories[2]] };
    const c = computeLedgerChanges(base, next);
    expect(c.upserts.categories.map((r) => [r.id, r.sort_order])).toEqual([["c2", 0], ["c1", 1]]);
  });
  it("sends settings when they change, or when they've never been saved", () => {
    expect(computeLedgerChanges(base, { ...base, plannedIncome: 200 }).settings.props.plannedIncome).toBe(200);
    expect(computeLedgerChanges({ ...base, settingsSaved: false }, base).settings).toBeTruthy();
  });
  it("handles missing lists on either side", () => {
    const c = computeLedgerChanges({ settingsSaved: true }, { accounts: [{ id: "a" }] });
    expect(c.upserts.accounts.map((r) => r.id)).toEqual(["a"]);
  });
  it("detects nested content changes, like a changed list inside an item", () => {
    const b = { ...base, categories: [{ id: "c1", name: "A", fundAdjustments: [{ amount: 1 }] }] };
    const same = { ...b, categories: [{ id: "c1", name: "A", fundAdjustments: [{ amount: 1 }] }] };
    const diff = { ...b, categories: [{ id: "c1", name: "A", fundAdjustments: [{ amount: 2 }] }] };
    const shape = { ...b, categories: [{ id: "c1", name: "A", fundAdjustments: { amount: 1 } }] };
    expect(computeLedgerChanges(b, same)).toEqual({});
    expect(computeLedgerChanges(b, diff).upserts.categories).toHaveLength(1);
    expect(computeLedgerChanges(b, shape).upserts.categories).toHaveLength(1);
    const nulls = { ...b, categories: [{ id: "c1", name: "A", fundAdjustments: null }] };
    expect(computeLedgerChanges(b, nulls).upserts.categories).toHaveLength(1);
    const extraKey = { ...b, categories: [{ id: "c1", name: "A", fundAdjustments: [{ amount: 1 }], note: "x" }] };
    expect(computeLedgerChanges(b, extraKey).upserts.categories).toHaveLength(1);
    const renamedKey = { ...b, categories: [{ id: "c1", name: "A", fundAdjustmentz: [{ amount: 1 }] }] };
    expect(computeLedgerChanges(b, renamedKey).upserts.categories).toHaveLength(1);
  });
});

describe("saveLedgerChanges", () => {
  it("sends the changes to the database's save function and returns the new change counter", async () => {
    expect(await saveLedgerChanges({ upserts: { accounts: [] } })).toBe(8);
    expect(calls.at(-1)).toEqual({ name: "apply_ledger_changes", args: { p_changes: { upserts: { accounts: [] } } } });
  });
  it("reports a failed save", async () => {
    rpcResult = { data: null, error: new Error("network down") };
    await expect(saveLedgerChanges({})).rejects.toThrow("network down");
  });
});
