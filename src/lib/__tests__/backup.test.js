import { describe, it, expect, vi } from "vitest";
import Papa from "papaparse";
import {
  protectCsvCell, unprotectCsvCell, protectCsvRows, unprotectCsvRows, BACKUP_COLUMNS, BUDGET_BACKUP_COLUMNS,
  buildBackupCSV, buildFromBackupRows, buildBudgetCSV, buildBudgetFromRows, downloadCSV, exportBackupCSV, exportBudgetCSV,
} from "../backup.js";

const parse = (csv) => Papa.parse(csv, { header: true, skipEmptyLines: true }).data;

describe("formula-injection protection", () => {
  it("defuses cells a spreadsheet would run as a formula", () => {
    for (const v of ["=HYPERLINK(\"x\")", "+cmd", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(protectCsvCell(v)).toBe("'" + v);
    }
  });
  it("leaves ordinary text, numbers, and blanks alone", () => {
    for (const v of ["Thrifty Sprout", "-50", "1,100.00", "+12.5", "2026-09-05", "'Twas", ""]) expect(protectCsvCell(v)).toBe(v);
    expect(protectCsvCell(-50)).toBe(-50);
    expect(protectCsvCell(null)).toBe(null);
  });
  it("restoring removes exactly one protective apostrophe", () => {
    for (const v of ["=a", "'=a", "''=a", "'Twas", "plain", -5]) {
      expect(unprotectCsvCell(protectCsvCell(v))).toBe(v);
    }
  });
  it("works on whole rows", () => {
    const rows = [{ A: "=x", B: 5 }];
    expect(unprotectCsvRows(protectCsvRows(rows))).toEqual(rows);
  });
});

const accounts = [{ id: "a1", name: "Checking" }, { id: "a2", name: "Card" }];
const categories = [
  { id: "c1", name: "Groceries", excluded: false, isIncome: false },
  { id: "c2", name: "Paycheck", isIncome: true },
  { id: "c3", name: "Transfers", excluded: true },
];
const transactions = [
  { id: "t2", accountName: "Card", date: "2026-09-06", description: "=HYPERLINK(\"http://evil\")", amountOut: 5, amountIn: null, categoryId: null },
  { id: "t1", accountName: "Checking", date: "2026-09-05", description: "Thrifty Sprout", amountOut: 24.23, amountIn: null,
    categoryId: "c1", uploadedAt: "2026-09-05T10:00:00.000Z", uploadBatchId: "b1", notDuplicate: true, budgetPeriodOverride: "2026-10-01" },
  { id: "t3", accountName: "Checking", date: "2026-09-07", description: "Payroll", amountOut: null, amountIn: 1355.13, categoryId: "c2" },
  { id: "t4", accountName: "Checking", date: "2026-09-07", description: "To savings", amountOut: 65.87, amountIn: null, categoryId: "c3" },
];

describe("ledger backup", () => {
  const csv = buildBackupCSV(accounts, transactions, categories);
  const rows = parse(csv);
  it("has the documented columns, in order, sorted by date", () => {
    expect(Object.keys(rows[0])).toEqual(BACKUP_COLUMNS);
    expect(rows.map((r) => r.Date)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-07"]);
  });
  it("records category flags and upload details", () => {
    expect(rows[0]).toMatchObject({ Category: "Groceries", "Category Excluded": "No", "Category Income": "No",
      "Uploaded At": "2026-09-05T10:00:00.000Z", "Upload Batch": "b1", "Not A Duplicate": "Yes", "Counts Toward Period": "2026-10-01" });
    expect(rows[2]).toMatchObject({ Category: "Paycheck", "Category Income": "Yes" });
    expect(rows[3]).toMatchObject({ "Category Excluded": "Yes" });
    expect(rows[1]).toMatchObject({ Category: "", "Category Excluded": "", "Not A Duplicate": "No" });
  });
  it("the formula-looking description is written defused", () => {
    expect(rows[1].Description).toBe("'=HYPERLINK(\"http://evil\")");
  });
  it("restoring rebuilds accounts, categories, and transactions exactly", () => {
    const r = buildFromBackupRows(rows);
    expect(r.invalid).toEqual([]);
    expect(r.accounts.map((a) => a.name)).toEqual(["Checking", "Card"]);
    expect(r.categories.map((c) => [c.name, c.excluded, c.isIncome])).toEqual([
      ["Groceries", false, false], ["Paycheck", false, true], ["Transfers", true, false]]);
    const t1 = r.transactions[0];
    expect(t1).toMatchObject({ accountName: "Checking", date: "2026-09-05", description: "Thrifty Sprout", amountOut: 24.23,
      amountIn: null, uploadedAt: "2026-09-05T10:00:00.000Z", uploadBatchId: "b1", notDuplicate: true, budgetPeriodOverride: "2026-10-01" });
    expect(r.categories.find((c) => c.id === t1.categoryId).name).toBe("Groceries");
    expect(r.transactions[1].description).toBe("=HYPERLINK(\"http://evil\")"); // protection removed on restore
    expect(r.transactions[1]).toMatchObject({ categoryId: null, notDuplicate: false, uploadedAt: undefined });
    expect(r.transactions[2]).toMatchObject({ amountOut: null, amountIn: 1355.13 });
    expect(r.transactions.every((t) => t.raw === null)).toBe(true); // no bank row to keep from a backup
  });
  it("rejects bad rows with reasons, keeping the good ones", () => {
    const r = buildFromBackupRows([
      { Account: "", Date: "2026-09-05", "Money Out": "1" },
      { Account: "X", Date: "garbage", "Money Out": "1" },
      { Account: "X", Date: "2026-09-05", "Money Out": "abc", "Money In": "def" },
      { Account: "X", Date: "2026-09-05", "Money Out": "", "Money In": "0" },
      { Account: "X", Date: "2026-09-05", "Money Out": "-3" },
    ]);
    expect(r.invalid.map((i) => i.reasons)).toEqual([
      ["missing account name"], ["unrecognized date"], ["unrecognized money-out value", "unrecognized money-in value"],
      ["no amount in either column"]]);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].amountOut).toBe(3);
  });
});

