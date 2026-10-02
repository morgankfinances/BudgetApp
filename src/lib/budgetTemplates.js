// src/lib/budgetTemplates.js
// Budget templates: a simple, shareable file of budgets only (no
// transactions, no spending history), plus importing a budget from a YNAB
// plan export. Both are read into the same "plan", previewed, and applied
// to the household's categories and budget groups.
//
// Template format (CSV), one row per line:
//   Kind,Name,Amount,Period,Type,Goal,Group
//   Income,Planned monthly income,5200,,,,
//   Category,Groceries,600,monthly,Spend,,Food
//   Category,Car Repairs,75,monthly,Accumulate,1500,
//   Group,Food,750,monthly,Spend,,
// Kind: Income | Category | Group. Period: monthly | weekly. Type: Spend |
// Accumulate (saves toward Goal over time). A category's Group puts it in
// that budget group; a Group row sets the group's shared budget.

import Papa from "papaparse";
import { protectCsvRows } from "./backup.js";
import { todayISO, uid } from "./utils.js";

export const TEMPLATE_COLUMNS = ["Kind", "Name", "Amount", "Period", "Type", "Goal", "Group"];

// A starting point people can download, edit, and share.
export const EXAMPLE_TEMPLATE_ROWS = [
  { Kind: "Category", Name: "Rent or Mortgage", Amount: 1450, Period: "monthly", Type: "Spend", Goal: "", Group: "Home" },
  { Kind: "Category", Name: "Utilities", Amount: 220, Period: "monthly", Type: "Spend", Goal: "", Group: "Home" },
  { Kind: "Category", Name: "Groceries", Amount: 600, Period: "monthly", Type: "Spend", Goal: "", Group: "Food" },
  { Kind: "Category", Name: "Dining Out", Amount: 150, Period: "monthly", Type: "Spend", Goal: "", Group: "Food" },
  { Kind: "Category", Name: "Gas", Amount: 50, Period: "weekly", Type: "Spend", Goal: "", Group: "" },
  { Kind: "Category", Name: "Car Repairs", Amount: 75, Period: "monthly", Type: "Accumulate", Goal: 1500, Group: "" },
  { Kind: "Category", Name: "Vacation", Amount: 200, Period: "monthly", Type: "Accumulate", Goal: 2400, Group: "" },
  { Kind: "Group", Name: "Food", Amount: 750, Period: "monthly", Type: "Spend", Goal: "", Group: "" },
];

// Names match loosely: case, spacing, punctuation, and emoji don't matter
// ("🛒 Groceries" in YNAB matches "Groceries" here).
export const nameKey = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const budgetOf = (item) =>
  item.budgetAmount == null
    ? null
    : {
        amount: item.budgetAmount,
        period: item.budgetPeriod === "weekly" ? "weekly" : "monthly",
        type: item.budgetType === "accumulate" ? "accumulate" : "spend",
        goal: item.budgetType === "accumulate" && item.accumulateTarget != null ? item.accumulateTarget : null,
      };

/* ------------------------------------------------------------------ */
/* Writing templates                                                    */
/* ------------------------------------------------------------------ */

// The household's budgets as a template: categories with a budget, budget
// groups, and (only if asked) planned income. No history of any kind.
export function buildBudgetTemplate({ categories = [], budgetGroups = [], plannedIncome = null }, { includeIncome = false } = {}) {
  const groupOf = {};
  budgetGroups.forEach((g) => (g.categoryIds || []).forEach((id) => (groupOf[id] = g.name)));
  const rows = [];
  if (includeIncome && plannedIncome != null) {
    rows.push({ Kind: "Income", Name: "Planned monthly income", Amount: plannedIncome, Period: "", Type: "", Goal: "", Group: "" });
  }
  const row = (kind, item, group = "") => {
    const b = budgetOf(item);
    return {
      Kind: kind,
      Name: item.name,
      Amount: b ? b.amount : "",
      Period: b ? b.period : "",
      Type: b ? (b.type === "accumulate" ? "Accumulate" : "Spend") : "",
      Goal: b && b.goal != null ? b.goal : "",
      Group: group,
    };
  };
  categories
    .filter((c) => !c.excluded && !c.isIncome && (c.budgetAmount != null || groupOf[c.id]))
    .forEach((c) => rows.push(row("Category", c, groupOf[c.id] || "")));
  budgetGroups.forEach((g) => rows.push(row("Group", g)));
  return Papa.unparse(protectCsvRows(rows), { columns: TEMPLATE_COLUMNS });
}

