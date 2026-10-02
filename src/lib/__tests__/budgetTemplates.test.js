import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { buildBudgetTemplate, buildExampleTemplate, readBudgetFile, planBudgetImport, parseAmount, parseMonth, nameKey, TEMPLATE_COLUMNS } from "../budgetTemplates.js";

const household = {
  categories: [
    { id: "groc", name: "Groceries", budgetAmount: 600, budgetPeriod: "monthly", budgetType: "spend" },
    { id: "dine", name: "Dining Out", budgetAmount: 150, budgetPeriod: "monthly" },
    { id: "car", name: "Car Repairs", budgetAmount: 75, budgetPeriod: "monthly", budgetType: "accumulate", accumulateTarget: 1500, accumulateActuals: { "2026-08-01": 75 } },
    { id: "pay", name: "Paychecks", isIncome: true },
    { id: "xfer", name: "Transfers", excluded: true },
    { id: "misc", name: "Misc" },
  ],
  budgetGroups: [{ id: "food", name: "Food", categoryIds: ["groc", "dine"], budgetAmount: 750, budgetPeriod: "monthly" }],
  plannedIncome: 5200,
};
const ynabFile = (rows) => ["Month,Category Group/Category,Category Group,Category,Assigned,Activity,Available", ...rows].join("\n");

describe("budget templates: writing", () => {
  it("hold budgets only, in plain columns, and leave out income unless asked", () => {
    const csv = buildBudgetTemplate(household);
    const rows = Papa.parse(csv, { header: true }).data;
    expect(Object.keys(rows[0])).toEqual(TEMPLATE_COLUMNS);
    expect(rows.map((r) => [r.Kind, r.Name, r.Amount, r.Period, r.Type, r.Goal, r.Group])).toEqual([
      ["Category", "Groceries", "600", "monthly", "Spend", "", "Food"],
      ["Category", "Dining Out", "150", "monthly", "Spend", "", "Food"],
      ["Category", "Car Repairs", "75", "monthly", "Accumulate", "1500", ""],
      ["Group", "Food", "750", "monthly", "Spend", "", ""],
    ]); // no income, no Paychecks or Transfers, no unbudgeted Misc, and no history (accumulateActuals)
    expect(csv).not.toMatch(/2026-08-01/);
    expect(buildBudgetTemplate(household, { includeIncome: true })).toMatch(/^Kind,.*\r?\nIncome,Planned monthly income,5200/);
  });
  it("the example reads back as a valid template", () => {
    const { format, plan } = readBudgetFile(buildExampleTemplate());
    expect(format).toBe("template");
    expect(plan.categories.length).toBeGreaterThan(5);
    expect(plan.groups.map((g) => g.name)).toEqual(["Food"]);
  });
});