describe("budget backup", () => {
  const cats = [
    { id: "c1", name: "Groceries", budgetAmount: 240, budgetPeriod: "monthly", budgetType: "spend" },
    { id: "c2", name: "=Fund", budgetAmount: 170, budgetType: "accumulate", accumulateTarget: 1800,
      accumulateActuals: { "2026-06-01": 86 }, fundAdjustments: [{ date: "2026-07-01", amount: -20 }] },
    { id: "c3", name: "Utilities" },
    { id: "c4", name: "Weekly Fun", budgetAmount: 20, budgetPeriod: "weekly" },
  ];
  const groups = [{ id: "g1", name: "Overhead", budgetAmount: 220, budgetPeriod: "monthly", categoryIds: ["c3", "gone"],
    accumulateActuals: { "2026-05-01": 1 }, fundAdjustments: [{ date: "2026-05-02", amount: 2 }] },
    { id: "g2", name: "Unbudgeted group", categoryIds: [] }];
  const rows = parse(buildBudgetCSV(cats, groups, 2700));
  it("has the documented columns and one row per setting, category, group, override, and adjustment", () => {
    expect(Object.keys(rows[0])).toEqual(BUDGET_BACKUP_COLUMNS);
    expect(rows.map((r) => r["Row Type"])).toEqual([
      "Settings", "Category", "Category", "Category", "Category", "Group", "Group", "Override", "FundAdjustment", "Override", "FundAdjustment"]);
    expect(rows[3]).toMatchObject({ Name: "Utilities", Group: "Overhead", "Budget Amount": "", "Budget Period": "" });
    expect(rows[5]).toMatchObject({ Members: "Utilities" }); // a category that no longer exists is left out
    expect(rows[6]).toMatchObject({ "Budget Type": "" });
  });
  it("restoring onto an empty setup recreates everything", () => {
    const r = buildBudgetFromRows(rows, [], []);
    expect(r.invalid).toEqual([]);
    expect(r.plannedIncome).toBe(2700);
    expect(r.categoryCount).toBe(4);
    expect(r.groupCount).toBe(2);
    const fund = r.categories.find((c) => c.name === "=Fund");
    expect(fund).toMatchObject({ budgetAmount: 170, budgetType: "accumulate", accumulateTarget: 1800,
      accumulateActuals: { "2026-06-01": 86 }, fundAdjustments: [{ date: "2026-07-01", amount: -20 }] });
    expect(r.categories.find((c) => c.name === "Weekly Fun").budgetPeriod).toBe("weekly");
    const g = r.budgetGroups.find((x) => x.name === "Overhead");
    expect(g.categoryIds).toEqual([r.categories.find((c) => c.name === "Utilities").id]);
    expect(g.fundAdjustments).toEqual([{ date: "2026-05-02", amount: 2 }]);
  });
  it("restoring onto an existing setup updates by name, keeping ids and anything not in the file", () => {
    const existing = [{ id: "keep", name: "Groceries", budgetAmount: 1 }, { id: "other", name: "Not in file" }];
    const existingGroups = [{ id: "gkeep", name: "Overhead", categoryIds: [] }, { id: "gother", name: "Mine" }];
    const r = buildBudgetFromRows(rows, existing, existingGroups);
    expect(r.categories.find((c) => c.id === "keep").budgetAmount).toBe(240);
    expect(r.categories.find((c) => c.id === "other")).toEqual(existing[1]);
    expect(r.budgetGroups.find((g) => g.id === "gkeep").budgetAmount).toBe(220);
    expect(r.budgetGroups.find((g) => g.id === "gother")).toEqual(existingGroups[1]);
  });
  it("normalizes a month written as YYYY-MM (the old duplicate-month bug)", () => {
    const r = buildBudgetFromRows([
      { "Row Type": "Category", Name: "Fund", "Budget Amount": "10", "Budget Type": "Accumulate" },
      { "Row Type": "Override", "Item Type": "Category", Name: "Fund", Period: "2026-06", Amount: "86" },
      { "Row Type": "Override", "Item Type": "Group", Name: "G", Period: "2026-07-01", Amount: "5" },
      { "Row Type": "Group", Name: "G", "Budget Amount": "" },
    ], [], []);
    expect(r.categories[0].accumulateActuals).toEqual({ "2026-06-01": 86 });
    expect(r.budgetGroups[0].accumulateActuals).toEqual({ "2026-07-01": 5 });
  });
  it("reports unusable rows and skips blank ones", () => {
    const r = buildBudgetFromRows([
      { "Row Type": "" },
      { "Row Type": "Category", Name: "" },
      { "Row Type": "Group", Name: "" },
      { "Row Type": "Override", Name: "X" },
      { "Row Type": "FundAdjustment", Name: "X" },
      { "Row Type": "Mystery" },
      { "Row Type": "Settings", Amount: "abc" },
    ], [], []);
    expect(r.invalid.map((i) => i.reasons[0])).toEqual([
      "missing category name", "missing group name", "incomplete override row", "incomplete fund adjustment row", "unrecognized row type \"Mystery\""]);
    expect(r.plannedIncome).toBeNull();
  });
});