export const buildExampleTemplate = () => Papa.unparse(EXAMPLE_TEMPLATE_ROWS, { columns: TEMPLATE_COLUMNS });

/* ------------------------------------------------------------------ */
/* Reading files                                                        */
/* ------------------------------------------------------------------ */

// A number from a file, in either style: "1,234.56" or (in tab-separated
// files, from currencies that use a comma for decimals) "1.234,56".
// Currency symbols, spaces, and parentheses-for-negative are fine.
export function parseAmount(raw, decimalComma = false) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = /^\(.*\)$/.test(s) || /^-|^[^\d]*-/.test(s) || /-$/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((negative ? -n : n) * 100) / 100;
}

const lowerKeys = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [String(k).trim().toLowerCase(), v]));

// YNAB writes months like "Sep 2026" (older exports: "September 2026" or
// "2026-09"). Returns "YYYY-MM", or null.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function parseMonth(raw) {
  const s = String(raw || "").trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, "0")}`;
  return null;
}

// YNAB groups and categories that aren't budgets: money waiting to be
// assigned, credit card payment holding categories, and internal ones.
const YNAB_SKIP_GROUPS = new Set(["internal master category", "credit card payments", "hidden categories"]);
const YNAB_SKIP_CATEGORIES = new Set(["inflow ready to assign", "ready to assign", "to be budgeted", "inflow to be budgeted", "uncategorized"]);

// Reads a budget file: a Coinrose template or a YNAB plan export. Returns
// { format, plan, details } where plan = { income, categories: [{ name,
// amount, period, type, goal, group }], groups: [...] }, or throws an
// Error with a message for the person importing.
//
// For YNAB, `basis` chooses each category's amount: "average" (of what was
// assigned over the last 3 months up to `today`, the default) or "latest"
// (the most recent of those months).
export function readBudgetFile(text, { basis = "average", today = todayISO() } = {}) {
  const parsed = Papa.parse(String(text || "").replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: "greedy" });
  const delimiter = parsed.meta && parsed.meta.delimiter;
  const fields = (parsed.meta.fields || []).map((f) => String(f).trim().toLowerCase());
  const rows = parsed.data.map(lowerKeys);

  if (fields.includes("row type")) {
    throw new Error("This looks like a Coinrose budget backup, not a template. Restore it from the Backup page instead.");
  }
  if (fields.includes("category group") && fields.includes("month") && (fields.includes("assigned") || fields.includes("budgeted"))) {
    return readYnabPlan(rows, { decimalComma: delimiter === "\t", basis, today, assignedKey: fields.includes("assigned") ? "assigned" : "budgeted" });
  }
  if (fields.includes("kind") && fields.includes("name") && fields.includes("amount")) {
    return readTemplate(rows);
  }
  if (fields.includes("payee") && (fields.includes("outflow") || fields.includes("inflow"))) {
    throw new Error("This is YNAB's transaction register. For budgets, choose the other file from the export: the plan.");
  }
  throw new Error("This file isn't a Coinrose budget template or a YNAB plan export. Download the example template to see the format.");
}

function readTemplate(rows) {
  const plan = { income: null, categories: [], groups: [] };
  const problems = [];
  rows.forEach((r, i) => {
    const kind = String(r.kind || "").trim().toLowerCase();
    const name = String(r.name || "").trim();
    if (!kind && !name) return;
    const amount = parseAmount(r.amount);
    if (kind === "income") {
      if (amount != null && amount >= 0) plan.income = amount;
      return;
    }
    if (kind !== "category" && kind !== "group") {
      problems.push(`Row ${i + 2}: "${r.kind}" isn't Income, Category, or Group, so it was skipped.`);
      return;
    }
    if (!name) {
      problems.push(`Row ${i + 2}: no name, so it was skipped.`);
      return;
    }
    if (amount != null && amount < 0) {
      problems.push(`Row ${i + 2} (${name}): budgets can't be negative, so it was skipped.`);
      return;
    }
    const type = String(r.type || "").trim().toLowerCase().startsWith("acc") ? "accumulate" : "spend";
    const item = {
      name: name.slice(0, 80),
      amount,
      period: String(r.period || "").trim().toLowerCase() === "weekly" ? "weekly" : "monthly",
      type,
      goal: type === "accumulate" ? parseAmount(r.goal) : null,
      group: kind === "category" ? String(r.group || "").trim().slice(0, 80) : "",
    };
    (kind === "group" ? plan.groups : plan.categories).push(item);
  });
  return { format: "template", plan, details: { problems } };
}

