// Shared sample data for screen tests: a small household with a few months
// of activity, budgets, a group, and an accumulate fund.
export const accounts = [
  { id: "acct-chk", name: "Millbrook Checking", dateCol: "Date", descriptionCol: "Description", outCol: "Money Out", inCol: "Money In", invertSign: false },
  { id: "acct-card", name: "Griffon Card", dateCol: "Date", descriptionCol: "Description", outCol: "Amount", inCol: "Amount", invertSign: true },
];
export const categories = [
  { id: "cat-groc", name: "Groceries", excluded: false, isIncome: false, budgetAmount: 240, budgetPeriod: "monthly", budgetType: "spend", accumulateActuals: {}, fundAdjustments: [] },
  { id: "cat-dine", name: "Dining Out", excluded: false, isIncome: false, budgetAmount: 50, budgetPeriod: "monthly", budgetType: "spend", accumulateActuals: {}, fundAdjustments: [] },
  { id: "cat-rent", name: "Rent", excluded: false, isIncome: false, budgetType: "spend", accumulateActuals: {}, fundAdjustments: [] },
  { id: "cat-util", name: "Utilities", excluded: false, isIncome: false, budgetType: "spend", accumulateActuals: {}, fundAdjustments: [] },
  { id: "cat-pay", name: "Paycheck", excluded: false, isIncome: true, budgetType: "spend", accumulateActuals: {}, fundAdjustments: [] },
  { id: "cat-xfer", name: "Transfers", excluded: true, isIncome: false, budgetType: "spend", accumulateActuals: {}, fundAdjustments: [] },
  { id: "cat-fund", name: "Supplies Fund", excluded: false, isIncome: false, budgetAmount: 170, budgetPeriod: "monthly", budgetType: "accumulate",
    accumulateTarget: 1800, createdAt: "2026-07-01", accumulateActuals: {}, fundAdjustments: [] },
];
export const budgetGroups = [
  { id: "grp-home", name: "Household Overhead", budgetAmount: 220, budgetPeriod: "monthly", budgetType: "spend", categoryIds: ["cat-util"], accumulateActuals: {}, fundAdjustments: [] },
];
const tx = (id, accountId, date, description, amountOut, amountIn, categoryId, extra = {}) => ({
  id, accountId, accountName: accounts.find((a) => a.id === accountId).name, date, description,
  amountOut, amountIn, categoryId, raw: { Date: date, Description: description }, ...extra,
});
export const transactions = [
  tx("t1", "acct-chk", "2026-09-02", "Thrifty Sprout Market", 180, null, "cat-groc"),
  tx("t2", "acct-card", "2026-09-05", "Noodle & Newt", 45, null, "cat-dine"),
  tx("t3", "acct-chk", "2026-09-01", "Hearthside Rent", 1100, null, "cat-rent"),
  tx("t4", "acct-chk", "2026-09-10", "Glowlight Utilities", 150, null, "cat-util"),
  tx("t5", "acct-chk", "2026-09-12", "Thornwick Payroll", null, 1355.13, "cat-pay"),
  tx("t6", "acct-chk", "2026-09-14", "To savings", 200, null, "cat-xfer"),
  tx("t7", "acct-card", "2026-09-15", "Thrifty Sprout Market", 35.5, null, null),
  tx("t8", "acct-card", "2026-09-16", "Mystery Merchant", 12, null, null, { uploadBatchId: "batch-9", uploadedAt: "2026-09-16T10:00:00.000Z" }),
  tx("t9", "acct-chk", "2026-08-03", "Thrifty Sprout Market", 210, null, "cat-groc"),
  tx("t10", "acct-chk", "2026-08-03", "Thrifty Sprout Market", 210, null, "cat-groc"), // looks like a duplicate of t9
];
