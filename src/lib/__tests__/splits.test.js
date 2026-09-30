import { describe, it, expect } from "vitest";
import { hasSplits, isUncategorized, expandSplits, splitsFitAmount, evenSplit, percentsToAmounts, checkSplit, cleanSplitLines, remapSplitCategory } from "../splits.js";

const split = { id: "t", accountId: "a", date: "2026-09-05", description: "Target", amountOut: 180, amountIn: null, categoryId: null,
  splits: [{ categoryId: "groc", amount: 120 }, { categoryId: "home", amount: 60 }] };

describe("split transactions", () => {
  it("count as categorized", () => {
    expect(hasSplits(split)).toBe(true);
    expect(isUncategorized(split)).toBe(false);
    expect(isUncategorized({ categoryId: null })).toBe(true);
    expect(isUncategorized({ categoryId: null, splits: [] })).toBe(true);
  });
  it("become one piece per category for totals, keeping direction and details", () => {
    const pieces = expandSplits([split, { id: "plain", amountOut: 5, amountIn: null, categoryId: "groc" }]);
    expect(pieces.map((p) => [p.id, p.categoryId, p.amountOut, p.amountIn, p.splitOf])).toEqual([
      ["t::1", "groc", 120, null, "t"], ["t::2", "home", 60, null, "t"], ["plain", "groc", 5, null, undefined],
    ]);
    expect(pieces[0].date).toBe("2026-09-05");
    expect(pieces[0].splits).toBeUndefined();
    const refund = expandSplits([{ ...split, amountOut: null, amountIn: 180 }]);
    expect(refund.map((p) => [p.amountOut, p.amountIn])).toEqual([[null, 120], [null, 60]]);
    const none = [{ id: "x", categoryId: "a" }];
    expect(expandSplits(none)).toBe(none);
  });
  it("know whether they still add up", () => {
    expect(splitsFitAmount(split)).toBe(true);
    expect(splitsFitAmount({ ...split, amountOut: 181 })).toBe(false);
    expect(splitsFitAmount({ amountOut: 5 })).toBe(true);
  });
  it("even and percentage splits always add up to the cent", () => {
    expect(evenSplit(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(evenSplit(180.01, 4)).toEqual([45.01, 45, 45, 45]);
    const byPercent = percentsToAmounts(57.99, [33.3, 33.3, 33.4]);
    expect(Math.round(byPercent.reduce((a, b) => a + b, 0) * 100)).toBe(5799);
    expect(percentsToAmounts(10, [60, 30])).toEqual([6, 3]); // not yet 100%: no rounding fix-ups
    expect(percentsToAmounts(10, ["", "abc"])).toEqual([0, 0]);
  });
  it("can only be saved when every line is complete and nothing is left unassigned", () => {
    expect(checkSplit(180, [{ categoryId: "a", amount: 120 }, { categoryId: "b", amount: 30 }])).toEqual({ assigned: 150, remaining: 30, ok: false });
    expect(checkSplit(180, [{ categoryId: "a", amount: 120 }, { categoryId: "", amount: 60 }]).ok).toBe(false);
    expect(checkSplit(180, [{ categoryId: "a", amount: 180 }]).ok).toBe(false); // one line isn't a split
    expect(checkSplit(180, [{ categoryId: "a", amount: 120 }, { categoryId: "b", amount: 60 }]).ok).toBe(true);
    expect(checkSplit(180, [{ categoryId: "a", amount: 190 }, { categoryId: "b", amount: 60 }]).remaining).toBe(-70);
  });
  it("combines lines with the same category when saving", () => {
    expect(cleanSplitLines([{ categoryId: "a", amount: "10.10" }, { categoryId: "b", amount: 5 }, { categoryId: "a", amount: 0.2 }]))
      .toEqual([{ categoryId: "a", amount: 10.3 }, { categoryId: "b", amount: 5 }]);
  });
  it("follow categories being merged or deleted", () => {
    expect(remapSplitCategory(split, "home", "groc").splits).toEqual([{ categoryId: "groc", amount: 180 }]);
    expect(remapSplitCategory(split, "home", null).splits).toEqual([{ categoryId: "groc", amount: 120 }, { categoryId: null, amount: 60 }]);
    expect(remapSplitCategory(split, "other", "groc")).toBe(split);
  });
});