function readYnabPlan(rows, { decimalComma, basis, today, assignedKey }) {
  const thisMonth = today.slice(0, 7);
  const byCategory = new Map(); // name -> { name, group, months: Map(month -> assigned) }
  const skipped = new Set();
  rows.forEach((r) => {
    const group = String(r["category group"] || "").trim();
    const name = String(r.category || "").trim();
    const month = parseMonth(r.month);
    if (!name || !month || month > thisMonth) return;
    if (YNAB_SKIP_GROUPS.has(group.toLowerCase()) || YNAB_SKIP_CATEGORIES.has(nameKey(name))) {
      skipped.add(name);
      return;
    }
    if (!byCategory.has(name)) byCategory.set(name, { name, group, months: new Map() });
    byCategory.get(name).months.set(month, parseAmount(r[assignedKey], decimalComma) || 0);
  });
  const allMonths = [...new Set([...byCategory.values()].flatMap((c) => [...c.months.keys()]))].sort();
  if (!allMonths.length) {
    throw new Error("This YNAB export doesn't have any months up to now with categories in it.");
  }
  const used = basis === "latest" ? allMonths.slice(-1) : allMonths.slice(-3);
  const categories = [...byCategory.values()].map((c) => {
    const total = used.reduce((sum, m) => sum + (c.months.get(m) || 0), 0);
    const amount = Math.max(0, Math.round((total / used.length) * 100) / 100);
    return { name: c.name.slice(0, 80), amount, period: "monthly", type: "spend", goal: null, group: "" };
  });
  return {
    format: "ynab",
    plan: { income: null, categories, groups: [] },
    details: { months: used, monthsInFile: allMonths.length, basis, skipped: [...skipped].sort(), groupsNotUsed: [...new Set([...byCategory.values()].map((c) => c.group).filter(Boolean))] },
  };
}

/* ------------------------------------------------------------------ */
/* Planning and applying an import                                      */
/* ------------------------------------------------------------------ */

