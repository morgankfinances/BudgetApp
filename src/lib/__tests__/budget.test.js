import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeBudgetPeriodData, flagForBudgetItem, budgetPerformance, computeFundBalance,
  computeAccumulateContributionTotal, computeItemFundBalance, getUnassignedCategoryIds, buildBudgetItems,
} from "../budget.js";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-25T12:00:00Z")); });
afterEach(() => vi.useRealTimers());

const categories = [
  { id: "groc", name: "Groceries", budgetAmount: 240, budgetPeriod: "monthly" },
  { id: "dine", name: "Dining Out", budgetAmount: 50, budgetPeriod: "monthly" },
  { id: "rent", name: "Rent" },                                          // no budget
  { id: "pay", name: "Paycheck", isIncome: true },
  { id: "xfer", name: "Transfers", excluded: true },
  { id: "util", name: "Utilities" },
  { id: "fund", name: "Supplies Fund", budgetAmount: 170, budgetPeriod: "monthly", budgetType: "accumulate",
    createdAt: "2026-07-10", accumulateActuals: { "2026-08-01": 210 } },
];
const groups = [{ id: "g1", name: "Household Overhead", budgetAmount: 220, budgetPeriod: "monthly", categoryIds: ["util"] }];

describe("buildBudgetItems", () => {
  const items = buildBudgetItems(categories, groups);
  it("makes one item per group and one per category not in a group", () => {
    expect(items.map((i) => i.id)).toEqual([
      "group:g1", "cat:groc", "cat:dine", "cat:rent", "cat:pay", "cat:xfer", "cat:fund"]);
  });
  it("a group covers its categories; a category covers itself", () => {
    expect([...items[0].categoryIds]).toEqual(["util"]);
    expect(items[0].isGroup).toBe(true);
    expect([...items[1].categoryIds]).toEqual(["groc"]);
  });
  it("defaults to a spend budget", () => {
    expect(items.find((i) => i.id === "cat:groc").budgetType).toBe("spend");
    expect(items.find((i) => i.id === "cat:fund").budgetType).toBe("accumulate");
  });
  it("handles groups with no category list and missing settings", () => {
    const [g] = buildBudgetItems([], [{ id: "g", name: "Empty" }]);
    expect([...g.categoryIds]).toEqual([]);
    expect(g.budgetType).toBe("spend");
    expect(g.accumulateActuals).toEqual({});
  });
});

describe("getUnassignedCategoryIds", () => {
  it("returns only spending categories with no budget of their own and no budgeted group", () => {
    expect([...getUnassignedCategoryIds(categories, groups)]).toEqual(["rent"]);
  });
  it("a group with no budget doesn't count as covering its categories", () => {
    const unbudgeted = [{ ...groups[0], budgetAmount: 0 }];
    expect([...getUnassignedCategoryIds(categories, unbudgeted)].sort()).toEqual(["rent", "util"]);
    expect([...getUnassignedCategoryIds(categories, [{ id: "g", budgetAmount: 10 }])].sort()).toEqual(["rent", "util"]);
  });
});

describe("computeBudgetPeriodData", () => {
  const tx = [
    { categoryId: "groc", date: "2026-09-03", amountOut: 100 },
    { categoryId: "groc", date: "2026-09-10", amountOut: 60, amountIn: null },
    { categoryId: "groc", date: "2026-09-12", amountIn: 10 },                     // refund lowers spending
    { categoryId: "groc", date: "2026-08-20", amountOut: 30 },
    { categoryId: "dine", date: "2026-08-31", amountOut: 45, budgetPeriodOverride: "2026-09-01" }, // counts toward September
    { categoryId: "util", date: "2026-09-06", amountOut: 150 },
    { categoryId: null, date: "2026-09-06", amountOut: 999 },                    // uncategorized: ignored
    { categoryId: "groc", date: null, amountOut: 999 },                          // no date: ignored
  ];
  const data = computeBudgetPeriodData(tx, buildBudgetItems(categories, groups), "monthly");

  it("includes only items budgeted on this cadence", () => {
    expect(data.budgeted.map((b) => b.id).sort()).toEqual(["cat:dine", "cat:fund", "cat:groc", "group:g1"]);
  });
  it("totals net spending per item per month, including refunds", () => {
    expect(data.spendMap["cat:groc"]).toEqual({ "2026-09-01": 150, "2026-08-01": 30 });
    expect(data.spendMap["group:g1"]).toEqual({ "2026-09-01": 150 });
  });
  it("honors a transaction's 'counts toward' period override", () => {
    expect(data.spendMap["cat:dine"]).toEqual({ "2026-09-01": 45 });
  });
  it("accumulate items get the planned amount each month since they started, unless overridden", () => {
    expect(data.spendMap["cat:fund"]).toEqual({ "2026-07-01": 170, "2026-08-01": 210, "2026-09-01": 170 });
  });
  it("lists periods in order, each month once, ending with the current month", () => {
    expect(data.periods).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(data.currentKey).toBe("2026-09-01");
  });
  it("regression: an override dated with the full month key doesn't create a duplicate month", () => {
    const d = computeBudgetPeriodData([], buildBudgetItems(
      [{ id: "f", budgetAmount: 10, budgetType: "accumulate", createdAt: "2026-09-01", accumulateActuals: { "2026-09-01": 5 } }], []), "monthly");
    expect(d.periods).toEqual(["2026-09-01"]);
    expect(d.spendMap["cat:f"]).toEqual({ "2026-09-01": 5 });
  });
  it("an override for a month before the start date still appears", () => {
    const d = computeBudgetPeriodData([], buildBudgetItems(
      [{ id: "f", budgetAmount: 10, budgetType: "accumulate", createdAt: "2026-09-01", accumulateActuals: { "2026-06-01": 7 } }], []), "monthly");
    expect(d.spendMap["cat:f"]).toEqual({ "2026-09-01": 10, "2026-06-01": 7 });
  });
  it("an accumulate item with no start date only covers the current month", () => {
    const d = computeBudgetPeriodData([], buildBudgetItems([{ id: "f", budgetAmount: 10, budgetType: "accumulate" }], []), "monthly");
    expect(d.spendMap["cat:f"]).toEqual({ "2026-09-01": 10 });
  });
  it("works weekly, and returns nothing when no item uses that cadence", () => {
    const weekly = [{ id: "w", budgetAmount: 50, budgetPeriod: "weekly" }];
    const d = computeBudgetPeriodData([{ categoryId: "w", date: "2026-09-24", amountOut: 20 }], buildBudgetItems(weekly, []), "weekly");
    expect(d.spendMap["cat:w"]).toEqual({ "2026-09-20": 20 });
    expect(computeBudgetPeriodData([], buildBudgetItems(weekly, []), "monthly")).toBeNull();
  });
  it("the Unassigned pseudo-item is included even with no budget amount", () => {
    const pseudo = { id: "unassigned", isUnassignedPseudo: true, budgetPeriod: "monthly", categoryIds: new Set(["rent"]) };
    const d = computeBudgetPeriodData([{ categoryId: "rent", date: "2026-09-01", amountOut: 1100 }], [pseudo], "monthly");
    expect(d.spendMap.unassigned).toEqual({ "2026-09-01": 1100 });
  });
});