describe("downloading", () => {
  it("hands the browser a named CSV file and cleans up afterward", () => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadCSV("a,b", "file.csv");
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0].download).toBe("file.csv");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    exportBackupCSV(accounts, transactions, categories);
    exportBudgetCSV(categories, [], null);
    expect(click.mock.contexts[1].download).toMatch(/^ledger-backup-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(click.mock.contexts[2].download).toMatch(/^budget-backup-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(document.querySelectorAll("a").length).toBe(0);
  });
});

import { buildFullBackup, readFullBackup, FULL_BACKUP_FORMAT, FULL_BACKUP_VERSION } from "../backup.js";
import { normalizeLoadedLedger } from "../ledgerData.js";
describe("complete backups", () => {
  const ledger = {
    accounts: [{ id: "a1", name: "Checking", dateCol: "Date", idCol: "Ref", startingBalance: { amount: 2400, date: "2026-06-01", owed: false } }],
    categories: [{ id: "c1", name: "Groceries", budgetAmount: 500 }, { id: "x", name: "Transfers", excluded: true }],
    budgetGroups: [{ id: "g1", name: "Food", categoryIds: ["c1"] }],
    transactions: [
      { id: "t1", accountId: "a1", accountName: "Checking", date: "2026-09-02", description: "Market", amountOut: 80, amountIn: null, categoryId: null,
        splits: [{ categoryId: "c1", amount: 50 }, { categoryId: "x", amount: 30 }], externalId: "FIT1", comments: [{ id: "k1", text: "Party food", authorId: "u1", at: "2026-09-02T20:00:00Z" }] },
      { id: "t2", accountId: "a1", accountName: "Checking", date: "2026-09-03", description: "Market", amountOut: 80, amountIn: null, categoryId: null, skippedDuplicateOf: "t1" },
      { id: "t3", accountId: "a1", accountName: "Checking", date: "2026-09-04", description: "To savings", amountOut: 100, amountIn: null, categoryId: "x", transferWith: "t4" },
      { id: "t4", accountId: "a1", accountName: "Checking", date: "2026-09-04", description: "From checking", amountOut: null, amountIn: 100, categoryId: "x", transferWith: "t3", categorySuggested: true },
    ],
    plannedIncome: 5000, autoApplySuggestions: false, duplicateHandling: "flag", hiddenRecurring: ["out|gym"], hiddenBudgetMonths: ["2026-06"],
  };
  it("carries everything, and restores it exactly", () => {
    const file = buildFullBackup(ledger, "2026-09-28T12:00:00Z");
    expect(file).toMatchObject({ format: FULL_BACKUP_FORMAT, version: FULL_BACKUP_VERSION, exportedAt: "2026-09-28T12:00:00Z" });
    expect(JSON.stringify(file)).not.toMatch(/accountName/); // names come from the accounts
    const { ledger: restored, summary, exportedAt } = readFullBackup(JSON.stringify(file));
    expect(exportedAt).toBe("2026-09-28T12:00:00Z");
    expect(restored.transactions).toEqual(ledger.transactions);
    expect(restored.accounts).toEqual(ledger.accounts);
    const settled = normalizeLoadedLedger(restored);
    expect([settled.plannedIncome, settled.autoApplySuggestions, settled.duplicateHandling, settled.hiddenRecurring, settled.hiddenBudgetMonths]).toEqual([5000, false, "flag", ["out|gym"], ["2026-06"]]);
    expect(summary).toEqual({ accounts: 1, transactions: 3, categories: 2, budgetGroups: 1, splits: 1, transferPairs: 1, comments: 1, skippedDuplicates: 1, trackedBalances: 1 });
  });
  it("refuses files that aren't complete backups, or come from a newer version", () => {
    expect(() => readFullBackup("Date,Description\n1,2")).toThrow(/isn't a Coinrose complete backup/);
    expect(() => readFullBackup(JSON.stringify({ format: "something-else" }))).toThrow(/isn't a Coinrose complete backup/);
    expect(() => readFullBackup(JSON.stringify({ format: FULL_BACKUP_FORMAT, version: FULL_BACKUP_VERSION + 1, data: {} }))).toThrow(/newer version of Coinrose/);
  });
  it("skips damaged entries instead of failing, and fills in what's missing", () => {
    const { ledger: l } = readFullBackup(JSON.stringify({ format: FULL_BACKUP_FORMAT, version: 1, data: {
      accounts: [{ id: "a1", name: "Checking" }, null, { name: "no id" }],
      transactions: [{ id: "t1", accountId: "a1", date: "2026-09-01" }, { id: "t2" }, "junk"],
      categories: "not a list",
    } }));
    expect(l.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(l.transactions).toEqual([{ id: "t1", accountId: "a1", date: "2026-09-01", accountName: "Checking" }]);
    expect(l.categories).toEqual([]);
    expect(l.budgetGroups).toEqual([]);
  });
});
