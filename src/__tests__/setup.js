// Shared setup for screen tests.
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
// Charts measure their container; the test browser has no layout engine.
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
// Screens that show "this month" etc. see a fixed date: Friday, September 25, 2026.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-25T12:00:00")); if (typeof localStorage !== "undefined") localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
// The test browser's File lacks text(); real browsers have it (used when
// reading an uploaded statement).
if (typeof File !== "undefined" && !File.prototype.text) {
  File.prototype.text = function () {
    return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(this); });
  };
}

// The test browser has no layout or scrolling, so charts measure 0×0 and
// window.scrollTo doesn't exist. Both are harmless here; keep them from
// burying real problems in the test output.
if (typeof window !== "undefined") window.scrollTo = () => {};
const CHART_SIZE_WARNING = "of chart should be greater than 0";
for (const level of ["warn", "error"]) {
  const original = console[level];
  console[level] = (...args) => {
    if (typeof args[0] === "string" && args[0].includes(CHART_SIZE_WARNING)) return;
    original(...args);
  };
}
