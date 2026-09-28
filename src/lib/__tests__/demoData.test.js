import { describe, it, expect } from "vitest";
import { buildDemoLedger } from "../demoData.js";
import { normalizeLoadedLedger } from "../ledgerData.js";

describe("the demo's sample data", () => {
  it("always ends on the day it's opened, covering three full months before this one", () => {
    for (const today of ["2026-09-28", "2027-01-03", "2028-02-29"]) {
      const d = buildDemoLedger(today);
      const dates = d.transactions.map((t) => t.date).sort();
      expect(dates.at(-1) <= today).toBe(true);
      expect(dates.at(-1) >= today.slice(0, 8) + "01").toBe(true); // something this month
      const start = dates[0];
      expect(start.endsWith("-01")).toBe(true); // starts on the 1st
      const monthsBack = (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(start.slice(5, 7)));
      expect(monthsBack).toBe(3);
    }
  });
  it("is the same all day, and different on other days", () => {
    expect(buildDemoLedger("2026-09-28")).toEqual(buildDemoLedger("2026-09-28"));
    expect(buildDemoLedger("2026-09-29").transactions).not.toEqual(buildDemoLedger("2026-09-28").transactions);
  });
  it("hangs together: every reference points at something real", () => {
    const d = buildDemoLedger("2026-09-28");
    const accountIds = new Set(d.accounts.map((a) => a.id));
    const categoryIds = new Set(d.categories.map((c) => c.id));
    expect(d.transactions.every((t) => accountIds.has(t.accountId) && (t.categoryId === null || categoryIds.has(t.categoryId)))).toBe(true);
    expect(d.budgetGroups.every((g) => g.categoryIds.every((id) => categoryIds.has(id)))).toBe(true);
    expect(new Set(d.transactions.map((t) => t.id)).size).toBe(d.transactions.length);
    expect(d.transactions.every((t) => (t.amountOut > 0) !== (t.amountIn > 0))).toBe(true); // exactly one side
  });
  it("includes the recurring pieces: rent on the 1st, paychecks every other Friday, and paired transfers", () => {
    const d = buildDemoLedger("2026-09-28");
    const rent = d.transactions.filter((t) => t.description === "Hearthside Property Management").map((t) => t.date);
    expect(rent).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
    const pay = d.transactions.filter((t) => t.description === "Thornwick & Vale Payroll").map((t) => new Date(`${t.date}T00:00:00Z`));
    expect(pay.every((p) => p.getUTCDay() === 5)).toBe(true);
    expect(pay.slice(1).every((p, i) => (p - pay[i]) / 864e5 === 14)).toBe(true);
    const out = d.transactions.filter((t) => t.description === "Transfer to Savings");
    const into = d.transactions.filter((t) => t.description === "Transfer from Checking");
    expect(out.map((t) => [t.date, t.amountOut])).toEqual(into.map((t) => [t.date, t.amountIn]));
  });
  it("leaves the last few days uncategorized, to show off categorizing", () => {
    const d = buildDemoLedger("2026-09-28");
    const recent = d.transactions.filter((t) => t.date >= "2026-09-24" && !["demo-pay", "demo-xfer"].includes(t.categoryId));
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((t) => t.categoryId === null)).toBe(true);
    expect(d.transactions.filter((t) => t.date < "2026-09-24").every((t) => t.categoryId)).toBe(true);
  });
  it("survives the same loading step real data goes through", () => {
    const d = normalizeLoadedLedger(buildDemoLedger("2026-09-28"));
    expect(d.transactions.length).toBeGreaterThan(100);
    expect(d.autoApplySuggestions).toBe(true);
  });
});
