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