const describe = (b) => {
  if (!b || b.amount == null) return "No budget";
  const money = `$${Number(b.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const per = b.period === "weekly" ? "a week" : "a month";
  return b.type === "accumulate" ? `Save ${money} ${per}${b.goal != null ? ` toward $${Number(b.goal).toLocaleString("en-US")}` : ""}` : `${money} ${per}`;
};

const sameBudget = (a, b) =>
  (a == null && (b == null || b.amount == null)) ||
  (a != null && b != null && a.amount === b.amount && a.period === b.period && a.type === b.type && (a.goal ?? null) === (b.goal ?? null));

// Works out what importing `plan` would change, without changing anything.
// Returns { rows, counts, next } where rows describe each change for the
// preview and `next` holds the categories, budget groups, and planned
// income to save if the person confirms.
export function planBudgetImport(plan, { categories = [], budgetGroups = [], plannedIncome = null }, { createMissing = true } = {}) {
  const nextCategories = categories.map((c) => ({ ...c }));
  const catByKey = new Map(nextCategories.map((c) => [nameKey(c.name), c]));
  const rows = [];
  const counts = { changed: 0, added: 0, unchanged: 0, notCreated: 0, groupsAdded: 0, groupsChanged: 0 };

  const applyBudget = (target, b) => {
    if (b.amount == null) {
      target.budgetAmount = null;
      return;
    }
    target.budgetAmount = b.amount;
    target.budgetPeriod = b.period;
    target.budgetType = b.type;
    target.accumulateTarget = b.type === "accumulate" ? b.goal ?? null : null;
  };

  plan.categories.forEach((item) => {
    const existing = catByKey.get(nameKey(item.name));
    if (!existing) {
      if (!createMissing) {
        counts.notCreated += 1;
        rows.push({ kind: "Category", name: item.name, before: "Not in Coinrose", after: describe(item), status: "skipped" });
        return;
      }
      const created = { id: uid(), name: item.name, excluded: false, isIncome: false };
      applyBudget(created, item);
      if (item.type === "accumulate") created.createdAt = todayISO();
      nextCategories.push(created);
      catByKey.set(nameKey(item.name), created);
      counts.added += 1;
      rows.push({ kind: "Category", name: item.name, before: "New category", after: describe(item), status: "added" });
      return;
    }
    const before = budgetOf(existing);
    if (sameBudget(before, item)) {
      counts.unchanged += 1;
      rows.push({ kind: "Category", name: existing.name, before: describe(before), after: describe(item), status: "same" });
      return;
    }
    applyBudget(existing, item);
    if (item.type === "accumulate" && !existing.createdAt) existing.createdAt = todayISO();
    counts.changed += 1;
    rows.push({ kind: "Category", name: existing.name, before: describe(before), after: describe(item), status: "changed" });
  });

  // Budget groups: a Group row sets its shared budget; categories listing a
  // group join it (and leave any other group, since a category belongs to
  // at most one).
  const nextGroups = budgetGroups.map((g) => ({ ...g, categoryIds: [...(g.categoryIds || [])] }));
  const groupByKey = new Map(nextGroups.map((g) => [nameKey(g.name), g]));
  const ensureGroup = (name) => {
    let g = groupByKey.get(nameKey(name));
    if (!g) {
      g = { id: uid(), name, categoryIds: [] };
      nextGroups.push(g);
      groupByKey.set(nameKey(name), g);
      counts.groupsAdded += 1;
      g.__new = true;
    }
    return g;
  };
  plan.groups.forEach((item) => {
    const g = ensureGroup(item.name);
    const before = budgetOf(g);
    if (!g.__new && sameBudget(before, item)) return;
    applyBudget(g, item);
    if (!g.__new) counts.groupsChanged += 1;
    rows.push({ kind: "Group", name: g.name, before: g.__new ? "New group" : describe(before), after: describe(item), status: g.__new ? "added" : "changed" });
  });
  plan.categories
    .filter((item) => item.group)
    .forEach((item) => {
      const cat = catByKey.get(nameKey(item.name));
      if (!cat) return;
      const g = ensureGroup(item.group);
      nextGroups.forEach((other) => {
        if (other !== g) other.categoryIds = other.categoryIds.filter((id) => id !== cat.id);
      });
      if (!g.categoryIds.includes(cat.id)) g.categoryIds.push(cat.id);
    });
  nextGroups.forEach((g) => delete g.__new);

  const incomeChanges = plan.income != null && plan.income !== plannedIncome;
  if (incomeChanges) {
    rows.unshift({
      kind: "Income",
      name: "Planned monthly income",
      before: plannedIncome == null ? "Not set" : describe({ amount: plannedIncome, period: "monthly", type: "spend" }),
      after: describe({ amount: plan.income, period: "monthly", type: "spend" }),
      status: "changed",
    });
  }
  return {
    rows,
    counts: { ...counts, incomeChanges },
    next: { categories: nextCategories, budgetGroups: nextGroups, plannedIncome: incomeChanges ? plan.income : plannedIncome },
  };
}
