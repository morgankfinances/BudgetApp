import { describe, it, expect, beforeEach } from "vitest";
import {
  getWeekStartISO, getMonthStartISO, formatWeekLabel, formatMonthLabel, WEEKS_PER_MONTH, monthlyEquivalent,
  REPORT_CONFIG_KEY, defaultReportPeriodConfig, loadReportPeriodConfig, saveReportPeriodConfig, addDaysISO, daysInMonth,
  getIntervalPeriodStartISO, formatIntervalLabel, getSemiMonthlyPeriodStartISO, formatSemiMonthlyLabel,
  periodFnsForConfig, addPeriod, enumeratePeriodsBetween,
} from "../periods.js";

describe("weeks and months", () => {
  it("weeks start on Sunday", () => {
    expect(getWeekStartISO("2026-09-25")).toBe("2026-09-20"); // Friday -> Sunday
    expect(getWeekStartISO("2026-09-20")).toBe("2026-09-20"); // Sunday stays
    expect(getWeekStartISO("2026-01-01")).toBe("2025-12-28"); // crosses the year
  });
  it("months key on the 1st", () => expect(getMonthStartISO("2026-09-25")).toBe("2026-09-01"));
  it("labels weeks and months", () => {
    expect(formatWeekLabel("2026-09-20")).toBe("Sep 20");
    expect(formatMonthLabel("2026-09-01")).toBe("Sep 2026");
  });
  it("converts weekly amounts to a monthly equivalent (52 weeks / 12 months)", () => {
    expect(WEEKS_PER_MONTH).toBeCloseTo(4.3333, 4);
    expect(monthlyEquivalent(100, "weekly")).toBeCloseTo(433.33, 2);
    expect(monthlyEquivalent(100, "monthly")).toBe(100);
    expect(monthlyEquivalent(null, "weekly")).toBe(0);
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("knows month lengths, including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
  it("steps by week or month", () => {
    expect(addPeriod("2026-09-20", "weekly")).toBe("2026-09-27");
    expect(addPeriod("2026-09-01", "monthly")).toBe("2026-10-01");
  });
  it("lists every period between two keys, inclusive", () => {
    expect(enumeratePeriodsBetween("2026-06-01", "2026-09-01", "monthly"))
      .toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(enumeratePeriodsBetween("2026-09-06", "2026-09-20", "weekly"))
      .toEqual(["2026-09-06", "2026-09-13", "2026-09-20"]);
    expect(enumeratePeriodsBetween("2026-09-01", "2026-09-01", "monthly")).toEqual(["2026-09-01"]);
  });
  it("always ends on the end key, even when it's off the step", () => {
    expect(enumeratePeriodsBetween("2026-09-01", "2026-09-15", "monthly")).toEqual(["2026-09-01", "2026-09-15"]);
  });
});

describe("every-X-days periods", () => {
  it("groups dates into blocks counted from the anchor date, before and after it", () => {
    expect(getIntervalPeriodStartISO("2026-09-01", "2026-09-01", 14)).toBe("2026-09-01");
    expect(getIntervalPeriodStartISO("2026-09-14", "2026-09-01", 14)).toBe("2026-09-01");
    expect(getIntervalPeriodStartISO("2026-09-15", "2026-09-01", 14)).toBe("2026-09-15");
    expect(getIntervalPeriodStartISO("2026-08-31", "2026-09-01", 14)).toBe("2026-08-18");
  });
  it("labels the block's date range", () => {
    expect(formatIntervalLabel("2026-09-01", 14)).toBe("Sep 1\u201314");
    expect(formatIntervalLabel("2026-09-25", 14)).toBe("Sep 25\u2013Oct 8");
  });
});

describe("twice-a-month periods", () => {
  it("splits each month at the two chosen days", () => {
    expect(getSemiMonthlyPeriodStartISO("2026-09-05", 1, 15)).toBe("2026-09-01");
    expect(getSemiMonthlyPeriodStartISO("2026-09-15", 1, 15)).toBe("2026-09-15");
    expect(getSemiMonthlyPeriodStartISO("2026-09-30", 1, 15)).toBe("2026-09-15");
  });
  it("dates before the first day belong to the previous month's second period", () => {
    expect(getSemiMonthlyPeriodStartISO("2026-09-03", 5, 20)).toBe("2026-08-20");
    expect(getSemiMonthlyPeriodStartISO("2026-01-03", 5, 20)).toBe("2025-12-20");
  });
  it("clamps days past a short month's end to its last day", () => {
    expect(getSemiMonthlyPeriodStartISO("2026-02-28", 15, 31)).toBe("2026-02-28");
    expect(getSemiMonthlyPeriodStartISO("2026-03-02", 15, 31)).toBe("2026-02-28");
  });
  it("labels each half", () => {
    expect(formatSemiMonthlyLabel("2026-09-01", 1, 15)).toBe("Sep 1\u201314");
    expect(formatSemiMonthlyLabel("2026-09-15", 1, 15)).toBe("Sep 15\u201330");
  });
});

describe("report period settings", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to monthly bar charts with nothing hidden", () => {
    const c = defaultReportPeriodConfig();
    expect(c).toMatchObject({ mode: "monthly", intervalDays: 14, chartType: "bar", hiddenCategories: [] });
  });
  it("saves and loads, filling in any settings added since", () => {
    saveReportPeriodConfig({ mode: "weekly" });
    expect(JSON.parse(localStorage.getItem(REPORT_CONFIG_KEY))).toEqual({ mode: "weekly" });
    expect(loadReportPeriodConfig()).toMatchObject({ mode: "weekly", chartType: "bar", hiddenCategories: [] });
  });
  it("recovers from missing or corrupted saved settings", () => {
    expect(loadReportPeriodConfig().mode).toBe("monthly");
    localStorage.setItem(REPORT_CONFIG_KEY, "{not json");
    expect(loadReportPeriodConfig().mode).toBe("monthly");
  });
  it("doesn't crash when storage is unavailable", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("private mode"); };
    expect(() => saveReportPeriodConfig({ mode: "weekly" })).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});

describe("periodFnsForConfig", () => {
  it("returns matching key and label functions for each mode", () => {
    expect(periodFnsForConfig({ mode: "weekly" }).keyFn("2026-09-25")).toBe("2026-09-20");
    expect(periodFnsForConfig({ mode: "monthly" }).labelFn("2026-09-01")).toBe("Sep 2026");
    const interval = periodFnsForConfig({ mode: "interval", anchorDate: "2026-09-01", intervalDays: 7 });
    expect(interval.keyFn("2026-09-09")).toBe("2026-09-08");
    expect(interval.labelFn("2026-09-08")).toBe("Sep 8\u201314");
    const semi = periodFnsForConfig({ mode: "semimonthly", semiMonthlyDay1: 20, semiMonthlyDay2: 5 });
    expect(semi.keyFn("2026-09-10")).toBe("2026-09-05"); // days given in either order
    expect(semi.labelFn("2026-09-05")).toBe("Sep 5\u201319");
  });
  it("falls back to sensible values for incomplete settings", () => {
    const interval = periodFnsForConfig({ mode: "interval", anchorDate: "2026-09-01", intervalDays: 0 });
    expect(interval.keyFn("2026-09-15")).toBe("2026-09-15"); // 14-day default
    expect(periodFnsForConfig({ mode: "interval" }).keyFn("2026-09-15")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodFnsForConfig({ mode: "semimonthly" }).keyFn("2026-09-20")).toBe("2026-09-15");
  });
});
