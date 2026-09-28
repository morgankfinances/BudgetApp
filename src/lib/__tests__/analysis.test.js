import { describe, it, expect } from "vitest";
import { computeDuplicates, buildCategorySuggestions } from "../analysis.js";

describe("computeDuplicates", () => {
  const tx = [
    { id: "a", date: "2026-09-05", amountOut: 24.23 },
    { id: "b", date: "2026-09-05", amountOut: 24.230, description: "different text" }, // same day, amount, direction
    { id: "c", date: "2026-09-05", amountIn: 24.23 },                                  // opposite direction: not a duplicate
    { id: "d", date: "2026-09-06", amountOut: 24.23 },                                 // different day
    { id: "e", date: "2026-09-05", amountOut: 24.23, notDuplicate: true },             // dismissed by the user
    { id: "f", date: null, amountOut: 1 },
    { id: "g", date: "2026-09-05" },
  ];
  const r = computeDuplicates(tx);
  it("flags transactions with the same date, amount, and direction, whatever the description", () => {
    expect([...r.dupIds].sort()).toEqual(["a", "b"]);
    expect(r.groupByKey["2026-09-05|24.23|out"]).toEqual(["a", "b"]);
    expect(r.keyByTxId.a).toBe("2026-09-05|24.23|out");
  });
  it("never re-flags a transaction the user marked as not a duplicate", () => expect(r.dupIds.has("e")).toBe(false));
  it("nothing to flag in an empty list", () => expect(computeDuplicates([]).dupIds.size).toBe(0));
});

describe("buildCategorySuggestions", () => {
  const categories = [{ id: "groc" }, { id: "dine" }];
  it("suggests the most common category among past transactions with the same description", () => {
    const tx = [
      { id: "1", description: "Thrifty Sprout", date: "2026-01-01", categoryId: "groc" },
      { id: "2", description: "thrifty sprout ", date: "2026-02-01", categoryId: "groc" }, // case and spacing ignored
      { id: "3", description: "Thrifty Sprout", date: "2026-03-01", categoryId: "dine" },
      { id: "new", description: "THRIFTY SPROUT", date: "2026-04-01", categoryId: null },
    ];
    expect(buildCategorySuggestions(tx, categories).get("new")).toBe("groc");
  });
  it("only the 10 most recent matches count", () => {
    const tx = Array.from({ length: 11 }, (_, i) => ({
      id: `o${i}`, description: "Shop", date: `2025-01-${String(i + 1).padStart(2, "0")}`, categoryId: i === 0 ? "dine" : "groc" }));
    tx.push({ id: "old-dine-1", description: "Shop", date: "2024-01-01", categoryId: "dine" });
    tx.push({ id: "new", description: "Shop", date: "2026-01-01", categoryId: null });
    expect(buildCategorySuggestions(tx, categories).get("new")).toBe("groc");
  });
  it("a tie goes to the most recent category", () => {
    const tx = [
      { id: "1", description: "Tied", date: "2026-01-01", categoryId: "groc" },
      { id: "2", description: "Tied", date: "2026-02-01", categoryId: "dine" },
      { id: "new", description: "Tied", categoryId: null },
    ];
    expect(buildCategorySuggestions(tx, categories).get("new")).toBe("dine");
  });
  it("sorts matches correctly when dates are equal", () => {
    const tx = [
      { id: "1", description: "Same", date: "2026-01-01", categoryId: "groc" },
      { id: "2", description: "Same", date: "2026-01-01", categoryId: "groc" },
      { id: "new", description: "Same", categoryId: null },
    ];
    expect(buildCategorySuggestions(tx, categories).get("new")).toBe("groc");
  });
  it("makes no suggestion without confirmed history, from deleted categories, or for blank descriptions", () => {
    const tx = [
      { id: "1", description: "Unsure", categoryId: null },
      { id: "2", description: "Old", date: "2026-01-01", categoryId: "deleted" },
      { id: "3", description: "", date: "2026-01-01", categoryId: "groc" },
      { id: "n1", description: "Unsure", categoryId: null },
      { id: "n2", description: "Old", categoryId: null },
      { id: "n3", description: "  ", categoryId: null },
      { id: "n4", categoryId: null },
    ];
    expect(buildCategorySuggestions(tx, categories).size).toBe(0);
  });
});

import { applyCategorySuggestions, withoutSuggestedFlag, isUnconfirmedSuggestion } from "../analysis.js";
describe("filling in suggested categories", () => {
  const cats = [{ id: "groc" }, { id: "dine" }];
  const history = [
    { id: "h1", description: "Thrifty Sprout", date: "2026-08-01", categoryId: "groc" },
    { id: "h2", description: "Thrifty Sprout", date: "2026-08-08", categoryId: "groc" },
  ];
  it("fills in the suggestion as a real category, marked as suggested", () => {
    const { transactions, applied } = applyCategorySuggestions([...history, { id: "n1", description: "THRIFTY SPROUT", categoryId: null }], cats);
    expect(applied).toBe(1);
    expect(transactions.find((t) => t.id === "n1")).toMatchObject({ categoryId: "groc", categorySuggested: true });
    expect(transactions.find((t) => t.id === "h1")).toBe(history[0]); // untouched items are the same objects
  });
  it("can be limited to certain transactions, such as the ones just imported", () => {
    const list = [...history, { id: "old", description: "Thrifty Sprout", categoryId: null }, { id: "new", description: "Thrifty Sprout", categoryId: null }];
    const { transactions, applied } = applyCategorySuggestions(list, cats, new Set(["new"]));
    expect(applied).toBe(1);
    expect(transactions.find((t) => t.id === "old").categoryId).toBeNull();
  });
  it("returns the same list when there's nothing to fill in", () => {
    const list = [{ id: "x", description: "Unknown shop", categoryId: null }];
    const result = applyCategorySuggestions(list, cats);
    expect(result.applied).toBe(0);
    expect(result.transactions).toBe(list);
  });
  it("never learns from its own unconfirmed suggestions", () => {
    const list = [
      { id: "s1", description: "Corner Cafe", date: "2026-08-01", categoryId: "dine", categorySuggested: true },
      { id: "n1", description: "Corner Cafe", categoryId: null },
    ];
    expect(applyCategorySuggestions(list, cats).applied).toBe(0);
    const confirmed = [withoutSuggestedFlag(list[0]), list[1]];
    expect(applyCategorySuggestions(confirmed, cats).applied).toBe(1);
  });
  it("tells unconfirmed suggestions apart, and confirming removes the mark", () => {
    const t = { id: "a", categoryId: "groc", categorySuggested: true };
    expect(isUnconfirmedSuggestion(t)).toBe(true);
    expect(isUnconfirmedSuggestion({ id: "b", categoryId: null, categorySuggested: true })).toBe(false);
    expect(withoutSuggestedFlag(t)).toEqual({ id: "a", categoryId: "groc" });
    const plain = { id: "c", categoryId: "groc" };
    expect(withoutSuggestedFlag(plain)).toBe(plain);
  });
});
