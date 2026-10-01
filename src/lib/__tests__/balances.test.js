import { describe, it, expect } from "vitest";
import { estimateBalance, totalBalances, hasStartingBalance } from "../balances.js";

const t = (id, accountId, date, out, inn, extra = {}) => ({ id, accountId, date, amountOut: out, amountIn: inn, ...extra });
const list = [
  t("before", "chk", "2026-08-31", 500, null),              // before the starting date: already in the balance
  t("same-day", "chk", "2026-09-01", 40, null),             // on the starting date: already in the balance
  t("pay", "chk", "2026-09-05", null, 2184.62),
  t("rent", "chk", "2026-09-06", 1450, null),
  t("xfer", "chk", "2026-09-07", 400, null, { categoryId: "transfers", transferWith: "x" }), // transfers still move money
  t("dup", "chk", "2026-09-08", 99, null, { skippedDuplicateOf: "rent" }),                   // skipped duplicates don't
  t("card1", "card", "2026-09-03", 120.5, null),
  t("cardpay", "card", "2026-09-10", null, 400),
];
const chk = { id: "chk", name: "Checking", startingBalance: { amount: 1000, date: "2026-09-01", owed: false } };
const card = { id: "card", name: "Card", startingBalance: { amount: 750, date: "2026-09-01", owed: true } };

describe("estimated balances", () => {
  it("start from the balance at the end of the chosen day, then add money in and subtract money out after it", () => {
    expect(estimateBalance(chk, list)).toEqual({ startAmount: 1000, startDate: "2026-09-01", owed: false, current: 1334.62, count: 3, latestDate: "2026-09-07" });
  });
  it("for a card or loan, the amount is what's owed: purchases raise it and payments lower it", () => {
    expect(estimateBalance(card, list)).toMatchObject({ owed: true, current: 470.5, count: 2 });
  });
  it("accounts without a (valid) starting balance aren't estimated", () => {
    expect(estimateBalance({ id: "chk" }, list)).toBeNull();
    expect(hasStartingBalance({ startingBalance: { amount: 5, date: "09/01/2026" } })).toBe(false);
    expect(hasStartingBalance({ startingBalance: { amount: "abc", date: "2026-09-01" } })).toBe(false);
    expect(estimateBalance({ id: "none", startingBalance: { amount: 10, date: "2026-09-01" } }, list)).toMatchObject({ current: 10, count: 0, latestDate: null });
  });
  it("add up to cents exactly, with no rounding drift", () => {
    const many = Array.from({ length: 100 }, (_, i) => t(`c${i}`, "chk", "2026-09-02", 0.1, null));
    expect(estimateBalance({ id: "chk", startingBalance: { amount: 10.3, date: "2026-09-01" } }, many).current).toBe(0.3);
  });
  it("totals: what's in accounts, what's owed, and the difference", () => {
    expect(totalBalances([chk, card, { id: "untracked" }], list)).toEqual({ tracked: 2, have: 1334.62, owe: 470.5, net: 864.12 });
  });
});
