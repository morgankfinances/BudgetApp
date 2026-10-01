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
    expect(estimateBalance(chk, list)).toEqual({ startAmount: 1000, startDate: "2026-09-01", owed: false, current: 1334.62, count: 3, earlierCount: 2, latestDate: "2026-09-07" });
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

import { balanceHistory, combinedHistory, summarizeHistory } from "../balances.js";
describe("balance history", () => {
  it("works backward and forward from the starting balance: one point per day with transactions", () => {
    expect(balanceHistory(chk, list)).toEqual([
      { date: "2026-08-30", value: 1540, edge: true },   // before the earliest upload: Aug 31's $500 and Sep 1's $40 undone
      { date: "2026-08-31", value: 1040 },               // end of Aug 31: Sep 1's $40 undone
      { date: "2026-09-01", value: 1000, anchor: true }, // the starting balance (Sep 1's $40 already in it)
      { date: "2026-09-05", value: 3184.62 },
      { date: "2026-09-06", value: 1734.62 },
      { date: "2026-09-07", value: 1334.62 }, // the skipped duplicate on Sep 8 isn't a point
    ]);
    expect(balanceHistory({ id: "x" }, list)).toEqual([]);
  });
  it("for a card or loan, it tracks what's owed", () => {
    expect(balanceHistory(card, list).map((p) => p.value)).toEqual([750, 870.5, 470.5]);
  });
  it("combined: what's in accounts minus what's owed, from the first day every balance is known", () => {
    const later = { ...card, startingBalance: { ...card.startingBalance, date: "2026-09-04" } };
    const c = combinedHistory([chk, later], list);
    // The card's Sep 3 purchase is worked out backward: it owed $629.50 before it.
    expect(c[0]).toEqual({ date: "2026-09-02", value: 370.5 }); // 1,000.00 in checking minus 629.50 owed
    expect(c.map((p) => p.date)).toEqual(["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-10"]);
    expect(c.at(-1).value).toBe(984.62); // exact to the cent (1,334.62 in checking, 350.00 owed)
    expect(combinedHistory([{ id: "untracked" }], list)).toEqual([]);
  });
  it("summaries: start, end, change, and the lowest and highest points", () => {
    expect(summarizeHistory(balanceHistory(chk, list))).toEqual({
      start: { date: "2026-08-30", value: 1540, edge: true }, end: { date: "2026-09-07", value: 1334.62 }, change: -205.38,
      low: { date: "2026-09-01", value: 1000, anchor: true }, high: { date: "2026-09-05", value: 3184.62 },
    });
    expect(summarizeHistory([])).toBeNull();
  });
});

describe("balance history: the card case worked backward", () => {
  it("for a card, undoing a payment raises what was owed, and undoing a purchase lowers it", () => {
    const owed = { id: "card", startingBalance: { amount: 500, date: "2026-09-01", owed: true } };
    const tx = [t("p", "card", "2026-08-20", 120, null), t("q", "card", "2026-08-25", null, 300), t("r", "card", "2026-09-03", 60, null)];
    expect(balanceHistory(owed, tx)).toEqual([
      { date: "2026-08-19", value: 680, edge: true },
      { date: "2026-08-20", value: 800 },
      { date: "2026-08-25", value: 500 },
      { date: "2026-09-01", value: 500, anchor: true },
      { date: "2026-09-03", value: 560 },
    ]);
  });
});
