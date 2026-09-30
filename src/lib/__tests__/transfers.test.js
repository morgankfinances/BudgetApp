import { describe, it, expect } from "vitest";
import { findTransferPairs, linkTransfers, unlinkTransfer, dismissTransferPair, removeBrokenTransferLinks, TRANSFER_WINDOW_DAYS } from "../transfers.js";

const t = (id, accountId, date, amountOut, amountIn, extra = {}) => ({ id, accountId, date, description: id, amountOut, amountIn, categoryId: null, ...extra });
const cats = [{ id: "groc", name: "Groceries", excluded: false }, { id: "xfer", name: "Transfers", excluded: true }];

describe("finding transfers", () => {
  it("pairs money leaving one account with the same amount arriving in another within the window", () => {
    const pairs = findTransferPairs([t("out", "chk", "2026-09-25", 1262.8, null), t("in", "card", "2026-09-26", null, 1262.8)], cats);
    expect(pairs).toEqual([{ outId: "out", inId: "in", amount: 1262.8, days: 1 }]);
    expect(TRANSFER_WINDOW_DAYS).toBe(4);
  });
  it("ignores the same account, different amounts, and gaps longer than the window", () => {
    expect(findTransferPairs([t("a", "chk", "2026-09-01", 50, null), t("b", "chk", "2026-09-01", null, 50)], cats)).toEqual([]);
    expect(findTransferPairs([t("a", "chk", "2026-09-01", 50, null), t("b", "sav", "2026-09-01", null, 50.01)], cats)).toEqual([]);
    expect(findTransferPairs([t("a", "chk", "2026-09-01", 50, null), t("b", "sav", "2026-09-06", null, 50)], cats)).toEqual([]);
    expect(findTransferPairs([t("a", "chk", "2026-09-01", 50, null), t("b", "sav", "2026-09-05", null, 50)], cats)).toHaveLength(1);
  });
  it("only looks at transactions that currently count: not excluded, paired, skipped, or dismissed", () => {
    const base = (extraOut = {}, extraIn = {}) => findTransferPairs([t("a", "chk", "2026-09-01", 50, null, extraOut), t("b", "sav", "2026-09-01", null, 50, extraIn)], cats);
    expect(base({ categoryId: "xfer" })).toEqual([]);
    expect(base({ categoryId: "groc" })).toHaveLength(1); // categorized, but still counting
    expect(base({ transferWith: "zz" })).toEqual([]);
    expect(base({}, { skippedDuplicateOf: "x" })).toEqual([]);
    expect(base({ notTransferWith: ["b"] })).toEqual([]);
  });
  it("each transaction pairs once, and the closest dates win", () => {
    const pairs = findTransferPairs([
      t("out1", "chk", "2026-09-10", 100, null),
      t("far", "sav", "2026-09-13", null, 100),
      t("near", "sav", "2026-09-11", null, 100),
      t("out2", "chk", "2026-09-12", 100, null),
    ], cats);
    expect(pairs.map((p) => [p.outId, p.inId])).toEqual([["out1", "near"], ["out2", "far"]]);
  });
});

describe("marking and unmarking transfers", () => {
  const list = [t("a", "chk", "2026-09-01", 50, null, { categoryId: "groc", categorySuggested: true }), t("b", "sav", "2026-09-01", null, 50), t("c", "chk", "2026-09-02", 9, null)];
  it("puts both sides in the excluded Transfers category, linked to each other", () => {
    const { transactions, categories } = linkTransfers(list, cats, [{ outId: "a", inId: "b" }]);
    expect(categories).toBe(cats); // the existing excluded "Transfers" is reused
    expect(transactions[0]).toEqual(expect.objectContaining({ categoryId: "xfer", transferWith: "b" }));
    expect(transactions[0].categorySuggested).toBeUndefined();
    expect(transactions[1]).toEqual(expect.objectContaining({ categoryId: "xfer", transferWith: "a" }));
    expect(transactions[2]).toBe(list[2]);
  });
  it("adds a Transfers category when there's none, without touching a non-excluded one with that name", () => {
    const created = linkTransfers(list, [cats[0]], [{ outId: "a", inId: "b" }]).categories.at(-1);
    expect(created).toEqual(expect.objectContaining({ name: "Transfers", excluded: true }));
    const alongside = linkTransfers(list, [cats[0], { id: "mine", name: "Transfers", excluded: false }], [{ outId: "a", inId: "b" }]).categories;
    expect(alongside.find((c) => c.id === "mine").excluded).toBe(false);
    expect(alongside.at(-1).name).toBe("Transfers between accounts");
    expect(linkTransfers(list, cats, []).transactions).toBe(list);
  });
  it("unpairing uncategorizes both sides; 'not a transfer' is remembered on both", () => {
    const linked = linkTransfers(list, cats, [{ outId: "a", inId: "b" }]).transactions;
    const unlinked = unlinkTransfer(linked, "b");
    expect(unlinked.slice(0, 2).map((x) => [x.categoryId, x.transferWith])).toEqual([[null, undefined], [null, undefined]]);
    expect(unlinkTransfer(list, "c")).toBe(list);
    const dismissed = dismissTransferPair(list, { outId: "a", inId: "b" });
    expect([dismissed[0].notTransferWith, dismissed[1].notTransferWith]).toEqual([["b"], ["a"]]);
  });
  it("a deleted or recategorized side leaves the other unpaired", () => {
    const linked = linkTransfers(list, cats, [{ outId: "a", inId: "b" }]).transactions;
    expect(removeBrokenTransferLinks(linked)).toBe(linked); // intact pairs are left alone
    expect(removeBrokenTransferLinks(linked.filter((x) => x.id !== "b"))[0].transferWith).toBeUndefined();
    const recategorized = linked.map((x) => (x.id === "a" ? { ...x, categoryId: "groc" } : x));
    expect(removeBrokenTransferLinks(recategorized).slice(0, 2).map((x) => x.transferWith)).toEqual([undefined, undefined]);
  });
});