describe("budget templates: reading and importing", () => {
  it("a household's own template, imported back, changes nothing", () => {
    const { plan } = readBudgetFile(buildBudgetTemplate(household, { includeIncome: true }));
    const r = planBudgetImport(plan, household);
    expect(r.counts).toMatchObject({ changed: 0, added: 0, unchanged: 3, groupsAdded: 0, groupsChanged: 0, incomeChanges: false });
    expect(r.rows.every((x) => x.status === "same")).toBe(true);
  });
  it("updates matching budgets (ignoring capitals and emoji), adds new categories and groups, and moves categories between groups", () => {
    const csv = "Kind,Name,Amount,Period,Type,Goal,Group\nIncome,,6000,,,,\nCategory,🛒 GROCERIES,650,monthly,Spend,,Essentials\nCategory,Pet Care,40,weekly,Spend,,\nCategory,Vacation,200,monthly,Accumulate,2400,\nGroup,Essentials,900,monthly,Spend,,";
    const r = planBudgetImport(readBudgetFile(csv).plan, household);
    expect(r.rows.map((x) => [x.name, x.before, x.after, x.status])).toEqual([
      ["Planned monthly income", "$5,200.00 a month", "$6,000.00 a month", "changed"],
      ["Groceries", "$600.00 a month", "$650.00 a month", "changed"],
      ["Pet Care", "New category", "$40.00 a week", "added"],
      ["Vacation", "New category", "Save $200.00 a month toward $2,400", "added"],
      ["Essentials", "New group", "$900.00 a month", "added"],
    ]);
    const groc = r.next.categories.find((c) => c.id === "groc");
    expect(groc).toMatchObject({ name: "Groceries", budgetAmount: 650 }); // keeps its own name and id
    expect(r.next.budgetGroups.find((g) => g.name === "Food").categoryIds).toEqual(["dine"]); // moved out of Food...
    expect(r.next.budgetGroups.find((g) => g.name === "Essentials").categoryIds).toEqual(["groc"]); // ...into Essentials
    expect(r.next.plannedIncome).toBe(6000);
    expect(r.next.categories.find((c) => c.name === "Vacation")).toMatchObject({ budgetType: "accumulate", accumulateTarget: 2400, isIncome: false, excluded: false });
    expect(household.categories.find((c) => c.id === "groc").budgetAmount).toBe(600); // nothing changed until applied
  });
  it("can skip categories that don't exist yet", () => {
    const r = planBudgetImport(readBudgetFile("Kind,Name,Amount\nCategory,Pet Care,40").plan, household, { createMissing: false });
    expect(r.counts).toMatchObject({ added: 0, notCreated: 1 });
    expect(r.rows[0]).toMatchObject({ status: "skipped", before: "Not in Coinrose" });
    expect(r.next.categories).toHaveLength(household.categories.length);
  });
  it("reports rows it can't use, and refuses files that aren't budgets", () => {
    const { plan, details } = readBudgetFile("Kind,Name,Amount\nCategory,,10\nThing,Odd,5\nCategory,Debt,-50\nCategory,Ok,5");
    expect(plan.categories.map((c) => c.name)).toEqual(["Ok"]);
    expect(details.problems).toHaveLength(3);
    expect(() => readBudgetFile("Row Type,Item Type,Name\nSettings,,x")).toThrow(/budget backup/);
    expect(() => readBudgetFile("Date,Payee,Category,Memo,Outflow,Inflow\n1,2,3,4,5,6")).toThrow(/transaction register/);
    expect(() => readBudgetFile("a,b\n1,2")).toThrow(/isn't a Coinrose budget template or a YNAB plan export/);
  });
});

describe("importing from a YNAB plan export", () => {
  const file = ynabFile([
    "Jul 2026,Inflow: Ready to Assign,Inflow,Ready to Assign,$0.00,$0.00,$0.00",
    'Jul 2026,Everyday: 🛒 Groceries,Everyday,🛒 Groceries,$600.00,-$612.10,-$12.10',
    'Aug 2026,Everyday: 🛒 Groceries,Everyday,🛒 Groceries,$650.00,-$640.00,$10.00',
    'Sep 2026,Everyday: 🛒 Groceries,Everyday,🛒 Groceries,$700.00,-$300.00,$400.00',
    'Oct 2026,Everyday: 🛒 Groceries,Everyday,🛒 Groceries,$999.00,$0.00,$999.00',
    "Sep 2026,Credit Card Payments: Griffon Card,Credit Card Payments,Griffon Card,$900.00,$0.00,$900.00",
    "Sep 2026,True Expenses: Car Repairs,True Expenses,Car Repairs,$300.00,$0.00,$300.00",
  ]);
  it("averages what was assigned over the last 3 months up to now, skipping things that aren't budgets", () => {
    const { format, plan, details } = readBudgetFile(file, { today: "2026-09-28" });
    expect(format).toBe("ynab");
    expect(plan.categories.map((c) => [c.name, c.amount, c.type, c.period])).toEqual([["🛒 Groceries", 650, "spend", "monthly"], ["Car Repairs", 100, "spend", "monthly"]]);
    expect(details.months).toEqual(["2026-07", "2026-08", "2026-09"]); // October is in the future
    expect(details.skipped).toEqual(["Griffon Card", "Ready to Assign"]);
  });
  it("or uses just the most recent month", () => {
    expect(readBudgetFile(file, { basis: "latest", today: "2026-09-28" }).plan.categories.map((c) => c.amount)).toEqual([700, 300]);
  });
  it("matches existing categories despite YNAB's emoji", () => {
    const r = planBudgetImport(readBudgetFile(file, { today: "2026-09-28" }).plan, household);
    expect(r.rows.find((x) => x.name === "Groceries")).toMatchObject({ before: "$600.00 a month", after: "$650.00 a month", status: "changed" });
  });
  it("reads older exports ('Budgeted') and tab-separated, comma-decimal ones", () => {
    const old = "Month,Category Group/Category,Category Group,Category,Budgeted,Outflows,Category Balance\n2026-09,Bills: Rent,Bills,Rent,\"$1,450.00\",$0.00,$0.00";
    expect(readBudgetFile(old, { today: "2026-09-28" }).plan.categories[0]).toMatchObject({ name: "Rent", amount: 1450 });
    const tsv = "Month\tCategory Group/Category\tCategory Group\tCategory\tAssigned\tActivity\tAvailable\nSep 2026\tBills: Miete\tBills\tMiete\t1.234,56 €\t0\t0";
    expect(readBudgetFile(tsv, { today: "2026-09-28" }).plan.categories[0]).toMatchObject({ name: "Miete", amount: 1234.56 });
  });
  it("with no months up to now, it says so", () => {
    expect(() => readBudgetFile(ynabFile(["Dec 2030,A: B,A,B,$5.00,$0.00,$5.00"]), { today: "2026-09-28" })).toThrow(/doesn't have any months/);
  });
});

describe("small pieces", () => {
  it("amounts in either style", () => {
    expect([parseAmount("-$12.40"), parseAmount("$-12.40"), parseAmount("(12.40)"), parseAmount("1,234.56"), parseAmount("1.234,56", true), parseAmount("€ 5"), parseAmount(""), parseAmount("abc")])
      .toEqual([-12.4, -12.4, -12.4, 1234.56, 1234.56, 5, null, null]);
  });
  it("months in YNAB's styles", () => {
    expect(["Sep 2026", "September 2026", "2026-09", "9/2026", "nonsense"].map(parseMonth)).toEqual(["2026-09", "2026-09", "2026-09", "2026-09", null]);
  });
  it("names match loosely", () => {
    expect(nameKey("🛒  Groceries!")).toBe(nameKey("groceries"));
    expect(nameKey("Dining-Out")).toBe(nameKey("dining out"));
  });
});
