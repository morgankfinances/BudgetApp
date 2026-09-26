import { describe, it, expect } from "vitest";
import { uid, guessHeader, parseDateISO, parseMoney, formatMoney, formatDateDisplay } from "../utils.js";

describe("uid", () => {
  it("produces a different id every call", () => {
    const ids = new Set(Array.from({ length: 500 }, uid));
    expect(ids.size).toBe(500);
  });
});

describe("guessHeader", () => {
  const headers = ["Post Date", "Transaction Description", "Withdrawal", "Deposit"];
  it("finds a column by case-insensitive partial match, trying candidates in order", () => {
    expect(guessHeader(headers, ["date"])).toBe("Post Date");
    expect(guessHeader(headers, ["memo", "description"])).toBe("Transaction Description");
  });
  it("returns an empty string when nothing matches", () => {
    expect(guessHeader(headers, ["amount"])).toBe("");
  });
});

describe("parseDateISO", () => {
  it("accepts ISO dates", () => expect(parseDateISO("2026-09-05")).toBe("2026-09-05"));
  it("accepts US-style month/day/year", () => {
    expect(parseDateISO("9/5/2026")).toBe("2026-09-05");
    expect(parseDateISO("09-05-2026")).toBe("2026-09-05");
  });
  it("expands two-digit years (50 and under -> 2000s, above -> 1900s)", () => {
    expect(parseDateISO("9/5/26")).toBe("2026-09-05");
    expect(parseDateISO("9/5/99")).toBe("1999-09-05");
  });
  it("accepts Date objects (from spreadsheet cells)", () => {
    expect(parseDateISO(new Date(Date.UTC(2026, 1, 28)))).toBe("2026-02-28");
  });
  it("falls back to general date parsing for other formats", () => {
    expect(parseDateISO("Sep 5, 2026 12:00 UTC")).toBe("2026-09-05");
  });
  it("rejects impossible or missing dates", () => {
    expect(parseDateISO("")).toBeNull();
    expect(parseDateISO(null)).toBeNull();
    expect(parseDateISO("   ")).toBeNull();
    expect(parseDateISO("not a date")).toBeNull();
    expect(parseDateISO(new Date("garbage"))).toBeNull();
  });
});

describe("parseMoney", () => {
  it("parses plain, signed, and currency-formatted amounts", () => {
    expect(parseMoney("24.23")).toBe(24.23);
    expect(parseMoney("$1,100.00")).toBe(1100);
    expect(parseMoney("-50")).toBe(-50);
    expect(parseMoney("+12.5")).toBe(12.5);
    expect(parseMoney(" $ 3 ")).toBe(3);
  });
  it("treats accounting-style parentheses as negative", () => {
    expect(parseMoney("(237.98)")).toBe(-237.98);
  });
  it("passes real numbers through, rejecting infinities", () => {
    expect(parseMoney(42)).toBe(42);
    expect(parseMoney(Infinity)).toBeNull();
  });
  it("rejects blanks and non-amounts", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney("  ")).toBeNull();
    expect(parseMoney("12.3.4")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats money as US dollars, with a dash for nothing", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(-5)).toBe("-$5.00");
    expect(formatMoney(null)).toBe("—");
  });
  it("formats dates without shifting a day across time zones", () => {
    expect(formatDateDisplay("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDateDisplay("")).toBe("—");
  });
});

import { findNameClash } from "../utils.js";
describe("findNameClash", () => {
  const items = [{ id: "a", name: "Groceries" }, { id: "b", name: " Rent " }];
  it("finds an existing name ignoring capitalization and spaces, but not the item itself", () => {
    expect(findNameClash(items, "GROCERIES")).toBe(items[0]);
    expect(findNameClash(items, "rent")).toBe(items[1]);
    expect(findNameClash(items, "rent", "b")).toBeNull();
    expect(findNameClash(items, "Pets")).toBeNull();
    expect(findNameClash(items, "   ")).toBeNull();
    expect(findNameClash(null, "x")).toBeNull();
  });
});
