import { describe, it, expect } from "vitest";
import { buildDemoLedger } from "../demoData.js";
import { normalizeLoadedLedger } from "../ledgerData.js";
import { isUncategorized } from "../splits.js";

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
    expect(d.transactions.filter((t) => t.date < "2026-09-24").every((t) => !isUncategorized(t))).toBe(true); // categorized or split
  });
  it("survives the same loading step real data goes through", () => {
    const d = normalizeLoadedLedger(buildDemoLedger("2026-09-28"));
    expect(d.transactions.length).toBeGreaterThan(100);
    expect(d.autoApplySuggestions).toBe(true);
  });
});

import { findTransferPairs } from "../transfers.js";
describe("the demo's transfers", () => {
  it("earlier transfers are paired both ways, and the latest card payment waits as a suggestion", () => {
    for (const today of ["2026-09-28", "2026-10-03", "2027-02-27"]) {
      const d = buildDemoLedger(today);
      const byId = new Map(d.transactions.map((t) => [t.id, t]));
      const linked = d.transactions.filter((t) => t.transferWith);
      expect(linked.length).toBeGreaterThan(4);
      expect(linked.every((t) => byId.get(t.transferWith).transferWith === t.id && t.categoryId === "demo-xfer")).toBe(true);
      const pairs = findTransferPairs(d.transactions, d.categories);
      expect(pairs).toHaveLength(1);
      expect(byId.get(pairs[0].outId).description).toBe("Griffon Reserve Card Payment");
    }
  });
});

import { splitsFitAmount } from "../splits.js";
describe("the demo's split transactions", () => {
  it("include a monthly superstore run, split between real categories, adding up exactly", () => {
    const d = buildDemoLedger("2026-09-28");
    const categoryIds = new Set(d.categories.map((c) => c.id));
    const split = d.transactions.filter((t) => t.splits);
    expect(split.map((t) => t.date)).toEqual(["2026-06-16", "2026-07-16", "2026-08-16", "2026-09-16"]);
    expect(split.every((t) => splitsFitAmount(t) && t.categoryId === null && t.splits.every((s) => categoryIds.has(s.categoryId)))).toBe(true);
  });
});

import { DEMO_MEMBERS } from "../demoData.js";
describe("the demo's comments", () => {
  it("include a short conversation between the sample members", () => {
    const d = buildDemoLedger("2026-09-28");
    const withComments = d.transactions.filter((t) => t.comments);
    expect(withComments).toHaveLength(1);
    const ids = new Set(DEMO_MEMBERS.map((m) => m.user_id));
    expect(withComments[0].comments.every((c) => ids.has(c.authorId) && c.text)).toBe(true);
  });
});

describe("the demo's paychecks", () => {
  it("one earner every two weeks, the other twice a month (moved for weekends)", () => {
    const d = buildDemoLedger("2026-09-28");
    const twice = d.transactions.filter((t) => t.description === "Brightwater Clinic Payroll").map((t) => t.date);
    expect(twice).toEqual(["2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15"]);
  });
});