describe("flagForBudgetItem (Overview's 'needs attention')", () => {
  const spend = { budgetAmount: 100 };
  it("spend budgets: ok under 80%, warn from 80%, bad from 100%", () => {
    expect(flagForBudgetItem(spend, 79)).toBe("ok");
    expect(flagForBudgetItem(spend, 80)).toBe("warn");
    expect(flagForBudgetItem(spend, 100)).toBe("bad");
  });
  it("accumulate budgets are the reverse: behind is bad, on track is ok", () => {
    const acc = { budgetAmount: 100, budgetType: "accumulate" };
    expect(flagForBudgetItem(acc, 50)).toBe("bad");
    expect(flagForBudgetItem(acc, 85)).toBe("warn");
    expect(flagForBudgetItem(acc, 100)).toBe("ok");
  });
  it("no budget is never flagged", () => expect(flagForBudgetItem({ budgetAmount: 0 }, 500)).toBe("ok"));
});

describe("budgetPerformance", () => {
  it("spend: positive when under budget; accumulate: positive when ahead", () => {
    expect(budgetPerformance({ budgetAmount: 240 }, 200)).toBe(40);
    expect(budgetPerformance({ budgetAmount: 170, budgetType: "accumulate" }, 210)).toBe(40);
    expect(budgetPerformance({}, 10)).toBe(-10);
  });
});

describe("fund balances", () => {
  const item = { budgetAmount: 170, budgetPeriod: "monthly", budgetType: "accumulate", createdAt: "2026-07-10",
                 accumulateActuals: { "2026-08-01": 210 }, fundAdjustments: [{ amount: 25 }, { amount: -5 }, {}] };
  it("contributions total every month since the start, using overrides where set", () => {
    expect(computeAccumulateContributionTotal(item)).toBe(170 + 210 + 170);
  });
  it("includes override months outside the normal range", () => {
    expect(computeAccumulateContributionTotal({ ...item, accumulateActuals: { "2026-01-01": 5 } })).toBe(170 * 3 + 5);
  });
  it("defaults to weekly/monthly correctly and starts this period without a start date", () => {
    expect(computeAccumulateContributionTotal({ budgetAmount: 10, budgetType: "accumulate", budgetPeriod: "weekly" })).toBe(10);
    expect(computeAccumulateContributionTotal({ budgetAmount: 10, budgetType: "accumulate" })).toBe(10);
  });
  it("non-accumulate or unfunded items contribute nothing", () => {
    expect(computeAccumulateContributionTotal({ budgetAmount: 100 })).toBe(0);
    expect(computeAccumulateContributionTotal({ budgetType: "accumulate" })).toBe(0);
  });
  it("balance = contributions - net spending from the fund's categories + manual adjustments", () => {
    const tx = [
      { categoryId: "fund", amountOut: 100 },
      { categoryId: "fund", amountIn: 30 },   // returned purchase goes back in
      { categoryId: "other", amountOut: 999 },
      { categoryId: null, amountOut: 999 },
    ];
    const r = computeFundBalance({ ...item, categoryIds: new Set(["fund"]) }, 550, tx);
    expect(r).toEqual({ balance: 550 - 70 + 20, contributed: 550, withdrawn: 70, adjusted: 20 });
    expect(computeFundBalance({}, 5, tx).balance).toBe(5);
  });
  it("computeItemFundBalance combines both", () => {
    expect(computeItemFundBalance(item, new Set(["fund"]), [{ categoryId: "fund", amountOut: 50 }])).toBe(550 - 50 + 20);
  });
});
