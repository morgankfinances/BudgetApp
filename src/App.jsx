import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { BarChart, Bar, PieChart, Pie, Cell, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ThemedLogo, ThemedStar, LoadingIndicator, DecoRing } from "./householdGate.jsx";

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "ledger-data-v1";

const VIEW_TITLES = {
  overview: "Overview",
  transactions: "Transactions",
  reports: "Reports",
  accounts: "Accounts",
  categories: "Categories",
  upload: "Upload",
  categorize: "Categorize import",
  backup: "Backup",
  planning: "Planning",
  budgetGroups: "Budget Groups",
  budget: "Budget",
};

/* ------------------------------------------------------------------ */
/* Concurrent-edit merge                                                */
/*                                                                      */
/* Two people can have this open at once. Rather than whoever saves    */
/* last silently overwriting the other's work, every save re-checks    */
/* the current remote data against the snapshot this client last saw   */
/* and, if it changed, does a 3-way merge (base / local / remote)      */
/* instead of a blind overwrite. Additions never collide (ids are      */
/* random), edits to different fields of the same item both survive,   */
/* and only a genuine same-field conflict falls back to "whichever     */
/* save wins the race" — and even then, only that one field is lost,   */
/* not the whole item or the whole save.                               */
/* ------------------------------------------------------------------ */

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

function indexById(arr) {
  const map = {};
  (arr || []).forEach((item) => {
    if (item && item.id != null) map[item.id] = item;
  });
  return map;
}

// A field that only ever grows or gets overwritten key-by-key
// (accumulateActuals: { periodKey: amount }). Respects an explicit
// removal by either side, though in practice this field only grows.
function mergeDict(base, local, remote) {
  base = base || {};
  local = local || {};
  remote = remote || {};
  const allKeys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const result = {};
  const conflicts = [];
  allKeys.forEach((k) => {
    const b = base[k], l = local[k], r = remote[k];
    if (deepEqual(l, r)) {
      if (l !== undefined) result[k] = l;
      return;
    }
    if (deepEqual(b, r)) {
      if (l !== undefined) result[k] = l;
      return;
    }
    if (deepEqual(b, l)) {
      if (r !== undefined) result[k] = r;
      return;
    }
    if (l !== undefined) result[k] = l;
    conflicts.push(k);
  });
  return { result, conflicts };
}

// A plain array of primitives treated as a set (categoryIds,
// hiddenBudgetMonths): independent adds union, independent removes
// both apply.
function mergeSet(base, local, remote) {
  const b = new Set(base || []);
  const l = new Set(local || []);
  const r = new Set(remote || []);
  const localAdded = [...l].filter((x) => !b.has(x));
  const localRemoved = [...b].filter((x) => !l.has(x));
  const remoteAdded = [...r].filter((x) => !b.has(x));
  const remoteRemoved = [...b].filter((x) => !r.has(x));
  const result = new Set(b);
  localAdded.forEach((x) => result.add(x));
  remoteAdded.forEach((x) => result.add(x));
  localRemoved.forEach((x) => result.delete(x));
  remoteRemoved.forEach((x) => result.delete(x));
  return [...result];
}

// An append-only log (fundAdjustments: [{date, amount}]). Take base,
// then append whatever each side added beyond it.
function mergeAppendLog(base, local, remote) {
  base = base || [];
  local = local || [];
  remote = remote || [];
  const basePrefixMatches = (arr) => arr.length >= base.length && base.every((e, i) => deepEqual(e, arr[i]));
  if (basePrefixMatches(local) && basePrefixMatches(remote)) {
    const localNew = local.slice(base.length);
    const remoteNew = remote.slice(base.length);
    return [...base, ...localNew, ...remoteNew].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  const seen = [];
  [...base, ...local, ...remote].forEach((entry) => {
    if (!seen.some((e) => deepEqual(e, entry))) seen.push(entry);
  });
  return seen.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const MERGE_SET_FIELDS = new Set(["categoryIds", "hiddenBudgetMonths"]);
const MERGE_DICT_FIELDS = new Set(["accumulateActuals"]);
const MERGE_LOG_FIELDS = new Set(["fundAdjustments"]);

function mergeItemFields(base, local, remote, conflictPath, conflicts) {
  const allFields = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
  const result = { ...(base || {}) };
  allFields.forEach((f) => {
    const b = (base || {})[f], l = (local || {})[f], r = (remote || {})[f];
    if (MERGE_SET_FIELDS.has(f)) {
      result[f] = mergeSet(b, l, r);
      return;
    }
    if (MERGE_DICT_FIELDS.has(f)) {
      const { result: merged, conflicts: dictConflicts } = mergeDict(b, l, r);
      result[f] = merged;
      dictConflicts.forEach((k) => conflicts.push(`${conflictPath}.${f}.${k}`));
      return;
    }
    if (MERGE_LOG_FIELDS.has(f)) {
      result[f] = mergeAppendLog(b, l, r);
      return;
    }
    if (deepEqual(l, r)) {
      result[f] = l;
      return;
    }
    if (deepEqual(b, r)) {
      result[f] = l;
      return;
    }
    if (deepEqual(b, l)) {
      result[f] = r;
      return;
    }
    result[f] = l;
    conflicts.push(`${conflictPath}.${f}`);
  });
  return result;
}

// An array of objects keyed by id (accounts, transactions, categories,
// budgetGroups).
function mergeCollection(collectionName, base, local, remote, conflicts) {
  const baseById = indexById(base);
  const localById = indexById(local);
  const remoteById = indexById(remote);
  const allIds = new Set([...Object.keys(baseById), ...Object.keys(localById), ...Object.keys(remoteById)]);
  const result = [];

  allIds.forEach((id) => {
    const b = baseById[id], l = localById[id], r = remoteById[id];
    if (!b) {
      if (l && r) {
        result.push(deepEqual(l, r) ? l : l);
        if (!deepEqual(l, r)) conflicts.push(`${collectionName}:${id}:both-added-differently`);
      } else if (l) {
        result.push(l);
      } else if (r) {
        result.push(r);
      }
      return;
    }
    const lDeleted = !l;
    const rDeleted = !r;
    if (lDeleted && rDeleted) return;
    if (lDeleted && !rDeleted) {
      if (deepEqual(b, r)) return;
      conflicts.push(`${collectionName}:${id}:deleted-locally-but-edited-remotely`);
      return;
    }
    if (rDeleted && !lDeleted) {
      if (deepEqual(b, l)) return;
      conflicts.push(`${collectionName}:${id}:edited-locally-but-deleted-remotely`);
      result.push(l);
      return;
    }
    if (deepEqual(l, r)) {
      result.push(l);
      return;
    }
    if (deepEqual(b, r)) {
      result.push(l);
      return;
    }
    if (deepEqual(b, l)) {
      result.push(r);
      return;
    }
    result.push(mergeItemFields(b, l, r, `${collectionName}:${id}`, conflicts));
  });

  return result;
}

const MERGE_COLLECTIONS = ["accounts", "transactions", "categories", "budgetGroups"];
const MERGE_SCALARS = ["plannedIncome", "incomeWarningDismissed", "excludeUnassignedFromBudget"];

function mergeLedgerData(base, local, remote) {
  const conflicts = [];
  const merged = {};

  MERGE_COLLECTIONS.forEach((key) => {
    merged[key] = mergeCollection(key, base[key] || [], local[key] || [], remote[key] || [], conflicts);
  });

  MERGE_SCALARS.forEach((key) => {
    const b = base[key], l = local[key], r = remote[key];
    if (deepEqual(l, r)) {
      merged[key] = l;
      return;
    }
    if (deepEqual(b, r)) {
      merged[key] = l;
      return;
    }
    if (deepEqual(b, l)) {
      merged[key] = r;
      return;
    }
    merged[key] = l;
    conflicts.push(key);
  });

  merged.hiddenBudgetMonths = mergeSet(base.hiddenBudgetMonths, local.hiddenBudgetMonths, remote.hiddenBudgetMonths);

  return { merged, conflicts };
}

const DEFAULT_CATEGORY_NAMES = [
  "Groceries",
  "Dining & Restaurants",
  "Transportation",
  "Bills & Utilities",
  "Shopping",
  "Entertainment",
  "Health",
  "Income",
  "Transfers",
];

function createDefaultCategories() {
  return DEFAULT_CATEGORY_NAMES.map((name) => ({ id: uid(), name, excluded: name === "Transfers" }));
}

// The subset of a loadData() result that actually gets merged/compared
// across clients — same shape either way, so this can be applied to
// both "what I just loaded" and "what I'm about to save."
function normalizeSnapshot(data) {
  return {
    accounts: data.accounts || [],
    transactions: data.transactions || [],
    categories: data.categories || [],
    budgetGroups: data.budgetGroups || [],
    plannedIncome: data.plannedIncome != null ? data.plannedIncome : null,
    incomeWarningDismissed: !!data.incomeWarningDismissed,
    hiddenBudgetMonths: data.hiddenBudgetMonths || [],
    excludeUnassignedFromBudget: !!data.excludeUnassignedFromBudget,
  };
}

async function loadData() {
  try {
    const res = await window.storage.get(STORAGE_KEY, false);
    if (res && res.value) {
      const parsed = JSON.parse(res.value);
      const categories = Array.isArray(parsed.categories) ? parsed.categories : createDefaultCategories();
      const budgetGroups = Array.isArray(parsed.budgetGroups) ? parsed.budgetGroups : [];
      const normalizeBudgetItem = (b) => ({
        ...b,
        budgetType: b.budgetType === "accumulate" ? "accumulate" : "spend",
        accumulateTarget: b.accumulateTarget != null ? b.accumulateTarget : null,
        accumulateActuals: b.accumulateActuals && typeof b.accumulateActuals === "object" ? b.accumulateActuals : {},
        fundAdjustments: Array.isArray(b.fundAdjustments) ? b.fundAdjustments : [],
      });
      return {
        accounts: parsed.accounts || [],
        transactions: parsed.transactions || [],
        categories: categories.map((c) => normalizeBudgetItem({ ...c, excluded: !!c.excluded, isIncome: !!c.isIncome })),
        budgetGroups: budgetGroups.map(normalizeBudgetItem),
        plannedIncome: parsed.plannedIncome != null ? parsed.plannedIncome : null,
        incomeWarningDismissed: !!parsed.incomeWarningDismissed,
        hiddenBudgetMonths: Array.isArray(parsed.hiddenBudgetMonths) ? parsed.hiddenBudgetMonths : [],
        excludeUnassignedFromBudget: !!parsed.excludeUnassignedFromBudget,
      };
    }
  } catch (e) {
    /* key doesn't exist yet on first run */
  }
  return {
    accounts: [],
    transactions: [],
    categories: createDefaultCategories(),
    budgetGroups: [],
    plannedIncome: null,
    incomeWarningDismissed: false,
    hiddenBudgetMonths: [],
    excludeUnassignedFromBudget: false,
  };
}

async function saveData(
  accounts,
  transactions,
  categories,
  budgetGroups,
  plannedIncome,
  incomeWarningDismissed,
  hiddenBudgetMonths,
  excludeUnassignedFromBudget
) {
  try {
    const result = await window.storage.set(
      STORAGE_KEY,
      JSON.stringify({
        accounts,
        transactions,
        categories,
        budgetGroups,
        plannedIncome,
        incomeWarningDismissed,
        hiddenBudgetMonths,
        excludeUnassignedFromBudget,
      }),
      false
    );
    return !!result;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function guessHeader(headers, candidates) {
  const lower = headers.map((h) => String(h).toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

function parseDateISO(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = (+yr > 50 ? "19" : "20") + yr;
    const d = new Date(Date.UTC(+yr, +mo - 1, +da));
    if (!isNaN(d.getTime()) && d.getUTCMonth() === +mo - 1) {
      return d.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function parseMoney(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  let str = String(value).trim();
  if (!str) return null;
  let negative = false;
  if (/^\(.*\)$/.test(str)) {
    negative = true;
    str = str.slice(1, -1);
  }
  str = str.replace(/[$,\s]/g, "");
  if (str.startsWith("-")) {
    negative = true;
    str = str.slice(1);
  } else if (str.startsWith("+")) {
    str = str.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

function formatMoney(n) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateDisplay(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getWeekStartISO(dateISO) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
  return dt.toISOString().slice(0, 10);
}

function getMonthStartISO(dateISO) {
  const [y, m] = dateISO.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function formatWeekLabel(weekStartISO) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatMonthLabel(monthStartISO) {
  const [y, m] = monthStartISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// The standard financial conversion for a weekly recurring amount to its
// monthly equivalent: 52 weeks / 12 months. Deliberately not x4 — over a
// full year x4 only accounts for 48 of the 52 weeks that actually happen,
// which would systematically under-count what a weekly budget costs
// annually. This is only used for the single-number income-allocation
// check; everywhere else weekly and monthly stay in their own lanes.
const WEEKS_PER_MONTH = 52 / 12;

function monthlyEquivalent(amount, period) {
  if (amount == null) return 0;
  return period === "weekly" ? amount * WEEKS_PER_MONTH : amount;
}

/* ------------------------------------------------------------------ */
/* Custom report periods                                                */
/*                                                                      */
/* A pay schedule isn't always weekly/monthly — biweekly and semi-      */
/* monthly (e.g. 1st & 15th, or any two custom days) are common enough  */
/* to support directly in Reports. This is a personal viewing           */
/* preference, not shared financial data, so it lives in this browser's */
/* localStorage rather than the synced household blob.                 */
/* ------------------------------------------------------------------ */

const REPORT_CONFIG_KEY = "ledger-report-period-config-v1";

function defaultReportPeriodConfig() {
  return {
    mode: "monthly", // "weekly" | "monthly" | "interval" | "semimonthly"
    intervalDays: 14,
    anchorDate: new Date().toISOString().slice(0, 10),
    semiMonthlyDay1: 1,
    semiMonthlyDay2: 15,
    chartType: "bar", // "bar" | "donut"
    hiddenCategories: [], // category ids hidden from the charts specifically — the table always shows everything
  };
}

function loadReportPeriodConfig() {
  try {
    const raw = window.localStorage.getItem(REPORT_CONFIG_KEY);
    if (!raw) return defaultReportPeriodConfig();
    const parsed = JSON.parse(raw);
    return { ...defaultReportPeriodConfig(), ...parsed };
  } catch (e) {
    return defaultReportPeriodConfig();
  }
}

function saveReportPeriodConfig(config) {
  try {
    window.localStorage.setItem(REPORT_CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    /* private browsing or storage disabled — the preference just won't persist */
  }
}

function addDaysISO(dateISO, days) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysInMonth(year, month1based) {
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

// Buckets a date into an N-day period counted from an anchor date —
// covers biweekly (14) and any other "every N days" cadence, extending
// correctly to dates before the anchor as well as after it.
function getIntervalPeriodStartISO(dateISO, anchorISO, intervalDays) {
  const [ay, am, ad] = anchorISO.split("-").map(Number);
  const anchorMs = Date.UTC(ay, am - 1, ad);
  const [y, m, d] = dateISO.split("-").map(Number);
  const dateMs = Date.UTC(y, m - 1, d);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((dateMs - anchorMs) / dayMs);
  const periodIndex = Math.floor(diffDays / intervalDays);
  const periodStartMs = anchorMs + periodIndex * intervalDays * dayMs;
  return new Date(periodStartMs).toISOString().slice(0, 10);
}

function formatIntervalLabel(startISO, intervalDays) {
  const endISO = addDaysISO(startISO, intervalDays - 1);
  const [ys, ms, ds] = startISO.split("-").map(Number);
  const [ye, me, de] = endISO.split("-").map(Number);
  const startDt = new Date(Date.UTC(ys, ms - 1, ds));
  const endDt = new Date(Date.UTC(ye, me - 1, de));
  const startStr = startDt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endStr =
    ys === ye && ms === me
      ? endDt.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })
      : endDt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${startStr}\u2013${endStr}`;
}

// Buckets a date into one of two custom sub-periods each month (e.g.
// 1st & 15th, or any other pair of cutoff days), clamping a cutoff
// beyond a short month (like the 31st in February) to that month's
// actual last day.
function getSemiMonthlyPeriodStartISO(dateISO, day1, day2) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dim = daysInMonth(y, m);
  const cd1 = Math.min(day1, dim);
  const cd2 = Math.min(day2, dim);
  if (d < cd1) {
    let py = y, pm = m - 1;
    if (pm === 0) {
      pm = 12;
      py = y - 1;
    }
    const pcd2 = Math.min(day2, daysInMonth(py, pm));
    return `${py}-${String(pm).padStart(2, "0")}-${String(pcd2).padStart(2, "0")}`;
  }
  if (d < cd2) {
    return `${y}-${String(m).padStart(2, "0")}-${String(cd1).padStart(2, "0")}`;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(cd2).padStart(2, "0")}`;
}

function formatSemiMonthlyLabel(periodStartISO, day1, day2) {
  const [y, m, d] = periodStartISO.split("-").map(Number);
  const dim = daysInMonth(y, m);
  const cd1 = Math.min(day1, dim);
  const cd2 = Math.min(day2, dim);
  const endDay = d === cd1 ? cd2 - 1 : dim;
  const startDt = new Date(Date.UTC(y, m - 1, d));
  const endDt = new Date(Date.UTC(y, m - 1, Math.max(endDay, d)));
  const startStr = startDt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endStr = endDt.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  return `${startStr}\u2013${endStr}`;
}

function periodFnsForConfig(config) {
  if (config.mode === "weekly") {
    return { keyFn: getWeekStartISO, labelFn: formatWeekLabel };
  }
  if (config.mode === "interval") {
    const anchor = config.anchorDate || defaultReportPeriodConfig().anchorDate;
    const days = config.intervalDays && config.intervalDays > 0 ? config.intervalDays : 14;
    return {
      keyFn: (dateISO) => getIntervalPeriodStartISO(dateISO, anchor, days),
      labelFn: (startISO) => formatIntervalLabel(startISO, days),
    };
  }
  if (config.mode === "semimonthly") {
    const d1 = Math.min(config.semiMonthlyDay1 || 1, config.semiMonthlyDay2 || 15);
    const d2 = Math.max(config.semiMonthlyDay1 || 1, config.semiMonthlyDay2 || 15);
    return {
      keyFn: (dateISO) => getSemiMonthlyPeriodStartISO(dateISO, d1, d2),
      labelFn: (startISO) => formatSemiMonthlyLabel(startISO, d1, d2),
    };
  }
  return { keyFn: getMonthStartISO, labelFn: formatMonthLabel };
}

function addPeriod(dateISO, periodType) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (periodType === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}

// Every period key from startKey through endKey (inclusive), stepping by
// the given cadence. Capped as a safety net against a runaway loop from
// a malformed date.
function enumeratePeriodsBetween(startKey, endKey, periodType) {
  const periods = [];
  let cursor = startKey;
  let guard = 0;
  while (cursor <= endKey && guard < 1200) {
    periods.push(cursor);
    cursor = addPeriod(cursor, periodType);
    guard++;
  }
  if (periods.length === 0 || periods[periods.length - 1] !== endKey) periods.push(endKey);
  return periods;
}

const CHART_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
];

function computeBudgetPeriodData(transactions, budgetItems, periodType) {
  const periodKeyFn = periodType === "weekly" ? getWeekStartISO : getMonthStartISO;
  const budgeted = budgetItems.filter((b) => {
    if ((b.budgetPeriod || "monthly") !== periodType) return false;
    if (b.isUnassignedPseudo) return true;
    return b.budgetAmount != null && b.budgetAmount > 0;
  });
  if (budgeted.length === 0) return null;

  const currentKey = periodKeyFn(new Date().toISOString().slice(0, 10));
  const spendMap = {};
  const periodSet = new Set([currentKey]);

  const spendItems = budgeted.filter((b) => b.budgetType !== "accumulate");
  transactions.forEach((t) => {
    if (!t.categoryId || !t.date) return;
    const pKey = periodKeyFn(t.budgetPeriodOverride || t.date);
    const spent = (t.amountOut || 0) - (t.amountIn || 0);
    spendItems.forEach((b) => {
      if (b.categoryIds.has(t.categoryId)) {
        periodSet.add(pKey);
        if (!spendMap[b.id]) spendMap[b.id] = {};
        spendMap[b.id][pKey] = (spendMap[b.id][pKey] || 0) + spent;
      }
    });
  });

  // Accumulate items don't derive from transactions at all — each period
  // defaults to "the full planned contribution happened," unless the user
  // has explicitly logged what was actually set aside that period.
  const accumulateItems = budgeted.filter((b) => b.budgetType === "accumulate");
  accumulateItems.forEach((b) => {
    const startKey = b.createdAt ? periodKeyFn(b.createdAt.slice(0, 10)) : currentKey;
    const itemPeriods = enumeratePeriodsBetween(startKey, currentKey, periodType);
    Object.keys(b.accumulateActuals || {}).forEach((k) => {
      if (!itemPeriods.includes(k)) itemPeriods.push(k);
    });
    spendMap[b.id] = {};
    itemPeriods.forEach((pKey) => {
      periodSet.add(pKey);
      const override = (b.accumulateActuals || {})[pKey];
      spendMap[b.id][pKey] = override != null ? override : b.budgetAmount;
    });
  });

  const periods = Array.from(periodSet).sort();

  return { budgeted, periods, spendMap, currentKey };
}


async function readFileAsRows(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    const headers = result.meta.fields || [];
    return { headers, rows: result.data };
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { headers, rows };
  }
  throw new Error("Unsupported file type. Please upload a .csv or .xlsx file.");
}

function mapRow(row, mapping) {
  const dateRaw = mapping.dateCol ? row[mapping.dateCol] : null;
  const date = parseDateISO(dateRaw);
  const reasons = [];
  if (!date) reasons.push("unrecognized date");

  const description = mapping.descriptionCol
    ? String(row[mapping.descriptionCol] != null ? row[mapping.descriptionCol] : "").trim()
    : "";

  let amountOut = null;
  let amountIn = null;
  const sameCol = mapping.outCol && mapping.inCol && mapping.outCol === mapping.inCol;

  if (sameCol) {
    const raw = row[mapping.outCol];
    if (raw !== "" && raw != null) {
      const parsed = parseMoney(raw);
      if (parsed === null) reasons.push("unrecognized amount value");
      else if (parsed < 0) {
        if (mapping.invertSign) amountIn = Math.abs(parsed);
        else amountOut = Math.abs(parsed);
      } else if (parsed > 0) {
        if (mapping.invertSign) amountOut = parsed;
        else amountIn = parsed;
      }
    }
  } else {
    if (mapping.outCol) {
      const raw = row[mapping.outCol];
      if (raw !== "" && raw != null) {
        const parsed = parseMoney(raw);
        if (parsed === null) reasons.push("unrecognized money-out value");
        else if (parsed !== 0) amountOut = Math.abs(parsed);
      }
    }
    if (mapping.inCol) {
      const raw = row[mapping.inCol];
      if (raw !== "" && raw != null) {
        const parsed = parseMoney(raw);
        if (parsed === null) reasons.push("unrecognized money-in value");
        else if (parsed !== 0) amountIn = parsed;
      }
    }
  }

  if (amountOut == null && amountIn == null && reasons.length === 0) {
    reasons.push("no amount in either column");
  }

  return { date, description, amountOut, amountIn, reasons };
}

function buildTransactions(rows, mapping, accountId, accountName, uploadBatchId) {
  const valid = [];
  const invalid = [];
  const uploadedAt = new Date().toISOString();

  rows.forEach((row, idx) => {
    const { date, description, amountOut, amountIn, reasons } = mapRow(row, mapping);

    if (reasons.length > 0) {
      invalid.push({ rowIndex: idx, raw: row, reasons });
    } else {
      valid.push({
        id: uid(),
        accountId,
        accountName,
        date,
        description,
        amountOut,
        amountIn,
        categoryId: null,
        raw: row,
        uploadedAt,
        uploadBatchId,
      });
    }
  });

  return { valid, invalid };
}

/* ------------------------------------------------------------------ */
/* Full backup: export everything to one CSV, and rebuild from one     */
/* ------------------------------------------------------------------ */

const BACKUP_COLUMNS = [
  "Account",
  "Date",
  "Description",
  "Money Out",
  "Money In",
  "Category",
  "Category Excluded",
  "Category Income",
  "Uploaded At",
  "Upload Batch",
  "Not A Duplicate",
  "Counts Toward Period",
];

function exportBackupCSV(accounts, transactions, categories) {
  const categoryById = {};
  categories.forEach((c) => {
    categoryById[c.id] = c;
  });

  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const rows = sorted.map((t) => {
    const cat = t.categoryId ? categoryById[t.categoryId] : null;
    return {
      Account: t.accountName || "",
      Date: t.date || "",
      Description: t.description || "",
      "Money Out": t.amountOut != null ? t.amountOut : "",
      "Money In": t.amountIn != null ? t.amountIn : "",
      Category: cat ? cat.name : "",
      "Category Excluded": cat ? (cat.excluded ? "Yes" : "No") : "",
      "Category Income": cat ? (cat.isIncome ? "Yes" : "No") : "",
      "Uploaded At": t.uploadedAt || "",
      "Upload Batch": t.uploadBatchId || "",
      "Not A Duplicate": t.notDuplicate ? "Yes" : "No",
      "Counts Toward Period": t.budgetPeriodOverride || "",
    };
  });

  const csv = Papa.unparse(rows, { columns: BACKUP_COLUMNS });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildFromBackupRows(rows) {
  const accountsByName = {};
  const categoriesByName = {};
  const transactions = [];
  const invalid = [];

  rows.forEach((row, idx) => {
    const accountName = String(row["Account"] != null ? row["Account"] : "").trim();
    const date = parseDateISO(row["Date"]);
    const description = String(row["Description"] != null ? row["Description"] : "").trim();
    const categoryName = String(row["Category"] != null ? row["Category"] : "").trim();
    const categoryExcludedRaw = String(row["Category Excluded"] != null ? row["Category Excluded"] : "")
      .trim()
      .toLowerCase();
    const categoryIncomeRaw = String(row["Category Income"] != null ? row["Category Income"] : "")
      .trim()
      .toLowerCase();

    const reasons = [];
    if (!accountName) reasons.push("missing account name");
    if (!date) reasons.push("unrecognized date");

    let amountOut = null;
    let amountIn = null;
    const outRaw = row["Money Out"];
    const inRaw = row["Money In"];
    if (outRaw !== "" && outRaw != null) {
      const parsed = parseMoney(outRaw);
      if (parsed === null) reasons.push("unrecognized money-out value");
      else if (parsed !== 0) amountOut = Math.abs(parsed);
    }
    if (inRaw !== "" && inRaw != null) {
      const parsed = parseMoney(inRaw);
      if (parsed === null) reasons.push("unrecognized money-in value");
      else if (parsed !== 0) amountIn = parsed;
    }
    if (amountOut == null && amountIn == null && reasons.length === 0) {
      reasons.push("no amount in either column");
    }

    if (reasons.length > 0) {
      invalid.push({ rowIndex: idx, raw: row, reasons });
      return;
    }

    if (!accountsByName[accountName]) {
      accountsByName[accountName] = {
        id: uid(),
        name: accountName,
        dateCol: "",
        descriptionCol: "",
        outCol: "",
        inCol: "",
        invertSign: false,
        createdAt: new Date().toISOString(),
      };
    }
    const account = accountsByName[accountName];

    let categoryId = null;
    if (categoryName) {
      if (!categoriesByName[categoryName]) {
        categoriesByName[categoryName] = {
          id: uid(),
          name: categoryName,
          excluded: categoryExcludedRaw === "yes",
          isIncome: categoryIncomeRaw === "yes",
        };
      }
      categoryId = categoriesByName[categoryName].id;
    }

    transactions.push({
      id: uid(),
      accountId: account.id,
      accountName: account.name,
      date,
      description,
      amountOut,
      amountIn,
      categoryId,
      raw: row,
      uploadedAt: row["Uploaded At"] || undefined,
      uploadBatchId: row["Upload Batch"] || undefined,
      notDuplicate: String(row["Not A Duplicate"] || "").trim().toLowerCase() === "yes",
      budgetPeriodOverride: row["Counts Toward Period"] || undefined,
    });
  });

  return {
    accounts: Object.values(accountsByName),
    categories: Object.values(categoriesByName),
    transactions,
    invalid,
  };
}

/* ------------------------------------------------------------------ */
/* Budget backup: export budget setup to one CSV, and apply one back   */
/* ------------------------------------------------------------------ */

const BUDGET_BACKUP_COLUMNS = [
  "Row Type",
  "Item Type",
  "Name",
  "Budget Amount",
  "Budget Period",
  "Budget Type",
  "Accumulate Target",
  "Group",
  "Members",
  "Period",
  "Amount",
];

function exportBudgetCSV(categories, budgetGroups, plannedIncome) {
  const rows = [];

  rows.push({
    "Row Type": "Settings",
    "Item Type": "",
    Name: "Planned Monthly Income",
    "Budget Amount": "",
    "Budget Period": "",
    "Budget Type": "",
    "Accumulate Target": "",
    Group: "",
    Members: "",
    Period: "",
    Amount: plannedIncome != null ? plannedIncome : "",
  });

  const groupNameByCategoryId = {};
  budgetGroups.forEach((g) => {
    (g.categoryIds || []).forEach((id) => {
      groupNameByCategoryId[id] = g.name;
    });
  });

  categories.forEach((c) => {
    rows.push({
      "Row Type": "Category",
      "Item Type": "Category",
      Name: c.name,
      "Budget Amount": c.budgetAmount != null ? c.budgetAmount : "",
      "Budget Period": c.budgetAmount != null ? c.budgetPeriod || "monthly" : "",
      "Budget Type": c.budgetAmount != null ? (c.budgetType === "accumulate" ? "Accumulate" : "Spend") : "",
      "Accumulate Target": c.accumulateTarget != null ? c.accumulateTarget : "",
      Group: groupNameByCategoryId[c.id] || "",
      Members: "",
      Period: "",
      Amount: "",
    });
  });

  budgetGroups.forEach((g) => {
    const memberNames = (g.categoryIds || [])
      .map((id) => categories.find((c) => c.id === id)?.name)
      .filter(Boolean);
    rows.push({
      "Row Type": "Group",
      "Item Type": "Group",
      Name: g.name,
      "Budget Amount": g.budgetAmount != null ? g.budgetAmount : "",
      "Budget Period": g.budgetAmount != null ? g.budgetPeriod || "monthly" : "",
      "Budget Type": g.budgetAmount != null ? (g.budgetType === "accumulate" ? "Accumulate" : "Spend") : "",
      "Accumulate Target": g.accumulateTarget != null ? g.accumulateTarget : "",
      Group: "",
      Members: memberNames.join("|"),
      Period: "",
      Amount: "",
    });
  });

  const pushOverrides = (item, itemType) => {
    Object.entries(item.accumulateActuals || {}).forEach(([period, amount]) => {
      rows.push({
        "Row Type": "Override",
        "Item Type": itemType,
        Name: item.name,
        "Budget Amount": "",
        "Budget Period": "",
        "Budget Type": "",
        "Accumulate Target": "",
        Group: "",
        Members: "",
        Period: period,
        Amount: amount,
      });
    });
    (item.fundAdjustments || []).forEach((adj) => {
      rows.push({
        "Row Type": "FundAdjustment",
        "Item Type": itemType,
        Name: item.name,
        "Budget Amount": "",
        "Budget Period": "",
        "Budget Type": "",
        "Accumulate Target": "",
        Group: "",
        Members: "",
        Period: adj.date,
        Amount: adj.amount,
      });
    });
  };
  categories.forEach((c) => pushOverrides(c, "Category"));
  budgetGroups.forEach((g) => pushOverrides(g, "Group"));

  const csv = Papa.unparse(rows, { columns: BUDGET_BACKUP_COLUMNS });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildBudgetFromRows(rows, currentCategories, currentBudgetGroups) {
  let plannedIncome = null;
  const categoryUpdates = {};
  const groupDefs = {};
  const categoryOverrides = {};
  const groupOverrides = {};
  const categoryFundAdjustments = {};
  const groupFundAdjustments = {};
  const invalid = [];

  const normPeriod = (v) => (String(v || "").trim().toLowerCase() === "weekly" ? "weekly" : "monthly");
  const normType = (v) => (String(v || "").trim().toLowerCase() === "accumulate" ? "accumulate" : "spend");

  rows.forEach((row, idx) => {
    const rowType = String(row["Row Type"] || "").trim();
    if (!rowType) return;

    if (rowType === "Settings") {
      const amt = parseMoney(row["Amount"]);
      if (amt != null) plannedIncome = amt;
    } else if (rowType === "Category") {
      const name = String(row["Name"] || "").trim();
      if (!name) {
        invalid.push({ rowIndex: idx, reasons: ["missing category name"] });
        return;
      }
      const rawAmount = row["Budget Amount"];
      categoryUpdates[name] = {
        budgetAmount: rawAmount !== "" && rawAmount != null ? parseMoney(rawAmount) : null,
        budgetPeriod: normPeriod(row["Budget Period"]),
        budgetType: normType(row["Budget Type"]),
        accumulateTarget: row["Accumulate Target"] !== "" && row["Accumulate Target"] != null ? parseMoney(row["Accumulate Target"]) : null,
      };
    } else if (rowType === "Group") {
      const name = String(row["Name"] || "").trim();
      if (!name) {
        invalid.push({ rowIndex: idx, reasons: ["missing group name"] });
        return;
      }
      const rawAmount = row["Budget Amount"];
      const members = String(row["Members"] || "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      groupDefs[name] = {
        budgetAmount: rawAmount !== "" && rawAmount != null ? parseMoney(rawAmount) : null,
        budgetPeriod: normPeriod(row["Budget Period"]),
        budgetType: normType(row["Budget Type"]),
        accumulateTarget: row["Accumulate Target"] !== "" && row["Accumulate Target"] != null ? parseMoney(row["Accumulate Target"]) : null,
        memberNames: members,
      };
    } else if (rowType === "Override") {
      const itemType = String(row["Item Type"] || "").trim();
      const name = String(row["Name"] || "").trim();
      let period = String(row["Period"] || "").trim();
      // A bare "YYYY-MM" (no day) looks equivalent to "YYYY-MM-01" to a
      // person, but as a stored key it isn't — the rest of the app always
      // keys monthly periods by the 1st, so an ungenerous typo like this
      // would silently create a second, invisible-looking "duplicate"
      // period alongside the real one instead of matching it.
      if (/^\d{4}-\d{2}$/.test(period)) period = `${period}-01`;
      const amt = parseMoney(row["Amount"]);
      if (name && period && amt != null) {
        const bucket = itemType === "Group" ? groupOverrides : categoryOverrides;
        if (!bucket[name]) bucket[name] = {};
        bucket[name][period] = amt;
      } else {
        invalid.push({ rowIndex: idx, reasons: ["incomplete override row"] });
      }
    } else if (rowType === "FundAdjustment") {
      const itemType = String(row["Item Type"] || "").trim();
      const name = String(row["Name"] || "").trim();
      const date = String(row["Period"] || "").trim();
      const amt = parseMoney(row["Amount"]);
      if (name && date && amt != null) {
        const bucket = itemType === "Group" ? groupFundAdjustments : categoryFundAdjustments;
        if (!bucket[name]) bucket[name] = [];
        bucket[name].push({ date, amount: amt });
      } else {
        invalid.push({ rowIndex: idx, reasons: ["incomplete fund adjustment row"] });
      }
    } else {
      invalid.push({ rowIndex: idx, reasons: [`unrecognized row type "${rowType}"`] });
    }
  });

  const existingCategoryNames = new Set(currentCategories.map((c) => c.name));
  const updatedExistingCategories = currentCategories.map((c) => {
    const upd = categoryUpdates[c.name];
    if (!upd) return c;
    return {
      ...c,
      budgetAmount: upd.budgetAmount,
      budgetPeriod: upd.budgetPeriod,
      budgetType: upd.budgetType,
      accumulateTarget: upd.accumulateTarget,
      accumulateActuals: categoryOverrides[c.name] || c.accumulateActuals || {},
      fundAdjustments: categoryFundAdjustments[c.name] || c.fundAdjustments || [],
    };
  });
  const newCategoryEntries = Object.keys(categoryUpdates)
    .filter((name) => !existingCategoryNames.has(name))
    .map((name) => {
      const upd = categoryUpdates[name];
      return {
        id: uid(),
        name,
        excluded: false,
        budgetAmount: upd.budgetAmount,
        budgetPeriod: upd.budgetPeriod,
        budgetType: upd.budgetType,
        accumulateTarget: upd.accumulateTarget,
        accumulateActuals: categoryOverrides[name] || {},
        fundAdjustments: categoryFundAdjustments[name] || [],
        createdAt: new Date().toISOString(),
      };
    });
  const nextCategories = [...updatedExistingCategories, ...newCategoryEntries];

  const nameToId = {};
  nextCategories.forEach((c) => {
    nameToId[c.name] = c.id;
  });

  const existingGroupNames = new Set(currentBudgetGroups.map((g) => g.name));
  const updatedExistingGroups = currentBudgetGroups.map((g) => {
    const def = groupDefs[g.name];
    if (!def) return g;
    return {
      ...g,
      budgetAmount: def.budgetAmount,
      budgetPeriod: def.budgetPeriod,
      budgetType: def.budgetType,
      accumulateTarget: def.accumulateTarget,
      categoryIds: def.memberNames.map((n) => nameToId[n]).filter(Boolean),
      accumulateActuals: groupOverrides[g.name] || g.accumulateActuals || {},
      fundAdjustments: groupFundAdjustments[g.name] || g.fundAdjustments || [],
    };
  });
  const newGroupEntries = Object.keys(groupDefs)
    .filter((name) => !existingGroupNames.has(name))
    .map((name) => {
      const def = groupDefs[name];
      return {
        id: uid(),
        name,
        budgetAmount: def.budgetAmount,
        budgetPeriod: def.budgetPeriod,
        budgetType: def.budgetType,
        accumulateTarget: def.accumulateTarget,
        categoryIds: def.memberNames.map((n) => nameToId[n]).filter(Boolean),
        accumulateActuals: groupOverrides[name] || {},
        fundAdjustments: groupFundAdjustments[name] || [],
        createdAt: new Date().toISOString(),
      };
    });
  const nextBudgetGroups = [...updatedExistingGroups, ...newGroupEntries];

  return {
    plannedIncome,
    categories: nextCategories,
    budgetGroups: nextBudgetGroups,
    invalid,
    categoryCount: Object.keys(categoryUpdates).length,
    groupCount: Object.keys(groupDefs).length,
  };
}

function computeDuplicates(transactions) {
  const map = {};
  transactions.forEach((t) => {
    if (t.notDuplicate) return; // explicitly dismissed by the user — never re-flag
    const amt = t.amountOut != null ? t.amountOut : t.amountIn;
    if (amt == null || !t.date) return;
    const direction = t.amountOut != null ? "out" : "in";
    const key = `${t.date}|${Math.abs(amt).toFixed(2)}|${direction}`;
    if (!map[key]) map[key] = [];
    map[key].push(t.id);
  });
  const dupIds = new Set();
  const groupByKey = {};
  const keyByTxId = {};
  Object.entries(map).forEach(([key, ids]) => {
    if (ids.length > 1) {
      ids.forEach((id) => {
        dupIds.add(id);
        keyByTxId[id] = key;
      });
      groupByKey[key] = ids;
    }
  });
  return { dupIds, groupByKey, keyByTxId };
}

// For every currently-uncategorized transaction, suggest a category based
// on the most common category among the 10 most recent OTHER transactions
// that share the exact same (trimmed, case-insensitive) description and
// are themselves confirmed — actually categorized by a person, not just
// carrying an earlier unconfirmed suggestion. That last part matters: if
// a wrong guess could feed the next guess, mistakes would compound
// instead of getting corrected. This never touches categoryId itself —
// it's a pure, read-only suggestion the UI overlays on top of a
// genuinely uncategorized transaction, so nothing here changes what
// counts as "uncategorized" anywhere else in the app until a person
// actually confirms it.
function buildCategorySuggestions(transactions, categories) {
  const validCategoryIds = new Set(categories.map((c) => c.id));
  const byDescription = new Map();
  transactions.forEach((t) => {
    if (!t.categoryId || !validCategoryIds.has(t.categoryId)) return;
    const norm = (t.description || "").trim().toLowerCase();
    if (!norm) return;
    if (!byDescription.has(norm)) byDescription.set(norm, []);
    byDescription.get(norm).push(t);
  });
  byDescription.forEach((list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));

  const suggestionByTxnId = new Map();
  transactions.forEach((t) => {
    if (t.categoryId) return;
    const norm = (t.description || "").trim().toLowerCase();
    if (!norm) return;
    const candidates = (byDescription.get(norm) || []).slice(0, 10);
    if (candidates.length === 0) return;
    const counts = {};
    candidates.forEach((c) => {
      counts[c.categoryId] = (counts[c.categoryId] || 0) + 1;
    });
    let best = null;
    let bestCount = 0;
    candidates.forEach((c) => {
      const n = counts[c.categoryId];
      if (n > bestCount) {
        bestCount = n;
        best = c.categoryId;
      }
    });
    if (best) suggestionByTxnId.set(t.id, best);
  });
  return suggestionByTxnId;
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600;700&display=swap');

/* Neutralizes the default Vite template's #root centering (max-width /
   margin: 0 auto / padding), which otherwise boxes this whole app into a
   fixed-width column regardless of anything set below. */
#root {
  max-width: none;
  margin: 0;
  padding: 0;
  text-align: left;
  width: 100%;
}

/* Theme variables live on :root (the <html> element), not scoped to
   .ledger-root — HouseholdGate.jsx renders its own UI (the floating
   Settings button, panel, and pre-household screens) as a DOM sibling
   of .ledger-root, not a descendant, so anything scoped to .ledger-root
   wouldn't be visible there. :root is visible everywhere. HouseholdGate
   owns the actual theme state and sets data-theme on <html> directly;
   this file only needs to read the resulting variables. */

:root {
  --bg: #F5F6F1;
  --panel: #FFFFFF;
  --ink: #1E241F;
  --ink-muted: #62685E;
  --border: #DAD9CC;
  --accent: #C2661E;
  --accent-hover: #9C4F15;
  --accent-tint: #F7E9DC;
  --income: #3F7D5C;
  --expense: #AC4A2C;
  --warn-bg: #FBF1DA;
  --warn-border: #E3B558;
  --warn-ink: #8A5A15;
  --danger: #A6392B;
  --danger-tint-bg: #FBEAE6;
  --danger-tint-border: #E3A190;
  --subtle-bg: #F2F1E9;
  --chart-1: #3B5BA0;
  --chart-2: #3F7D5C;
  --chart-3: #AC4A2C;
  --chart-4: #8A5A15;
  --chart-5: #6B5B95;
  --chart-6: #2E8B8B;
  --chart-7: #9C4F6E;
  --chart-other: #8C8C86;
  --radius: 6px;
}

:root[data-theme="light-slate"] {
  --bg: #F3F5F8;
  --panel: #FFFFFF;
  --ink: #1C2430;
  --ink-muted: #5B6675;
  --border: #D6DCE3;
  --accent: #2B6CB0;
  --accent-hover: #1E5490;
  --accent-tint: #E7EFF8;
  --income: #2F8F6F;
  --expense: #C1502F;
  --warn-bg: #FCF3D9;
  --warn-border: #DDAE3E;
  --warn-ink: #7A5A0D;
  --danger: #B0402E;
  --danger-tint-bg: #FBEAE6;
  --danger-tint-border: #E0AA98;
  --subtle-bg: #EDF0F4;
  --chart-1: #2B6CB0;
  --chart-2: #2F8F6F;
  --chart-3: #C1502F;
  --chart-4: #9C7A1E;
  --chart-5: #6857A0;
  --chart-6: #2593A0;
  --chart-7: #A84B78;
  --chart-other: #8890A0;
}

:root[data-theme="dark-midnight"] {
  --bg: #10131B;
  --panel: #1B2030;
  --ink: #E7E9F1;
  --ink-muted: #9BA3B5;
  --border: #2C3346;
  --accent: #7B9EE0;
  --accent-hover: #9AB6EA;
  --accent-tint: #232A42;
  --income: #6FCB9A;
  --expense: #E2896A;
  --warn-bg: #3B301A;
  --warn-border: #C99A3E;
  --warn-ink: #EAC581;
  --danger: #E2685A;
  --danger-tint-bg: #3A2420;
  --danger-tint-border: #7A4038;
  --subtle-bg: #242A3D;
  --chart-1: #7B9EE0;
  --chart-2: #6FCB9A;
  --chart-3: #E2896A;
  --chart-4: #D9A94E;
  --chart-5: #A99AE0;
  --chart-6: #5FC4C4;
  --chart-7: #E08FB0;
  --chart-other: #7C879C;
}

.ledger-root {
  isolation: isolate;
  font-family: 'Work Sans', -apple-system, sans-serif;
  color: var(--ink);
  background: var(--bg);
  min-height: 100vh;
  font-variant-numeric: tabular-nums;
}

.ledger-root * { box-sizing: border-box; }

/* Safety net: form controls don't reliably inherit color/background from
   the page in every browser (this is exactly the "bright white input on
   a dark theme" bug) — every input/select/textarea/button gets an
   explicit theme-correct baseline here. Anything with a more specific
   rule elsewhere (e.g. .btn-primary's own background) still wins, since
   these are plain element selectors with low specificity. */
.ledger-root input, .ledger-root select, .ledger-root textarea, .ledger-root button {
  font-family: inherit;
  color: var(--ink);
}
.ledger-root input, .ledger-root select, .ledger-root textarea {
  background: var(--panel);
}

.ledger-root h1, .ledger-root h2, .ledger-root h3 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  margin: 0;
  letter-spacing: -0.01em;
}

.app-shell {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.sidebar-brand {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 19px;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  line-height: 1.25;
  word-break: break-word;
}

.sidebar-brand-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nav-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-muted);
  font-weight: 600;
  padding: 6px 10px 4px;
}
.sidebar-nav-label:first-child { padding-top: 2px; }

.sidebar-section-divider {
  border-top: 1px solid var(--border);
  margin: 12px 10px 4px;
}

.nav-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius);
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.nav-btn:hover { background: var(--subtle-bg); color: var(--ink); }
.nav-btn.active { background: var(--accent-tint); color: var(--accent); font-weight: 600; }

.sidebar-stats {
  margin-top: auto;
  border-top: 1px solid var(--border);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-muted);
}

.sidebar-stats .stat-row { display: flex; justify-content: space-between; }
.sidebar-stats .stat-net { color: var(--ink); font-weight: 600; font-size: 14px; }

.main {
  padding: 28px 44px 60px;
  max-width: 1360px;
  width: 100%;
  min-width: 0;
}

.view-header {
  margin-bottom: 22px;
}

.view-header h1 { font-size: 24px; }
.view-header p { color: var(--ink-muted); margin: 6px 0 0; font-size: 14.5px; max-width: 60ch; }

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}

.panel + .panel { margin-top: 16px; }

.btn {
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

.btn-secondary { background: transparent; border-color: var(--border); color: var(--ink); }
.btn-secondary:hover:not(:disabled) { border-color: var(--ink-muted); }

.btn-danger { background: transparent; border-color: var(--danger); color: var(--danger); }
.btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }

.btn-ghost { background: transparent; border: none; color: var(--ink-muted); padding: 6px 8px; }
.btn-ghost:hover { color: var(--ink); }

.btn-sm { padding: 5px 10px; font-size: 12.5px; }

.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink); }
.field .hint { font-size: 12px; color: var(--ink-muted); margin-top: 1px; }

.field input[type="text"],
.field input[type="date"],
.field input[type="number"],
.field select {
  font-family: inherit;
  font-size: 14px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--ink);
}
.field input:focus, .field select:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; max-width: 640px; }
.form-grid .field.span-2 { grid-column: 1 / -1; }

.radio-row { display: flex; gap: 16px; margin-bottom: 16px; }
.radio-option { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; flex-wrap: wrap; }

.budget-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.budget-row-label { font-size: 12.5px; color: var(--ink-muted); font-weight: 600; }
.budget-amount-input {
  width: 70px; font-family: inherit; font-size: 13px; padding: 5px 7px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--panel); color: var(--ink);
}
.budget-row select {
  font-family: inherit; font-size: 12.5px; padding: 5px 7px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); color: var(--ink);
}

.invert-note {
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 14px;
}
.invert-note .hint { color: var(--warn-ink); margin: 0; }
.invert-note .radio-option { color: var(--ink); }

.dropzone {
  border: 1.5px dashed var(--border);
  border-radius: var(--radius);
  padding: 34px 20px;
  text-align: center;
  color: var(--ink-muted);
  font-size: 14px;
  background: var(--subtle-bg);
}
.dropzone strong { color: var(--ink); }

.file-input-label {
  display: inline-block;
  margin-top: 12px;
}
.file-input-label input { display: none; }

.error-banner {
  background: var(--danger-tint-bg);
  border: 1px solid var(--danger-tint-border);
  color: var(--danger);
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13.5px;
  margin-bottom: 14px;
}

.sync-banner {
  background: var(--accent-tint);
  border: 1px solid var(--accent);
  color: var(--accent-hover);
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13.5px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); margin-top: 6px; }
.preview-table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.preview-table th, .preview-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  text-align: left;
}
.preview-table th { background: var(--subtle-bg); color: var(--ink-muted); font-weight: 600; }

.summary-row { display: flex; gap: 22px; flex-wrap: wrap; margin-bottom: 18px; }
.summary-stat .num { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 500; }
.summary-stat .label { font-size: 12px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; }

.invalid-list { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); }
.invalid-row { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12.5px; display: flex; justify-content: space-between; gap: 10px; }
.invalid-row:last-child { border-bottom: none; }
.invalid-row .reason { color: var(--danger); }

.actions-row { display: flex; gap: 10px; margin-top: 18px; }

.filter-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.filter-bar select, .filter-bar input[type="text"] {
  font-family: inherit; font-size: 13.5px; padding: 7px 9px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); color: var(--ink);
}
.filter-bar .checkbox-filter { display: flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--ink-muted); }

.tx-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.tx-table th {
  text-align: left; padding: 8px 10px; font-size: 11.5px; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ink-muted); border-bottom: 1px solid var(--border); font-weight: 600;
}
.th-sort-btn {
  font-family: inherit; font-size: 11.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ink-muted); background: none; border: none; padding: 0;
  cursor: pointer;
}
.th-sort-btn:hover { color: var(--ink); }
.tx-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.tx-table tr:last-child td { border-bottom: none; }
.tx-table select {
  font-family: inherit;
  font-size: 12.5px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--ink);
  max-width: 150px;
}
.category-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.category-select.suggested {
  border: 1px dashed var(--accent);
  background: var(--accent-tint);
  color: var(--accent);
  font-style: italic;
}
.suggested-confirm-btn {
  border: 1px solid var(--accent);
  color: var(--accent);
  background: none;
  border-radius: var(--radius);
  font-size: 10.5px;
  padding: 3px 6px;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
}
.suggested-confirm-btn:hover { background: var(--accent-tint); }
.tx-table td.desc-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx-table .muted-cell { color: var(--ink-muted); }
.money-in { color: var(--income); font-weight: 600; }
.money-out { color: var(--expense); font-weight: 600; }

.toggle-group { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: 4px; }
.toggle-btn {
  padding: 7px 16px; font-family: inherit; font-size: 13px; font-weight: 600;
  border: none; background: var(--panel); color: var(--ink-muted); cursor: pointer;
}
.toggle-btn.active { background: var(--accent); color: #fff; }
.toggle-btn + .toggle-btn { border-left: 1px solid var(--border); }

.chart-card { padding: 18px 20px 8px; }
.chart-wrap { width: 100%; height: 280px; margin-top: 6px; }

.pivot-table { border-collapse: collapse; font-size: 13px; white-space: nowrap; width: 100%; }

.dual-scroll-top { overflow-x: auto; overflow-y: hidden; height: 16px; border-bottom: 1px solid var(--border); }
.pivot-table th, .pivot-table td { padding: 8px 14px; text-align: right; border-bottom: 1px solid var(--border); }
.pivot-table th:first-child, .pivot-table td:first-child {
  text-align: left; position: sticky; left: 0; background: var(--panel); z-index: 1;
}
.pivot-table thead th {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--ink-muted); font-weight: 600; border-bottom: 2px solid var(--border);
}
.pivot-table tfoot td { border-top: 2px solid var(--border); border-bottom: none; background: var(--subtle-bg); font-weight: 700; }
.pivot-table tbody tr:last-child td { border-bottom: none; }
.pivot-row-label { font-weight: 500; }
.pivot-row-budget { font-weight: 400; font-size: 12px; color: var(--ink-muted); margin-top: 2px; }
.pivot-total-col { font-weight: 600; }

.excluded-note {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--ink-muted); margin-top: 12px; padding: 10px 14px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--subtle-bg);
}

.budget-card-grid { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 22px; }
.budget-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 14px 16px; flex: 1 1 230px; max-width: 280px;
}
.budget-card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 8px; }
.budget-card-name { font-weight: 600; font-size: 14px; }
.budget-card-period { font-size: 10.5px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
.budget-bar-track { height: 8px; border-radius: 999px; background: var(--subtle-bg); overflow: hidden; margin-bottom: 8px; }
.budget-bar-fill { height: 100%; border-radius: 999px; transition: width 0.2s ease; }
.budget-card-figures { font-size: 13px; }
.budget-card-figures .muted-cell { font-size: 12.5px; }

.budget-group-tag {
  display: inline-block; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; padding: 1px 5px; margin-left: 6px;
  vertical-align: middle;
}

.group-chip {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px;
  padding: 4px 6px 4px 10px; border-radius: 999px; background: var(--subtle-bg); border: 1px solid var(--border);
}
.group-chip-remove {
  border: none; background: none; cursor: pointer; color: var(--ink-muted); font-size: 14px; line-height: 1; padding: 2px;
}
.group-chip-remove:hover { color: var(--danger); }

.badge {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
  padding: 2px 7px; border-radius: 999px; border: 1px solid var(--warn-border);
  background: var(--warn-bg); color: var(--warn-ink); cursor: pointer;
}

.dup-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.dup-cell .btn-ghost { padding: 0; font-size: 11px; color: var(--ink-muted); }

.dup-detail-row td { background: var(--subtle-bg); padding: 10px 14px; }
.dup-detail-title { font-size: 12px; font-weight: 600; color: var(--warn-ink); margin-bottom: 6px; }
.dup-detail-item { font-size: 12.5px; color: var(--ink-muted); padding: 3px 0; }

.row-actions { display: flex; gap: 6px; }
.row-actions input[type="text"] {
  font-family: inherit;
  font-size: 14px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.confirm-inline { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--danger); }

.empty-state {
  text-align: center; padding: 50px 20px; color: var(--ink-muted);
}
.empty-state h2 { color: var(--ink); font-size: 19px; margin-bottom: 8px; }
.empty-state-star { width: 56px; height: 56px; margin-bottom: 14px; }
.inline-star { width: 18px; height: 18px; flex-shrink: 0; }
.empty-state p { max-width: 42ch; margin: 0 auto 18px; font-size: 14px; }

.toast {
  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
  /* Deliberately not var(--ink) — that flips to a LIGHT color in dark
     themes, which would make this white text disappear. A toast reads
     fine as a fixed dark chip regardless of the overall theme. */
  background: #262B28; color: #fff; padding: 10px 18px; border-radius: var(--radius);
  font-size: 13.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); z-index: 40;
}

.account-card { display: flex; justify-content: space-between; align-items: center; padding: 14px 4px; border-bottom: 1px solid var(--border); }
.account-card:last-child { border-bottom: none; }
.account-card > .account-name-block { flex: 1 1 auto; min-width: 0; }
.account-card .name { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.account-card .meta { font-size: 12.5px; color: var(--ink-muted); margin-top: 2px; }
.account-card .figures { text-align: right; margin-right: 18px; min-width: 150px; flex-shrink: 0; }
.account-card .figures .net { font-family: 'Fraunces', serif; font-size: 17px; }

.account-card-wrap { border-bottom: 1px solid var(--border); }
.account-card-wrap:last-child { border-bottom: none; }
.account-card-wrap .account-card { border-bottom: none; }
.account-settings-panel {
  padding: 4px 4px 18px;
  border-top: 1px dashed var(--border);
  margin-top: -2px;
}
.account-settings-panel .form-grid { margin-top: 12px; }

.step-track { display: flex; gap: 8px; margin-bottom: 20px; font-size: 12.5px; color: var(--ink-muted); }
.step-track .step.current { color: var(--accent); font-weight: 600; }

.loading-screen {
  display: flex; align-items: center; justify-content: center; min-height: 100vh; color: var(--ink-muted); font-size: 14px;
}

/* Center the background ring on the content area, to the right of the
   216px sidebar. On phones the sidebar is hidden, so it centers on the
   screen (see the mobile rules below). */
.coinrose-bg-ring.beside-sidebar { left: calc(216px + (100vw - 216px) / 2); }

.mobile-topbar { display: none; }
.sidebar-backdrop { display: none; }
.mobile-expand-toggle { display: none; }

@media (max-width: 760px) {
  .app-shell { grid-template-columns: 1fr; }

  .mobile-topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .mobile-topbar h2 { margin: 0; font-size: 16px; font-family: 'Fraunces', serif; color: var(--ink); flex: 1; }
  .mobile-topbar-logo { width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
  .hamburger-btn {
    background: none; border: 1px solid var(--border); border-radius: var(--radius);
    padding: 7px 9px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; width: 32px;
  }
  .hamburger-btn span { display: block; height: 2px; background: var(--ink); border-radius: 2px; }

  /* The sidebar becomes an off-canvas drawer — sliding over the content
     instead of squeezing into a horizontal strip, so it can show the
     same full vertical nav (sections, dividers, all of it) as desktop
     rather than needing its own cut-down mobile-only layout. */
  .sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: 270px;
    max-width: 82vw;
    transform: translateX(-100%);
    transition: transform 0.22s ease;
    z-index: 210;
    overflow-y: auto;
    box-shadow: 4px 0 24px rgba(0,0,0,0.25);
  }
  .sidebar.mobile-open { transform: translateX(0); }

  .sidebar-backdrop.visible {
    display: block;
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 200;
  }

  .main { padding: 18px 14px 50px; }
  .form-grid { grid-template-columns: 1fr; }

  /* Toggle groups (period selector, chart type, etc.) — let buttons wrap
     onto multiple rows instead of forcing a row wider than the screen. */
  .toggle-group { display: flex; flex-wrap: wrap; width: 100%; }
  .toggle-group .toggle-btn { flex: 1 1 auto; }

  /* Overview's two-column layout collapses to one. */
  .overview-grid { grid-template-columns: 1fr !important; }

  /* The pivot-style tables (Reports' category table, Budget's history
     tables) pin their first column so it stays visible while the amount
     columns scroll sideways. On phones that pinned name column gets a
     fixed width of about a third of the screen: as a floor, so the
     amounts scroll instead of squeezing it, and as a ceiling, so a long
     name can't take over the screen. Names wrap only between words
     (overflow-wrap, unlike word-break, never splits a word that fits);
     a single word too long for the column is the only thing that breaks. */
  .pivot-table th, .pivot-table td { padding: 7px 10px; font-size: 12.5px; }
  .pivot-table thead th { font-size: 10.5px; }
  .pivot-table th:first-child, .pivot-table td:first-child {
    width: 34vw;
    min-width: 34vw;
    max-width: 34vw;
    white-space: normal;
    overflow-wrap: break-word;
    line-height: 1.3;
  }

  /* Budget progress cards use the full width on phones instead of
     stopping at their desktop maximum and leaving an empty strip. */
  .budget-card { max-width: none; flex-basis: 100%; }

  .coinrose-bg-ring.beside-sidebar { left: 50%; }

  /* Account and category rows: stack instead of squeezing into one line */
  .account-card { flex-direction: column; align-items: flex-start; gap: 10px; }
  .account-card .figures { text-align: left; margin-right: 0; }
  .account-card .row-actions { flex-wrap: wrap; }

  /* Category cards collapse to just a name and count by default — the
     exclude/income checkboxes and the merge/delete actions only take
     space once the chevron is tapped. */
  .category-card-info { width: 100%; }
  .category-card .category-extra { display: none; }
  .category-card .category-extra.mobile-expanded { display: block; }
  .category-card .category-actions { display: none; }
  .category-card .category-actions.mobile-expanded { display: flex; margin-top: 10px; }

  /* Transactions table -> stacked cards. Each <td> becomes its own line,
     labeled via the data-label attribute set in TransactionRow, instead
     of scrolling a wide table sideways on a narrow screen. */
  .tx-table thead { display: none; }
  .tx-table, .tx-table tbody, .tx-table tr, .tx-table td { display: block; width: 100%; }
  .tx-table tr {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .tx-table td { border-bottom: none; padding: 5px 0; }
  .tx-table td[data-label]::before {
    content: attr(data-label);
    display: block;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-muted);
    margin-bottom: 2px;
  }
  .tx-table td.no-label-cell:empty { display: none; }
  .tx-table td.desc-cell { max-width: none; white-space: normal; }
  .tx-table td input[type="text"], .tx-table td input[type="date"] { width: 100% !important; box-sizing: border-box; }
  .tx-table select { max-width: none; width: 100%; box-sizing: border-box; }
  .dup-detail-row td { padding: 10px 12px !important; }

  /* Collapsed-by-default transaction rows: a compact one-line summary is
     always visible; the existing, fully-detailed row (unchanged from
     desktop — same editing, same category picker) is hidden until the
     chevron is tapped, so nothing about how a transaction is edited has
     to be built or maintained twice. */
  .tx-table tr.tx-row-compact { padding: 10px 12px; cursor: pointer; }
  .tx-table tr.tx-row-full { display: none; }
  .tx-table tr.tx-row-full.mobile-expanded { display: block; margin-top: -10px; }
  .tx-table tr.tx-row-compact td { padding: 0; border-bottom: none; }
  .tx-compact-line { display: flex; align-items: center; gap: 8px; }
  .tx-compact-date { font-size: 11.5px; color: var(--ink-muted); flex-shrink: 0; white-space: nowrap; }
  .tx-compact-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; }
  .tx-compact-amount { flex-shrink: 0; font-weight: 600; font-size: 13.5px; }
  .tx-compact-subline { margin-top: 3px; font-size: 11.5px; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tx-compact-suggested { color: var(--accent); font-style: italic; }
  .mobile-expand-toggle {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--ink-muted);
    font-size: 10px;
    padding: 0;
    cursor: pointer;
  }
}
`;

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

function StatBlock({ value, label }) {
  return (
    <div className="summary-stat">
      <div className="num">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

// Wraps a wide table with a scrollbar at both the top and the bottom of
// the panel, kept in sync — so a long table doesn't force scrolling all
// the way down just to find the way to scroll sideways.
function DualScrollPanel({ children }) {
  const topRef = useRef(null);
  const bottomRef = useRef(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const syncSource = useRef(null);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const update = () => setScrollWidth(el.scrollWidth);
    update();
    // Observe the actual table (the scrollable content), not the
    // container — the container's own box size doesn't change just
    // because a column was added to what's inside it.
    const target = el.firstElementChild || el;
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  function handleTopScroll() {
    if (syncSource.current === "bottom") {
      syncSource.current = null;
      return;
    }
    syncSource.current = "top";
    if (bottomRef.current && topRef.current) bottomRef.current.scrollLeft = topRef.current.scrollLeft;
  }

  function handleBottomScroll() {
    if (syncSource.current === "top") {
      syncSource.current = null;
      return;
    }
    syncSource.current = "bottom";
    if (topRef.current && bottomRef.current) topRef.current.scrollLeft = bottomRef.current.scrollLeft;
  }

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div ref={topRef} onScroll={handleTopScroll} className="dual-scroll-top">
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      <div ref={bottomRef} onScroll={handleBottomScroll} style={{ overflowX: "auto" }}>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ title, body, ctaLabel, onCta }) {
  return (
    <div className="empty-state">
      <div>
        <ThemedStar className="empty-state-star" />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {ctaLabel && (
        <button className="btn btn-primary" onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upload wizard                                                       */
/* ------------------------------------------------------------------ */

function UploadView({ accounts, prefill, onImport }) {
  const [mode, setMode] = useState(() => {
    if (prefill && prefill.mode === "append") return "append";
    // Existing account is the common case after initial setup — default
    // to it whenever there's something to append to, rather than making
    // "create a new account" the default every time.
    return accounts.length > 0 ? "append" : "new";
  });
  const [targetAccountId, setTargetAccountId] = useState(
    (prefill && prefill.accountId) || (accounts[0] && accounts[0].id) || ""
  );
  const [fileInfo, setFileInfo] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [step, setStep] = useState("select");
  const [form, setForm] = useState({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", invertSign: false });
  const [reviewResult, setReviewResult] = useState(null);
  const fileInputRef = useRef(null);

  const existingAccount = mode === "append" ? accounts.find((a) => a.id === targetAccountId) : null;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (headers.length === 0) throw new Error("No columns were found in this file.");
      if (rows.length === 0) throw new Error("This file doesn't have any data rows.");
      setFileInfo({ headers, rows, fileName: file.name });

      const guessedName = file.name.replace(/\.(csv|xlsx|xls)$/i, "");
      if (mode === "append" && existingAccount) {
        setForm({
          name: existingAccount.name,
          dateCol: headers.includes(existingAccount.dateCol) ? existingAccount.dateCol : "",
          descriptionCol: headers.includes(existingAccount.descriptionCol) ? existingAccount.descriptionCol : "",
          outCol: headers.includes(existingAccount.outCol) ? existingAccount.outCol : "",
          inCol: headers.includes(existingAccount.inCol) ? existingAccount.inCol : "",
          invertSign: !!existingAccount.invertSign,
        });
      } else {
        setForm({
          name: guessedName,
          dateCol: guessHeader(headers, ["transaction date", "posted date", "date"]),
          descriptionCol: guessHeader(headers, ["description", "memo", "payee", "merchant", "name"]),
          outCol: guessHeader(headers, ["debit", "withdrawal", "money out", "amount out"]),
          inCol: guessHeader(headers, ["credit", "deposit", "money in", "amount in"]),
          invertSign: false,
        });
      }
      setStep("mapping");
    } catch (err) {
      setParseError(err.message || "Could not read this file.");
      setFileInfo(null);
    }
  }

  function handleMappingSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.dateCol || (!form.outCol && !form.inCol)) return;
    const accountId = mode === "append" && existingAccount ? existingAccount.id : uid();
    const { valid, invalid } = buildTransactions(fileInfo.rows, form, accountId, form.name.trim(), uid());
    setReviewResult({
      valid,
      invalid,
      accountMeta: {
        id: accountId,
        name: form.name.trim(),
        dateCol: form.dateCol,
        descriptionCol: form.descriptionCol,
        outCol: form.outCol,
        inCol: form.inCol,
        invertSign: form.invertSign,
        isNew: !(mode === "append" && existingAccount),
      },
    });
    setStep("review");
  }

  function confirmImport() {
    onImport(reviewResult.accountMeta, reviewResult.valid);
  }

  function resetWizard() {
    setFileInfo(null);
    setParseError(null);
    setStep("select");
    setForm({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", invertSign: false });
    setReviewResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canSubmitMapping = form.name.trim() && form.dateCol && (form.outCol || form.inCol);
  const sameColWarning = form.outCol && form.inCol && form.outCol === form.inCol;

  return (
    <div>
      <div className="view-header">
        <h1>Upload a statement</h1>
        <p>Add a new account to track, or bring in the latest transactions for one you already have.</p>
      </div>

      <div className="step-track">
        <span className={"step" + (step === "select" ? " current" : "")}>1. Choose file</span>
        <span>→</span>
        <span className={"step" + (step === "mapping" ? " current" : "")}>2. Map columns</span>
        <span>→</span>
        <span className={"step" + (step === "review" ? " current" : "")}>3. Review &amp; import</span>
      </div>

      {step === "select" && (
        <div className="panel">
          {accounts.length > 0 && (
            <div className="radio-row">
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "append"}
                  onChange={() => setMode("append")}
                />
                Add transactions to an existing account
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                This is a new account
              </label>
            </div>
          )}

          {mode === "append" && accounts.length > 0 && (
            <div className="field" style={{ maxWidth: 320 }}>
              <label>Account</label>
              <select value={targetAccountId} onChange={(e) => setTargetAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {parseError && <div className="error-banner">{parseError}</div>}

          <div className="dropzone">
            <div>
              <strong>Drop a .csv or .xlsx file here</strong>, or choose one below.
            </div>
            <label className="file-input-label">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFile}
              />
              <span className="btn btn-secondary">Choose file</span>
            </label>
          </div>
        </div>
      )}

      {step === "mapping" && fileInfo && (
        <div className="panel">
          <form onSubmit={handleMappingSubmit}>
            <div className="form-grid">
              <div className="field span-2">
                <label>What should this account be called?</label>
                <input
                  type="text"
                  value={form.name}
                  disabled={mode === "append"}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Date column</label>
                <select
                  value={form.dateCol}
                  onChange={(e) => setForm({ ...form, dateCol: e.target.value })}
                  required
                >
                  <option value="">Select a column…</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="hint">Use whichever date you track spending by — posted or transaction.</div>
              </div>
              <div className="field">
                <label>Description column</label>
                <select
                  value={form.descriptionCol}
                  onChange={(e) => setForm({ ...form, descriptionCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="hint">Payee, memo, or merchant — whatever names the transaction. Makes categorizing much easier.</div>
              </div>
              <div className="field">
                <label>Money out (expenses)</label>
                <select
                  value={form.outCol}
                  onChange={(e) => setForm({ ...form, outCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Money in (income)</label>
                <select
                  value={form.inCol}
                  onChange={(e) => setForm({ ...form, inCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {sameColWarning && (
              <div className="invert-note">
                <div className="hint">
                  Same column picked for both — that's fine for a single signed "Amount" column.
                  By default, positive values are treated as money in and negative as money out.
                </div>
                <label className="radio-option" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.invertSign}
                    onChange={(e) => setForm({ ...form, invertSign: e.target.checked })}
                  />
                  Flip it — on this account, positive values are money out (charges) and negative
                  values are money in (refunds/payments)
                </label>
              </div>
            )}

            <div className="hint" style={{ marginBottom: 10 }}>
              Preview of the first rows in {fileInfo.fileName}:
            </div>
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    {fileInfo.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fileInfo.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {fileInfo.headers.map((h) => (
                        <td key={h}>{String(row[h])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={!canSubmitMapping}>
                Check {fileInfo.rows.length} rows
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetWizard}>
                Start over
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "review" && reviewResult && (
        <div className="panel">
          <div className="summary-row">
            <StatBlock value={fileInfo.rows.length} label="Rows in file" />
            <StatBlock value={reviewResult.valid.length} label="Ready to import" />
            <StatBlock value={reviewResult.invalid.length} label="Could not be read" />
          </div>

          {reviewResult.invalid.length > 0 && (
            <>
              <div className="hint" style={{ marginBottom: 8 }}>
                These rows will be skipped if you continue:
              </div>
              <div className="invalid-list">
                {reviewResult.invalid.slice(0, 50).map((inv) => (
                  <div className="invalid-row" key={inv.rowIndex}>
                    <span>Row {inv.rowIndex + 2}</span>
                    <span className="reason">{inv.reasons.join(", ")}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="actions-row">
            <button
              className="btn btn-primary"
              onClick={confirmImport}
              disabled={reviewResult.valid.length === 0}
            >
              Import {reviewResult.valid.length} transaction{reviewResult.valid.length === 1 ? "" : "s"}
            </button>
            <button className="btn btn-secondary" onClick={() => setStep("mapping")}>
              Back to mapping
            </button>
            <button className="btn btn-ghost" onClick={resetWizard}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts view                                                       */
/* ------------------------------------------------------------------ */

function AccountCard({ account, txCount, totalIn, totalOut, sampleRaw, onDelete, onAddTransactions, onRename, onUpdateSettings }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.name);
  const [confirming, setConfirming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const net = totalIn - totalOut;
  const headers = sampleRaw ? Object.keys(sampleRaw) : [];

  function startEdit() {
    setDraftName(account.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== account.name) onRename(account.id, trimmed);
    setEditing(false);
  }

  function openSettings() {
    setSettingsForm({
      dateCol: account.dateCol || "",
      descriptionCol: account.descriptionCol || "",
      outCol: account.outCol || "",
      inCol: account.inCol || "",
      invertSign: !!account.invertSign,
    });
    setSettingsOpen(true);
  }

  function saveSettings() {
    onUpdateSettings(account.id, settingsForm);
    setSettingsOpen(false);
  }

  const sameColWarning =
    settingsForm && settingsForm.outCol && settingsForm.inCol && settingsForm.outCol === settingsForm.inCol;
  const canSaveSettings =
    settingsForm && settingsForm.dateCol && (settingsForm.outCol || settingsForm.inCol);

  return (
    <div className="account-card-wrap">
      <div className="account-card">
        <div className="account-name-block">
          {editing ? (
            <div className="row-actions">
              <input
                type="text"
                value={draftName}
                autoFocus
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="name">
              {account.name}
              <button className="btn btn-ghost btn-sm" onClick={startEdit}>
                Rename
              </button>
            </div>
          )}
          <div className="meta">
            {txCount} transaction{txCount === 1 ? "" : "s"} · date column: {account.dateCol}
          </div>
        </div>
        <div className="figures">
          <div className={"net " + (net >= 0 ? "money-in" : "money-out")}>{formatMoney(net)}</div>
          <div className="meta">
            {formatMoney(totalIn)} in / {formatMoney(totalOut)} out
          </div>
        </div>
        <div className="row-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onAddTransactions(account.id)}>
            Add transactions
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
          >
            {settingsOpen ? "Close settings" : "Settings"}
          </button>
          {confirming ? (
            <span className="confirm-inline">
              Delete account and {txCount} transaction{txCount === 1 ? "" : "s"}?
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(account.id)}>
                Confirm
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {settingsOpen && settingsForm && (
        <div className="account-settings-panel">
          {headers.length === 0 ? (
            <div className="hint">
              This account has no transactions to reference columns from yet — add some first.
            </div>
          ) : (
            <>
              <div className="form-grid">
                <div className="field">
                  <label>Date column</label>
                  <select
                    value={settingsForm.dateCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, dateCol: e.target.value })}
                  >
                    <option value="">Select a column…</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Description column</label>
                  <select
                    value={settingsForm.descriptionCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, descriptionCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Money out column</label>
                  <select
                    value={settingsForm.outCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, outCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Money in column</label>
                  <select
                    value={settingsForm.inCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, inCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {sameColWarning && (
                <div className="invert-note">
                  <div className="hint">
                    Same column picked for both — positive/negative in that column decides the direction.
                  </div>
                  <label className="radio-option" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={settingsForm.invertSign}
                      onChange={(e) => setSettingsForm({ ...settingsForm, invertSign: e.target.checked })}
                    />
                    Flip it — positive values are money out, negative are money in
                  </label>
                </div>
              )}

              <div className="hint" style={{ marginBottom: 10 }}>
                Saving reapplies these settings to all {txCount} existing transaction{txCount === 1 ? "" : "s"}{" "}
                for this account, not just future uploads. Any transaction that no longer parses cleanly is left
                unchanged.
              </div>

              <div className="actions-row">
                <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={!canSaveSettings}>
                  Save &amp; reapply
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSettingsOpen(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AccountsView({ accounts, transactions, onDelete, onAddTransactions, onRename, onUpdateSettings, onGoUpload }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No accounts yet"
        body="Upload a statement to add the first account you'd like to track."
        ctaLabel="Upload a statement"
        onCta={() => onGoUpload(null)}
      />
    );
  }

  return (
    <div>
      <div className="view-header">
        <h1>Accounts</h1>
        <p>Every account you're tracking, and how its balance nets out so far.</p>
      </div>
      <div className="panel">
        {accounts.map((a) => {
          const txs = transactions.filter((t) => t.accountId === a.id);
          const totalIn = txs.reduce((s, t) => s + (t.amountIn || 0), 0);
          const totalOut = txs.reduce((s, t) => s + (t.amountOut || 0), 0);
          return (
            <AccountCard
              key={a.id}
              account={a}
              txCount={txs.length}
              totalIn={totalIn}
              totalOut={totalOut}
              sampleRaw={txs[0] ? txs[0].raw : null}
              onDelete={onDelete}
              onAddTransactions={onAddTransactions}
              onRename={onRename}
              onUpdateSettings={onUpdateSettings}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Categories view                                                      */
/* ------------------------------------------------------------------ */

function CategoryCard({ category, categories, txCount, transactions, onRename, onDelete, onToggleExcluded, onToggleIsIncome, onMerge }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeConfirming, setMergeConfirming] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const otherCategories = categories.filter((c) => c.id !== category.id);

  function startEdit() {
    setDraftName(category.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== category.name) onRename(category.id, trimmed);
    setEditing(false);
  }

  function startMerge() {
    setMergeTargetId(otherCategories[0]?.id || "");
    setMergeConfirming(false);
    setMerging(true);
  }

  function handleConfirmMerge() {
    if (!mergeTargetId) return;
    onMerge(category.id, mergeTargetId);
  }

  const mergeTarget = otherCategories.find((c) => c.id === mergeTargetId);

  return (
    <div className="account-card category-card">
      <div className="category-card-info">
        {editing ? (
          <div className="row-actions">
            <input
              type="text"
              value={draftName}
              autoFocus
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={saveEdit}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="name">
            {category.name}
            <button className="btn btn-ghost btn-sm" onClick={startEdit}>
              Rename
            </button>
            <button
              type="button"
              className="mobile-expand-toggle"
              style={{ marginLeft: "auto" }}
              onClick={() => setMobileExpanded((v) => !v)}
              aria-label={mobileExpanded ? "Show less" : "Show more"}
            >
              {mobileExpanded ? "▲" : "▼"}
            </button>
          </div>
        )}
        <div className="meta">
          {txCount} transaction{txCount === 1 ? "" : "s"}
        </div>
        <div className={"category-extra" + (mobileExpanded ? " mobile-expanded" : "")}>
          <label className="radio-option" style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-muted)" }}>
            <input
              type="checkbox"
              checked={!!category.excluded}
              onChange={(e) => onToggleExcluded(category.id, e.target.checked)}
            />
            Exclude from totals &amp; reports (e.g. transfers between your own accounts)
          </label>
          <label className="radio-option" style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-muted)" }}>
            <input
              type="checkbox"
              checked={!!category.isIncome}
              onChange={(e) => onToggleIsIncome(category.id, e.target.checked)}
            />
            This is income (paycheck, etc.) — never counts as unassigned spending
          </label>
        </div>
      </div>
      <div className={"row-actions category-actions" + (mobileExpanded ? " mobile-expanded" : "")}>
        {merging ? (
          mergeConfirming ? (
            <span className="confirm-inline">
              Move {txCount} transaction{txCount === 1 ? "" : "s"} into "{mergeTarget?.name}" and delete "
              {category.name}"?
              <button className="btn btn-danger btn-sm" onClick={handleConfirmMerge}>
                Confirm
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMergeConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <span className="row-actions">
              <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                {otherCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setMergeConfirming(true)}
                disabled={!mergeTargetId}
              >
                Merge
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMerging(false)}>
                Cancel
              </button>
            </span>
          )
        ) : confirming ? (
          <span className="confirm-inline">
            Delete this category?{txCount > 0 ? ` ${txCount} transaction${txCount === 1 ? "" : "s"} will become uncategorized.` : ""}
            {category.budgetType === "accumulate" &&
              (() => {
                const balance = computeItemFundBalance(category, new Set([category.id]), transactions || []);
                return Math.abs(balance) > 0.01 ? (
                  <strong style={{ color: "var(--expense)" }}>
                    {" "}
                    This fund currently shows {formatMoney(balance)} — deleting it won't move that money
                    anywhere, it'll just stop being tracked.
                  </strong>
                ) : null;
              })()}
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(category.id)}>
              Confirm
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={startMerge} disabled={otherCategories.length === 0}>
              Merge into…
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CategoriesView({ categories, transactions, onAdd, onRename, onDelete, onToggleExcluded, onToggleIsIncome, onMerge }) {
  const [newName, setNewName] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setNewName("");
  }

  return (
    <div>
      <div className="view-header">
        <h1>Categories</h1>
        <p>Set up the categories you'll use to organize spending. Assign them to transactions from the Transactions tab.</p>
      </div>

      <div className="panel">
        <form onSubmit={handleAdd} style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="New category name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{
              flex: 1,
              fontFamily: "inherit",
              fontSize: 14,
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>
            Add category
          </button>
        </form>

        {categories.length === 0 ? (
          <div className="hint">No categories yet — add your first one above.</div>
        ) : (
          categories.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              categories={categories}
              txCount={transactions.filter((t) => t.categoryId === cat.id).length}
              transactions={transactions}
              onRename={onRename}
              onDelete={onDelete}
              onToggleExcluded={onToggleExcluded}
              onToggleIsIncome={onToggleIsIncome}
              onMerge={onMerge}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transactions view                                                    */
/* ------------------------------------------------------------------ */

function TransactionRow({ t, duplicateInfo, expanded, onToggleExpand, allTransactions, categories, onUpdate, onDelete, suggestedCategoryId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    date: t.date || "",
    description: t.description || "",
    amountOut: t.amountOut != null ? String(t.amountOut) : "",
    amountIn: t.amountIn != null ? String(t.amountIn) : "",
    budgetPeriodOverride: t.budgetPeriodOverride || "",
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const isDup = duplicateInfo.dupIds.has(t.id);
  const categoryName = t.categoryId ? categories.find((c) => c.id === t.categoryId)?.name || "Unknown" : null;
  const suggestedName = suggestedCategoryId ? categories.find((c) => c.id === suggestedCategoryId)?.name || null : null;
  const primaryAmount = t.amountOut != null ? -t.amountOut : t.amountIn != null ? t.amountIn : null;

  function startEdit() {
    setDraft({
      date: t.date || "",
      description: t.description || "",
      amountOut: t.amountOut != null ? String(t.amountOut) : "",
      amountIn: t.amountIn != null ? String(t.amountIn) : "",
      budgetPeriodOverride: t.budgetPeriodOverride || "",
    });
    setEditing(true);
  }

  function saveEdit() {
    const out = draft.amountOut.trim() === "" ? null : parseMoney(draft.amountOut);
    const inn = draft.amountIn.trim() === "" ? null : parseMoney(draft.amountIn);
    onUpdate(t.id, {
      date: draft.date || t.date,
      description: draft.description,
      amountOut: out,
      amountIn: inn,
      budgetPeriodOverride: draft.budgetPeriodOverride || null,
    });
    setEditing(false);
  }

  const dupKey = duplicateInfo.keyByTxId[t.id];
  const others = dupKey
    ? duplicateInfo.groupByKey[dupKey].filter((id) => id !== t.id).map((id) => allTransactions.find((x) => x.id === id)).filter(Boolean)
    : [];

  return (
    <>
      <tr className="tx-row-compact" onClick={() => setMobileExpanded((e) => !e)}>
        <td colSpan={8}>
          <div className="tx-compact-line">
            <span className="tx-compact-date">{formatDateDisplay(t.date)}</span>
            <span className="tx-compact-desc">{t.description || "—"}</span>
            <span className={"tx-compact-amount " + (primaryAmount == null ? "" : primaryAmount < 0 ? "money-out" : "money-in")}>
              {primaryAmount == null ? "—" : formatMoney(primaryAmount)}
            </span>
            <button
              type="button"
              className="mobile-expand-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setMobileExpanded((v) => !v);
              }}
              aria-label={mobileExpanded ? "Show less" : "Show more"}
            >
              {mobileExpanded ? "▲" : "▼"}
            </button>
          </div>
          <div className="tx-compact-subline">
            {categoryName ? (
              categoryName
            ) : suggestedName ? (
              <span className="tx-compact-suggested">Suggested: {suggestedName}</span>
            ) : (
              <span className="muted-cell">Uncategorized</span>
            )}
            {" · "}
            {t.accountName}
            {isDup && <span className="badge" style={{ marginLeft: 6 }}>possible duplicate</span>}
          </div>
        </td>
      </tr>
      <tr className={"tx-row-full" + (mobileExpanded ? " mobile-expanded" : "")}>
        <td data-label="Date">
          {editing ? (
            <>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
              <div style={{ marginTop: 6 }}>
                <label className="muted-cell" style={{ fontSize: 11, display: "block", marginBottom: 2 }}>
                  Counts toward budget period:
                </label>
                <input
                  type="date"
                  style={{ width: 130 }}
                  value={draft.budgetPeriodOverride}
                  onChange={(e) => setDraft({ ...draft, budgetPeriodOverride: e.target.value })}
                />
                {draft.budgetPeriodOverride && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 4 }}
                    onClick={() => setDraft({ ...draft, budgetPeriodOverride: "" })}
                  >
                    Clear
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {formatDateDisplay(t.date)}
              {t.budgetPeriodOverride && (
                <div className="muted-cell" style={{ fontSize: 11 }}>
                  counts toward {formatMonthLabel(getMonthStartISO(t.budgetPeriodOverride))}
                </div>
              )}
            </>
          )}
        </td>
        <td className="desc-cell" data-label="Description" title={t.description || ""}>
          {editing ? (
            <input
              type="text"
              style={{ width: 170 }}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="—"
            />
          ) : (
            t.description || <span className="muted-cell">—</span>
          )}
        </td>
        <td data-label="Account">{t.accountName}</td>
        <td data-label="Money out">
          {editing ? (
            <input
              type="text"
              style={{ width: 90 }}
              value={draft.amountOut}
              onChange={(e) => setDraft({ ...draft, amountOut: e.target.value })}
              placeholder="—"
            />
          ) : (
            <span className={t.amountOut != null ? "money-out" : ""}>
              {t.amountOut != null ? formatMoney(t.amountOut) : "—"}
            </span>
          )}
        </td>
        <td data-label="Money in">
          {editing ? (
            <input
              type="text"
              style={{ width: 90 }}
              value={draft.amountIn}
              onChange={(e) => setDraft({ ...draft, amountIn: e.target.value })}
              placeholder="—"
            />
          ) : (
            <span className={t.amountIn != null ? "money-in" : ""}>
              {t.amountIn != null ? formatMoney(t.amountIn) : "—"}
            </span>
          )}
        </td>
        <td data-label="Category">
          {(() => {
            const isSuggestion = !t.categoryId && suggestedCategoryId;
            return (
              <div className="category-cell">
                <select
                  className={isSuggestion ? "category-select suggested" : "category-select"}
                  value={t.categoryId || (isSuggestion ? suggestedCategoryId : "")}
                  onChange={(e) => onUpdate(t.id, { categoryId: e.target.value || null })}
                  title={isSuggestion ? "Suggested based on how you've categorized this before — pick a category to confirm or change it" : undefined}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {isSuggestion && (
                  <button
                    type="button"
                    className="suggested-confirm-btn"
                    title="Accept this suggested category"
                    onClick={() => onUpdate(t.id, { categoryId: suggestedCategoryId })}
                  >
                    ✓ Suggested
                  </button>
                )}
              </div>
            );
          })()}
        </td>
        <td className="no-label-cell">
          {isDup && (
            <div className="dup-cell">
              <span className="badge" onClick={() => onToggleExpand(t.id)}>
                possible duplicate {expanded ? "▲" : "▼"}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(t.id, { notDuplicate: true })}>
                Not a duplicate
              </button>
            </div>
          )}
        </td>
        <td className="no-label-cell">
          {editing ? (
            <div className="row-actions">
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : confirmingDelete ? (
            <span className="confirm-inline">
              Delete?
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(t.id)}>
                Yes
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(false)}>
                No
              </button>
            </span>
          ) : (
            <div className="row-actions">
              <button className="btn btn-ghost btn-sm" onClick={startEdit}>
                Edit
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            </div>
          )}
        </td>
      </tr>
      {expanded && isDup && (
        <tr className="dup-detail-row">
          <td colSpan={8}>
            <div className="dup-detail-title">Same date and amount as:</div>
            {others.map((o) => (
              <div className="dup-detail-item" key={o.id}>
                {formatDateDisplay(o.date)} · {o.description ? o.description + " · " : ""}{o.accountName} · {formatMoney(o.amountOut != null ? o.amountOut : o.amountIn)}
                {" "}({o.amountOut != null ? "money out" : "money in"})
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                             */
/*                                                                      */
/* A single at-a-glance landing page: this period's totals, where the   */
/* money actually went, and anything that needs attention (a budget     */
/* over or nearing its limit, transactions with nowhere assigned yet).  */
/* Reuses the same period preference set in Reports and the same pure   */
/* budget-computation functions Budget itself uses — not a parallel     */
/* re-implementation of either.                                        */
/* ------------------------------------------------------------------ */

function flagForBudgetItem(item, spent) {
  const budget = item.budgetAmount || 0;
  if (budget <= 0) return "ok";
  const ratio = spent / budget;
  if (item.budgetType === "accumulate") {
    if (ratio >= 1) return "ok";
    if (ratio >= 0.8) return "warn";
    return "bad";
  }
  if (ratio >= 1) return "bad";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

function OverviewView({ transactions, categories, budgetGroups, onNavigate }) {
  const periodConfig = useMemo(() => loadReportPeriodConfig(), []);
  const { keyFn: periodKeyFn, labelFn: periodLabelFn } = useMemo(() => periodFnsForConfig(periodConfig), [periodConfig]);

  const trackedIds = useMemo(
    () => new Set(categories.filter((c) => !c.excluded).map((c) => c.id)),
    [categories]
  );

  const periodSummary = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const currentKey = periodKeyFn(todayISO);
    const rowMap = {};
    const catLabel = {};
    let sumIn = 0;
    let sumOut = 0;
    transactions.forEach((t) => {
      if (!t.date) return;
      if (t.categoryId && !trackedIds.has(t.categoryId)) return;
      if (periodKeyFn(t.date) !== currentKey) return;
      const key = t.categoryId || "uncategorized";
      if (!(key in rowMap)) {
        rowMap[key] = 0;
        catLabel[key] = t.categoryId ? categories.find((c) => c.id === key)?.name || "Unknown" : "Uncategorized";
      }
      rowMap[key] += (t.amountIn || 0) - (t.amountOut || 0);
      sumIn += t.amountIn || 0;
      sumOut += t.amountOut || 0;
    });
    const rows = Object.keys(rowMap)
      .map((k) => ({ key: k, label: catLabel[k], value: rowMap[k] }))
      .filter((r) => r.value !== 0);
    return { currentKey, sumIn, sumOut, net: sumIn - sumOut, rows };
  }, [transactions, categories, trackedIds, periodKeyFn]);

  const topSpending = useMemo(
    () =>
      periodSummary.rows
        .filter((r) => r.value < 0)
        .sort((a, b) => a.value - b.value)
        .slice(0, 5),
    [periodSummary]
  );

  const donutData = useMemo(() => {
    const spendRows = periodSummary.rows
      .filter((r) => r.value < 0)
      .sort((a, b) => a.value - b.value);
    const top = spendRows.slice(0, 5);
    const rest = spendRows.slice(5);
    const wedges = top.map((r) => ({ name: r.label, value: Math.abs(r.value) }));
    if (rest.length > 0) {
      const otherSum = rest.reduce((s, r) => s + Math.abs(r.value), 0);
      if (otherSum > 0) wedges.push({ name: "Other", value: otherSum, isOther: true });
    }
    return wedges;
  }, [periodSummary]);

  const budgetItems = useMemo(() => buildBudgetItems(categories, budgetGroups), [categories, budgetGroups]);
  const weeklyData = useMemo(() => computeBudgetPeriodData(transactions, budgetItems, "weekly"), [transactions, budgetItems]);
  const monthlyData = useMemo(() => computeBudgetPeriodData(transactions, budgetItems, "monthly"), [transactions, budgetItems]);

  const { flagged, totalBudgetCount } = useMemo(() => {
    const flagged = [];
    let totalBudgetCount = 0;
    [weeklyData, monthlyData].forEach((data) => {
      if (!data) return;
      data.budgeted.forEach((item) => {
        if (item.isUnassignedPseudo) return;
        totalBudgetCount += 1;
        const spent = data.spendMap[item.id]?.[data.currentKey] || 0;
        const flag = flagForBudgetItem(item, spent);
        if (flag !== "ok") {
          flagged.push({
            item,
            spent,
            flag,
            periodWord: item.budgetPeriod === "weekly" ? "this week" : "this month",
          });
        }
      });
    });
    flagged.sort((a, b) => (a.flag === "bad" && b.flag !== "bad" ? -1 : a.flag !== "bad" && b.flag === "bad" ? 1 : 0));
    return { flagged, totalBudgetCount };
  }, [weeklyData, monthlyData]);

  const uncategorizedCount = transactions.filter((t) => !t.categoryId).length;
  const needsAttentionCount = flagged.length + (uncategorizedCount > 0 ? 1 : 0);

  return (
    <div>
      <div className="view-header">
        <h1>Overview</h1>
        <p>
          A snapshot of {periodLabelFn(periodSummary.currentKey)} — the period length and chart style here
          follow whatever you've set in Reports.
        </p>
      </div>

      <div className="summary-row">
        <StatBlock value={formatMoney(periodSummary.sumIn)} label="Money in" />
        <StatBlock value={formatMoney(periodSummary.sumOut)} label="Money out" />
        <StatBlock value={formatMoney(periodSummary.net)} label="Net" />
      </div>

      <div className="overview-grid">
        <div className="panel">
          <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15 }}>Needs attention</h3>
          {needsAttentionCount === 0 ? (
            <p className="hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ThemedStar className="inline-star" />
              Nothing flagged right now — budgets are on track and everything's categorized.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {uncategorizedCount > 0 && (
                <button
                  className="account-card"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "none", background: "var(--subtle-bg)", borderRadius: "var(--radius)" }}
                  onClick={() => onNavigate("transactions")}
                >
                  <div>
                    <div className="name" style={{ fontSize: 13.5 }}>
                      {uncategorizedCount} uncategorized transaction{uncategorizedCount === 1 ? "" : "s"}
                    </div>
                    <div className="meta">Tap to review them</div>
                  </div>
                </button>
              )}
              {flagged.map(({ item, spent, flag, periodWord }) => (
                <button
                  key={item.id}
                  className="account-card"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "none", background: "var(--subtle-bg)", borderRadius: "var(--radius)" }}
                  onClick={() => onNavigate("budget")}
                >
                  <div>
                    <div className="name" style={{ fontSize: 13.5 }}>{item.name}</div>
                    <div className="meta">
                      {item.budgetType === "accumulate"
                        ? `Behind on saving ${periodWord}`
                        : flag === "bad"
                        ? `Over budget ${periodWord}`
                        : `Nearing its limit ${periodWord}`}
                    </div>
                  </div>
                  <div className="figures">
                    <div className={"net " + (flag === "bad" ? "money-out" : "")} style={{ fontSize: 14 }}>
                      {formatMoney(spent)} / {formatMoney(item.budgetAmount)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {totalBudgetCount > 0 && (
            <p className="muted-cell" style={{ fontSize: 12, marginTop: 12 }}>
              {totalBudgetCount - flagged.length} of {totalBudgetCount} budgets on track.{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("budget")}>
                See all
              </button>
            </p>
          )}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15 }}>Top spending this period</h3>
          {topSpending.length === 0 ? (
            <p className="hint">No spending recorded yet for {periodLabelFn(periodSummary.currentKey)}.</p>
          ) : (
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 8 }}>
              <div style={{ width: 120, height: 120, flexShrink: 0 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={donutData.length > 1 ? 2 : 0}>
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.isOther ? "var(--chart-other)" : CHART_PALETTE[i % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatMoney(value)}
                      contentStyle={{
                        fontSize: 12,
                        fontFamily: "'Work Sans', sans-serif",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: "var(--panel)",
                      }}
                      itemStyle={{ color: "var(--ink)" }}
                      labelStyle={{ color: "var(--ink)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {topSpending.map((r, i) => (
                  <div key={r.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "4px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_PALETTE[i % CHART_PALETTE.length], flexShrink: 0, display: "inline-block" }} />
                      {r.label}
                    </span>
                    <span className="money-out" style={{ flexShrink: 0 }}>{formatMoney(Math.abs(r.value))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => onNavigate("reports")}>
            See full Reports
          </button>
        </div>
      </div>
    </div>
  );
}

function TransactionsView({ transactions, accounts, categories, duplicateInfo, onUpdate, onDelete, onGoUpload }) {
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [dupOnly, setDupOnly] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [dateSortDir, setDateSortDir] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterBatchId, setFilterBatchId] = useState("all");

  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(transactions, categories),
    [transactions, categories]
  );

  // The last several distinct uploads, newest first — surfaced by date/
  // account/count so a person can jump straight to "what I just
  // imported" without ever seeing or needing the underlying batch id.
  const recentBatches = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      if (!t.uploadBatchId) return;
      if (!map[t.uploadBatchId]) {
        map[t.uploadBatchId] = { batchId: t.uploadBatchId, uploadedAt: t.uploadedAt, accountNames: new Set(), count: 0 };
      }
      map[t.uploadBatchId].count += 1;
      if (t.accountName) map[t.uploadBatchId].accountNames.add(t.accountName);
    });
    return Object.values(map)
      .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))
      .slice(0, 10);
  }, [transactions]);

  function formatBatchLabel(batch) {
    const dt = batch.uploadedAt ? new Date(batch.uploadedAt) : null;
    const dateStr = dt
      ? dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
      : "Unknown time";
    const accountStr = [...batch.accountNames].join(", ");
    return `${dateStr} — ${accountStr} (${batch.count})`;
  }

  const filtered = useMemo(() => {
    let list = transactions;
    if (filterAccount !== "all") list = list.filter((t) => t.accountId === filterAccount);
    if (filterCategory === "uncategorized") list = list.filter((t) => !t.categoryId);
    else if (filterCategory !== "all") list = list.filter((t) => t.categoryId === filterCategory);
    if (dupOnly) list = list.filter((t) => duplicateInfo.dupIds.has(t.id));
    if (filterBatchId !== "all") list = list.filter((t) => t.uploadBatchId === filterBatchId);
    if (dateFrom) list = list.filter((t) => t.date && t.date >= dateFrom);
    if (dateTo) list = list.filter((t) => t.date && t.date <= dateTo);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const haystack = [t.accountName, t.date, t.description, ...Object.values(t.raw || {}).map(String)]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    const dir = dateSortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => (a.date < b.date ? -dir : a.date > b.date ? dir : 0));
  }, [transactions, filterAccount, filterCategory, dupOnly, filterBatchId, search, duplicateInfo, dateSortDir, dateFrom, dateTo]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No transactions yet"
        body="Once you upload a statement, everything you import will show up here in one combined list."
        ctaLabel="Upload a statement"
        onCta={() => onGoUpload(null)}
      />
    );
  }

  const totalIn = filtered.reduce((s, t) => s + (t.amountIn || 0), 0);
  const totalOut = filtered.reduce((s, t) => s + (t.amountOut || 0), 0);
  const uncategorizedCount = transactions.filter((t) => !t.categoryId).length;

  return (
    <div>
      <div className="view-header">
        <h1>Transactions</h1>
        <p>Everything you've imported, combined in one place.</p>
      </div>

      <div className="summary-row">
        <StatBlock value={filtered.length} label="Transactions shown" />
        <StatBlock value={formatMoney(totalIn)} label="Money in" />
        <StatBlock value={formatMoney(totalOut)} label="Money out" />
        <StatBlock value={formatMoney(totalIn - totalOut)} label="Net" />
      </div>

      <div className="filter-bar">
        <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {recentBatches.length > 0 && (
          <select value={filterBatchId} onChange={(e) => setFilterBatchId(e.target.value)}>
            <option value="all">All transactions</option>
            {recentBatches.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {formatBatchLabel(b)}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={filterCategory === "uncategorized"}
            onChange={(e) => setFilterCategory(e.target.checked ? "uncategorized" : "all")}
          />
          Uncategorized only ({uncategorizedCount})
        </label>
        <label className="checkbox-filter">
          <input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} />
          Possible duplicates only ({duplicateInfo.dupIds.size})
        </label>
        <label className="checkbox-filter" style={{ gap: 8 }}>
          Between
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          and
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          {(dateFrom || dateTo) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear
            </button>
          )}
        </label>
      </div>

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tx-table">
          <thead>
            <tr>
              <th>
                <button
                  className="th-sort-btn"
                  onClick={() => setDateSortDir(dateSortDir === "asc" ? "desc" : "asc")}
                >
                  Date {dateSortDir === "asc" ? "▲" : "▼"}
                </button>
              </th>
              <th>Description</th>
              <th>Account</th>
              <th>Money out</th>
              <th>Money in</th>
              <th>Category</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <TransactionRow
                key={t.id}
                t={t}
                duplicateInfo={duplicateInfo}
                expanded={expandedId === t.id}
                onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                allTransactions={transactions}
                categories={categories}
                onUpdate={onUpdate}
                onDelete={onDelete}
                suggestedCategoryId={categorySuggestions.get(t.id) || null}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--ink-muted)" }}>
                  No transactions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Post-upload categorization                                          */
/* ------------------------------------------------------------------ */

function PostUploadCategorizeView({ transactions, batchId, accountName, categories, duplicateInfo, onUpdate, onDelete, onSkip }) {
  const [expandedId, setExpandedId] = useState(null);
  const batchTransactions = useMemo(
    () => transactions.filter((t) => t.uploadBatchId === batchId),
    [transactions, batchId]
  );
  const uncategorizedCount = batchTransactions.filter((t) => !t.categoryId).length;
  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(transactions, categories),
    [transactions, categories]
  );

  if (batchTransactions.length === 0) {
    return (
      <EmptyState
        title="Nothing left to categorize here"
        body="This import doesn't have anything left to show — it may have already been categorized or removed."
        ctaLabel="Go to Transactions"
        onCta={onSkip}
      />
    );
  }

  return (
    <div>
      <div className="view-header">
        <h1>Categorize your import</h1>
        <p>
          {batchTransactions.length} transaction{batchTransactions.length === 1 ? "" : "s"} just imported into{" "}
          <strong>{accountName}</strong> — sort them into categories now, or skip and handle it later from
          Transactions. Uploading another file works fine from here too; this batch will still be waiting when
          you come back.
        </p>
      </div>

      <div className="summary-row">
        <StatBlock value={batchTransactions.length} label="Just imported" />
        <StatBlock value={uncategorizedCount} label="Still uncategorized" />
      </div>

      <div className="actions-row" style={{ marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={onSkip}>
          Skip for now
        </button>
      </div>

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tx-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Account</th>
              <th>Money out</th>
              <th>Money in</th>
              <th>Category</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batchTransactions.map((t) => (
              <TransactionRow
                key={t.id}
                t={t}
                duplicateInfo={duplicateInfo}
                expanded={expandedId === t.id}
                onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                allTransactions={transactions}
                categories={categories}
                onUpdate={onUpdate}
                onDelete={onDelete}
                suggestedCategoryId={categorySuggestions.get(t.id) || null}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="actions-row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={onSkip}>
          Done — go to Transactions
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reports view                                                         */
/* ------------------------------------------------------------------ */

function ReportsTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  const sorted = [...payload].sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0));
  return (
    <div
      style={{
        fontSize: 12.5,
        fontFamily: "'Work Sans', sans-serif",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--panel)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        padding: "8px 10px",
        minWidth: 160,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {sorted.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 14, color: p.color }}>
          <span>{p.name}</span>
          <span>{formatMoney(p.value)}</span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 14,
          marginTop: 4,
          paddingTop: 4,
          borderTop: "1px solid var(--border)",
          fontWeight: 700,
          color: total >= 0 ? "var(--income)" : "var(--expense)",
        }}
      >
        <span>Net</span>
        <span>{formatMoney(total)}</span>
      </div>
    </div>
  );
}

function ReportsDonutTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const signed = p.payload && p.payload.signed != null ? p.payload.signed : p.value;
  return (
    <div
      style={{
        fontSize: 12,
        fontFamily: "'Work Sans', sans-serif",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--panel)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        padding: "6px 10px",
      }}
    >
      <div style={{ fontWeight: 600 }}>{p.name}</div>
      <div style={{ color: signed >= 0 ? "var(--income)" : "var(--expense)" }}>{formatMoney(signed)}</div>
    </div>
  );
}

function ReportsDonutGrid({ periods, periodLabelFn, rows, categoryColor, periodTotals }) {
  // Each donut ranks and truncates independently, using that period's
  // OWN values — not a globally-fixed top 6 — so "Other" always
  // reflects what was actually small that period, and a category that's
  // usually small but spiked once still gets its own wedge on the
  // period it mattered.
  const periodData = periods.map((p, i) => {
    const active = rows
      .map((r) => ({ name: r.label, value: r.cells[i] }))
      .filter((d) => d.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const top = active.slice(0, 6);
    const rest = active.slice(6);
    const wedges = top.map((d) => ({ name: d.name, value: Math.abs(d.value), signed: d.value, isOther: false }));
    if (rest.length > 0) {
      const otherSum = rest.reduce((s, d) => s + d.value, 0);
      if (otherSum !== 0) wedges.push({ name: "Other", value: Math.abs(otherSum), signed: otherSum, isOther: true });
    }
    return wedges;
  });

  // Legend reflects every category that actually appeared as its own
  // wedge in at least one period — not a fixed 6, since what's shown
  // individually now varies period to period.
  const legendNames = [];
  periodData.forEach((wedges) =>
    wedges.forEach((w) => {
      if (!w.isOther && !legendNames.includes(w.name)) legendNames.push(w.name);
    })
  );
  const hasOther = periodData.some((wedges) => wedges.some((w) => w.isOther));

  return (
    <div className="panel chart-card">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, justifyContent: periods.length <= 3 ? "center" : "flex-start" }}>
        {periods.map((p, i) => {
          const data = periodData[i];
          const net = periodTotals[i];
          return (
            <div key={p} style={{ textAlign: "center", width: 148 }}>
              <div style={{ position: "relative", height: 148 }}>
                {data.length === 0 ? (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--ink-muted)",
                      fontSize: 12,
                    }}
                  >
                    No activity
                  </div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={data}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="58%"
                        outerRadius="92%"
                        paddingAngle={data.length > 1 ? 2 : 0}
                      >
                        {data.map((d, di) => (
                          <Cell
                            key={di}
                            fill={d.isOther ? "var(--chart-other)" : categoryColor[d.name] || "var(--chart-other)"}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<ReportsDonutTooltip />} wrapperStyle={{ zIndex: 100 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                {data.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: net >= 0 ? "var(--income)" : "var(--expense)",
                      }}
                    >
                      {formatMoney(net)}
                    </div>
                  </div>
                )}
              </div>
              <div className="muted-cell" style={{ fontSize: 12, marginTop: 2 }}>
                {periodLabelFn(p)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted-cell" style={{ fontSize: 11.5, textAlign: "center", marginTop: 16 }}>
        Each donut shows that period's own biggest movers — a category shown alone in one period may be folded
        into "Other" in another, or vice versa, depending on how big it was that period. Hover a wedge to see
        whether it was money in or out.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "center",
          marginTop: 12,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        {legendNames.map((name) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: categoryColor[name] || "var(--chart-other)",
                display: "inline-block",
              }}
            />
            {name}
          </div>
        ))}
        {hasOther && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--chart-other)",
                display: "inline-block",
              }}
            />
            Other
          </div>
        )}
      </div>
    </div>
  );
}

function ReportsView({ transactions, accounts, categories, onGoCategories }) {
  const [periodConfig, setPeriodConfig] = useState(loadReportPeriodConfig);
  const [filterAccount, setFilterAccount] = useState("all");

  function updateConfig(patch) {
    setPeriodConfig((prev) => {
      const next = { ...prev, ...patch };
      saveReportPeriodConfig(next);
      return next;
    });
  }

  const { keyFn: periodKeyFn, labelFn: periodLabelFn } = useMemo(
    () => periodFnsForConfig(periodConfig),
    [periodConfig]
  );

  const trackedCategories = categories.filter((c) => !c.excluded);
  const excludedCategories = categories.filter((c) => c.excluded);
  const trackedIds = new Set(trackedCategories.map((c) => c.id));

  const { periods, rows, periodTotals, grandTotal, totalIn, totalOut } = useMemo(() => {
    let list = transactions;
    if (filterAccount !== "all") list = list.filter((t) => t.accountId === filterAccount);
    list = list.filter((t) => !t.categoryId || trackedIds.has(t.categoryId));

    const periodSet = new Set();
    const rowMap = { uncategorized: {} };
    const catLabel = { uncategorized: "Uncategorized" };
    trackedCategories.forEach((c) => {
      rowMap[c.id] = {};
      catLabel[c.id] = c.name;
    });

    let sumIn = 0;
    let sumOut = 0;

    list.forEach((t) => {
      if (!t.date) return;
      const key = t.categoryId || "uncategorized";
      const pKey = periodKeyFn(t.date);
      periodSet.add(pKey);
      rowMap[key][pKey] = (rowMap[key][pKey] || 0) + (t.amountIn || 0) - (t.amountOut || 0);
      sumIn += t.amountIn || 0;
      sumOut += t.amountOut || 0;
    });

    const periods = Array.from(periodSet).sort();

    const rows = Object.keys(rowMap)
      .filter((key) => Object.keys(rowMap[key]).length > 0)
      .map((key) => {
        const cells = periods.map((p) => rowMap[key][p] || 0);
        const total = cells.reduce((s, v) => s + v, 0);
        return { key, label: catLabel[key], cells, total };
      })
      .sort((a, b) => a.total - b.total);

    const periodTotals = periods.map((p, i) => rows.reduce((s, r) => s + r.cells[i], 0));
    const grandTotal = periodTotals.reduce((s, v) => s + v, 0);

    return { periods, rows, periodTotals, grandTotal, totalIn: sumIn, totalOut: sumOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, categories, filterAccount, periodKeyFn]);

  // Ranked by each category's PEAK value in any single period, not its
  // total across the whole range — a category that's only large once
  // (a one-off repair bill) still earns its own slot during that period,
  // and a category that's reliably large every period (rent) still
  // shows correctly as $0 on a period it truly was $0, instead of a
  // fixed slot going to waste while something that was actually big
  // that period gets buried in "Other". Categories hidden from the
  // charts are filtered out before ranking even happens — not just
  // hidden at render time — so a hidden category never occupies a slot
  // or gets folded into "Other" and inflating it; the chart's own totals
  // recompute around whatever's left visible.
  const hiddenSet = useMemo(() => new Set(periodConfig.hiddenCategories || []), [periodConfig.hiddenCategories]);
  const visibleRows = useMemo(() => rows.filter((r) => !hiddenSet.has(r.key)), [rows, hiddenSet]);

  const rankedCategories = useMemo(() => {
    return [...visibleRows].sort((a, b) => {
      const maxA = Math.max(0, ...a.cells.map((v) => Math.abs(v)));
      const maxB = Math.max(0, ...b.cells.map((v) => Math.abs(v)));
      return maxB - maxA;
    });
  }, [visibleRows]);

  const visiblePeriodTotals = useMemo(
    () => periods.map((_, i) => visibleRows.reduce((s, r) => s + r.cells[i], 0)),
    [periods, visibleRows]
  );

  // A stable name -> color assignment across the FULL ranked list (not
  // just the top 6 shown on the bar chart), so a category keeps the
  // same color everywhere it appears, including in a donut period where
  // it's shown individually even though it isn't in the shared top 6.
  const categoryColor = useMemo(() => {
    const map = {};
    rankedCategories.forEach((r, i) => {
      map[r.label] = CHART_PALETTE[i % CHART_PALETTE.length];
    });
    return map;
  }, [rankedCategories]);

  const chartCategories = useMemo(() => {
    const top = rankedCategories.slice(0, 6);
    const rest = rankedCategories.slice(6);
    if (rest.length > 0) {
      const otherCells = periods.map((_, i) => rest.reduce((s, r) => s + r.cells[i], 0));
      top.push({ key: "other", label: "Other", cells: otherCells, total: otherCells.reduce((s, v) => s + v, 0) });
    }
    return top;
  }, [rankedCategories, periods]);

  const chartData = periods.map((p, i) => {
    const entry = { period: periodLabelFn(p) };
    chartCategories.forEach((c) => {
      entry[c.label] = c.cells[i];
    });
    return entry;
  });

  if (accounts.length === 0 || transactions.length === 0) {
    return (
      <EmptyState
        title="Nothing to report yet"
        body="Once you've imported some transactions and sorted a few into categories, weekly and monthly roll-ups will show up here."
      />
    );
  }

  return (
    <div>
      <div className="view-header">
        <h1>Reports</h1>
        <p>Category totals rolled up on whatever schedule actually matches your pay or budgeting rhythm.</p>
      </div>

      <div className="filter-bar">
        <div className="toggle-group">
          <button
            className={"toggle-btn" + (periodConfig.mode === "weekly" ? " active" : "")}
            onClick={() => updateConfig({ mode: "weekly" })}
          >
            Weekly
          </button>
          <button
            className={"toggle-btn" + (periodConfig.mode === "monthly" ? " active" : "")}
            onClick={() => updateConfig({ mode: "monthly" })}
          >
            Monthly
          </button>
          <button
            className={"toggle-btn" + (periodConfig.mode === "interval" ? " active" : "")}
            onClick={() => updateConfig({ mode: "interval" })}
          >
            Every X days
          </button>
          <button
            className={"toggle-btn" + (periodConfig.mode === "semimonthly" ? " active" : "")}
            onClick={() => updateConfig({ mode: "semimonthly" })}
          >
            Twice a month
          </button>
        </div>
        <div className="toggle-group">
          <button
            className={"toggle-btn" + (periodConfig.chartType !== "donut" ? " active" : "")}
            onClick={() => updateConfig({ chartType: "bar" })}
          >
            Bar chart
          </button>
          <button
            className={"toggle-btn" + (periodConfig.chartType === "donut" ? " active" : "")}
            onClick={() => updateConfig({ chartType: "donut" })}
          >
            Donut chart
          </button>
        </div>
        <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {periodConfig.mode === "interval" && (
        <div className="excluded-note" style={{ justifyContent: "flex-start", gap: 16, marginTop: -8 }}>
          <label className="radio-option" style={{ fontSize: 13 }}>
            Every
            <input
              type="number"
              min="1"
              max="90"
              value={periodConfig.intervalDays}
              onChange={(e) => updateConfig({ intervalDays: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              style={{ width: 56 }}
            />
            days, starting from
            <input
              type="date"
              value={periodConfig.anchorDate}
              onChange={(e) => updateConfig({ anchorDate: e.target.value })}
            />
          </label>
          <span className="muted-cell" style={{ fontSize: 12 }}>
            Use a date you know was a payday — 14 days covers a biweekly schedule.
          </span>
        </div>
      )}

      {periodConfig.mode === "semimonthly" && (
        <div className="excluded-note" style={{ justifyContent: "flex-start", gap: 16, marginTop: -8 }}>
          <label className="radio-option" style={{ fontSize: 13 }}>
            Split each month on the
            <input
              type="number"
              min="1"
              max="31"
              value={periodConfig.semiMonthlyDay1}
              onChange={(e) => updateConfig({ semiMonthlyDay1: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              style={{ width: 48 }}
            />
            and
            <input
              type="number"
              min="1"
              max="31"
              value={periodConfig.semiMonthlyDay2}
              onChange={(e) => updateConfig({ semiMonthlyDay2: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              style={{ width: 48 }}
            />
          </label>
          <span className="muted-cell" style={{ fontSize: 12 }}>
            A day beyond a short month (like the 31st in February) uses that month's last day instead.
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 15 }}>Categories shown in the charts</h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            Hide a category from the bar and donut charts below without affecting anything else — the table
            still shows everything, and the category is still tracked normally in Budget and Planning. Handy
            for keeping something big and steady, like a paycheck or rent, from dominating the visual.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {rows.map((r) => {
              const hidden = hiddenSet.has(r.key);
              return (
                <button
                  key={r.key}
                  className="btn btn-sm"
                  style={
                    hidden
                      ? { border: "1px solid var(--expense)", color: "var(--expense)", background: "var(--panel)" }
                      : { border: "1px solid var(--border)", color: "var(--ink)", background: "var(--panel)" }
                  }
                  onClick={() => {
                    const current = periodConfig.hiddenCategories || [];
                    const next = hidden ? current.filter((id) => id !== r.key) : [...current, r.key];
                    updateConfig({ hiddenCategories: next });
                  }}
                >
                  {r.label} {hidden ? "(hidden) — show" : "— hide"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="summary-row">
        <StatBlock value={formatMoney(totalIn)} label="Tracked money in" />
        <StatBlock value={formatMoney(totalOut)} label="Tracked money out" />
        <StatBlock value={formatMoney(grandTotal)} label="Tracked net" />
      </div>
      {(periodConfig.hiddenCategories || []).length > 0 && (
        <p className="muted-cell" style={{ fontSize: 11.5, marginTop: -12, marginBottom: 16 }}>
          These totals always include every category — the chart below is the only thing reflecting what
          you've hidden.
        </p>
      )}

      {periodConfig.chartType === "donut" ? (
        <ReportsDonutGrid
          periods={periods}
          periodLabelFn={periodLabelFn}
          rows={visibleRows}
          categoryColor={categoryColor}
          periodTotals={visiblePeriodTotals}
        />
      ) : (
        <div className="panel chart-card">
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--ink-muted)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--ink-muted)" }} tickFormatter={(v) => formatMoney(v)} width={72} />
                <Tooltip content={<ReportsTooltip />} wrapperStyle={{ zIndex: 100 }} />
                <Legend wrapperStyle={{ fontSize: 12, zIndex: 1 }} />
                {chartCategories.map((c) => (
                  <Bar
                    key={c.key}
                    dataKey={c.label}
                    stackId="a"
                    fill={c.key === "other" ? "var(--chart-other)" : categoryColor[c.label]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <DualScrollPanel>
        <table className="pivot-table">
          <thead>
            <tr>
              <th>Category</th>
              {periods.map((p) => (
                <th key={p}>{periodLabelFn(p)}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="pivot-row-label">{r.label}</td>
                {r.cells.map((v, i) => (
                  <td key={i} className={v > 0 ? "money-in" : v < 0 ? "money-out" : "muted-cell"}>
                    {v === 0 ? "—" : formatMoney(v)}
                  </td>
                ))}
                <td className={"pivot-total-col " + (r.total > 0 ? "money-in" : r.total < 0 ? "money-out" : "muted-cell")}>
                  {formatMoney(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {periodTotals.map((v, i) => (
                <td key={i} className={v > 0 ? "money-in" : v < 0 ? "money-out" : "muted-cell"}>
                  {formatMoney(v)}
                </td>
              ))}
              <td className={grandTotal > 0 ? "money-in" : grandTotal < 0 ? "money-out" : "muted-cell"}>
                {formatMoney(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </DualScrollPanel>

      {excludedCategories.length > 0 && (
        <div className="excluded-note">
          <span>
            Not counted above: {excludedCategories.map((c) => c.name).join(", ")}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onGoCategories}>
            Manage categories
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Budget view                                                          */
/* ------------------------------------------------------------------ */

function BudgetProgressCard({ item, spent, cumulativeSaved, periodKey, transactions, onSetActual, onAdjustFund }) {
  const budget = item.budgetAmount;
  const isUnassigned = !!item.isUnassignedPseudo;
  const ratio = budget > 0 ? spent / budget : 0;
  const isAccumulate = item.budgetType === "accumulate";
  const barColor = isAccumulate
    ? ratio >= 1
      ? "var(--income)"
      : ratio >= 0.8
      ? "var(--warn-border)"
      : "var(--expense)"
    : ratio >= 1
    ? "var(--expense)"
    : ratio >= 0.8
    ? "var(--warn-border)"
    : "var(--income)";
  const remaining = budget - spent;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(spent));

  function startEdit() {
    setDraft(String(spent));
    setEditing(true);
  }

  function saveEdit() {
    const amount = parseMoney(draft.trim());
    if (amount != null) onSetActual(item.id, periodKey, amount);
    setEditing(false);
  }

  if (isUnassigned) {
    return (
      <div className="budget-card" style={{ borderColor: spent > 0 ? "var(--expense)" : "var(--border)" }}>
        <div className="budget-card-head">
          <span className="budget-card-name">
            {item.name}
            <span className="budget-group-tag" style={{ borderColor: "var(--expense)", color: "var(--expense)" }}>
              unassigned
            </span>
          </span>
          <span className="budget-card-period">{item.budgetPeriod === "weekly" ? "this week" : "this month"}</span>
        </div>
        <div className="budget-card-figures">
          <span className={spent > 0 ? "money-out" : ""} style={{ fontSize: 18, fontWeight: 700 }}>
            {formatMoney(spent)}
          </span>
          <br />
          <span className="muted-cell">
            {spent > 0
              ? "spent in categories with no budget — not covered by any plan"
              : "nothing untracked this period"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="budget-card">
      <div className="budget-card-head">
        <span className="budget-card-name">
          {item.name}
          {item.isGroup && <span className="budget-group-tag">group</span>}
          {isAccumulate && (
            <span className="budget-group-tag" style={{ borderColor: "var(--income)", color: "var(--income)" }}>
              saving
            </span>
          )}
        </span>
        <span className="budget-card-period">{item.budgetPeriod === "weekly" ? "this week" : "this month"}</span>
      </div>
      <div className="budget-bar-track">
        <div className="budget-bar-fill" style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%`, background: barColor }} />
      </div>
      <div className="budget-card-figures">
        {editing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <input
              type="text"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              style={{ width: 80, fontFamily: "inherit", fontSize: 13, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 4 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={saveEdit}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className={!isAccumulate && ratio >= 1 ? "money-out" : ""}>{formatMoney(spent)}</span>
            <span className="muted-cell"> {isAccumulate ? "set aside of" : "of"} {formatMoney(budget)}{isAccumulate ? " planned" : ""}</span>
            {isAccumulate && (
              <button className="btn btn-ghost btn-sm" onClick={startEdit} style={{ marginLeft: 6, padding: "1px 6px" }}>
                Adjust
              </button>
            )}
            <br />
            {isAccumulate ? (
              remaining > 0 ? (
                <span className="money-out">{formatMoney(remaining)} short this period</span>
              ) : (
                <span className="money-in">On track{remaining < 0 ? ` (+${formatMoney(Math.abs(remaining))})` : ""}</span>
              )
            ) : remaining >= 0 ? (
              <span className="money-in">{formatMoney(remaining)} left</span>
            ) : (
              <span className="money-out">{formatMoney(Math.abs(remaining))} over</span>
            )}
          </>
        )}
      </div>
      {isAccumulate && (
        <FundBalanceSection item={item} cumulativeSaved={cumulativeSaved} transactions={transactions} onAdjustFund={onAdjustFund} />
      )}
    </div>
  );
}

function FundBalanceSection({ item, cumulativeSaved, transactions, onAdjustFund }) {
  const { balance, contributed, withdrawn, adjusted } = computeFundBalance(item, cumulativeSaved, transactions);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(balance.toFixed(2));
  const isOverdrawn = balance < 0;
  const target = item.accumulateTarget;
  const targetRatio = target > 0 ? Math.max(0, Math.min(balance / target, 1)) : null;

  function startEdit() {
    setDraft(balance.toFixed(2));
    setEditing(true);
  }

  function saveEdit() {
    const newBalance = parseMoney(draft.trim());
    if (newBalance != null && Math.abs(newBalance - balance) > 0.001) {
      onAdjustFund(item.id, newBalance - balance);
    }
    setEditing(false);
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="muted-cell" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em" }}>
          Fund balance
        </span>
        {!editing && (
          <button className="btn btn-ghost btn-sm" onClick={startEdit} style={{ padding: "1px 6px" }}>
            Adjust
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: 100,
              fontFamily: "inherit",
              fontSize: 15,
              padding: "4px 6px",
              border: "1px solid var(--border)",
              borderRadius: 4,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={saveEdit}>
            Save
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 20, fontWeight: 700, color: isOverdrawn ? "var(--expense)" : "var(--income)" }}>
          {isOverdrawn ? "\u2212" : ""}
          {formatMoney(Math.abs(balance))}
          {isOverdrawn && <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 6 }}>overdrawn</span>}
        </div>
      )}

      {!editing && (withdrawn !== 0 || adjusted !== 0) && (
        <div className="muted-cell" style={{ fontSize: 11 }}>
          {formatMoney(contributed)} contributed
          {withdrawn > 0 && <> {"\u2212"} {formatMoney(withdrawn)} spent</>}
          {withdrawn < 0 && <> + {formatMoney(Math.abs(withdrawn))} added</>}
          {adjusted !== 0 && (
            <>
              {" "}
              {adjusted > 0 ? "+" : "\u2212"} {formatMoney(Math.abs(adjusted))} adjusted
            </>
          )}
        </div>
      )}

      {target > 0 ? (
        <>
          <div className="budget-bar-track" style={{ height: 6, marginTop: 6 }}>
            <div
              className="budget-bar-fill"
              style={{ width: `${(targetRatio || 0) * 100}%`, background: isOverdrawn ? "var(--expense)" : "var(--accent)" }}
            />
          </div>
          <div className="muted-cell" style={{ fontSize: 12 }}>
            {Math.round((targetRatio || 0) * 100)}% of {formatMoney(target)} goal
          </div>
        </>
      ) : (
        <div className="muted-cell" style={{ fontSize: 12, marginTop: 4 }}>
          No target set
        </div>
      )}
    </div>
  );
}

// Positive = good, negative = bad, regardless of item type — for a Spend
// item, coming in under budget is good; for an Accumulate item, meeting
// or beating the planned contribution is good, which is the opposite
// direction. This is what lets a chart or total blend both types into
// one consistent number instead of contradicting the per-item coloring.
function budgetPerformance(item, actual) {
  const budget = item.budgetAmount || 0;
  return item.budgetType === "accumulate" ? actual - budget : budget - actual;
}

// The actual money currently sitting in an Accumulate fund: everything
// contributed since it started (the same total already shown as
// "cumulative saved"), less anything actually spent from it — a real
// transaction tagged to the category, not the assumed per-period
// contribution — plus any manual corrections the user has logged. This
// is deliberately derived fresh from current data rather than an
// incrementally-updated counter: if a withdrawal transaction later gets
// recategorized away, it stops counting against this fund automatically,
// with no special "give it back" logic needed.
function computeFundBalance(item, contributionsTotal, transactions) {
  let netWithdrawn = 0;
  transactions.forEach((t) => {
    if (t.categoryId && item.categoryIds && item.categoryIds.has(t.categoryId)) {
      netWithdrawn += (t.amountOut || 0) - (t.amountIn || 0);
    }
  });
  const adjusted = (item.fundAdjustments || []).reduce((s, a) => s + (a.amount || 0), 0);
  return {
    balance: contributionsTotal - netWithdrawn + adjusted,
    contributed: contributionsTotal,
    withdrawn: netWithdrawn,
    adjusted,
  };
}

// Same contribution math computeBudgetPeriodData uses for Accumulate
// items, but for a single category or group in isolation — used where
// pulling in the whole Budget pipeline would be overkill, like a delete
// confirmation warning.
function computeAccumulateContributionTotal(item) {
  if (item.budgetType !== "accumulate" || !item.budgetAmount) return 0;
  const periodType = item.budgetPeriod || "monthly";
  const periodKeyFn = periodType === "weekly" ? getWeekStartISO : getMonthStartISO;
  const currentKey = periodKeyFn(new Date().toISOString().slice(0, 10));
  const startKey = item.createdAt ? periodKeyFn(item.createdAt.slice(0, 10)) : currentKey;
  const periods = enumeratePeriodsBetween(startKey, currentKey, periodType);
  Object.keys(item.accumulateActuals || {}).forEach((k) => {
    if (!periods.includes(k)) periods.push(k);
  });
  return periods.reduce((sum, p) => {
    const override = (item.accumulateActuals || {})[p];
    return sum + (override != null ? override : item.budgetAmount);
  }, 0);
}

function computeItemFundBalance(item, categoryIds, transactions) {
  const contributionsTotal = computeAccumulateContributionTotal(item);
  return computeFundBalance({ ...item, categoryIds }, contributionsTotal, transactions).balance;
}

function BudgetHistoryTable({ budgeted, periods, spendMap, periodLabelFn }) {
  return (
    <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
      <table className="pivot-table">
        <thead>
          <tr>
            <th>Category</th>
            {periods.map((p) => (
              <th key={p}>{periodLabelFn(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {budgeted.map((c) => (
            <tr key={c.id}>
              <td className="pivot-row-label">
                <div>
                  {c.name}
                  {c.isGroup && <span className="budget-group-tag">group</span>}
                </div>
                <div className="pivot-row-budget">
                  {c.isUnassignedPseudo ? "No budget" : `Budget: ${formatMoney(c.budgetAmount)}`}
                </div>
              </td>
              {periods.map((p) => {
                const spent = spendMap[c.id]?.[p] || 0;
                const perf = budgetPerformance(c, spent);
                const cls = perf >= 0 ? "money-in" : "money-out";
                return (
                  <td key={p} className={cls}>
                    <div style={{ fontWeight: 600 }}>
                      {perf >= 0 ? "+" : "\u2212"}
                      {formatMoney(Math.abs(perf))}
                    </div>
                    <div className="muted-cell" style={{ fontSize: 11 }}>
                      {formatMoney(spent)} {c.budgetType === "accumulate" ? "saved" : "spent"}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pivot-row-label" style={{ fontWeight: 700 }}>
              Total
            </td>
            {periods.map((p) => {
              const totalSpent = budgeted.reduce((s, b) => s + (spendMap[b.id]?.[p] || 0), 0);
              const totalBudget = budgeted.reduce((s, b) => s + (b.budgetAmount || 0), 0);
              const perf = budgeted.reduce((s, b) => s + budgetPerformance(b, spendMap[b.id]?.[p] || 0), 0);
              const cls = perf >= 0 ? "money-in" : "money-out";
              return (
                <td key={p} className={cls}>
                  <div style={{ fontWeight: 700 }}>
                    {formatMoney(totalSpent)} / {formatMoney(totalBudget)}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>
                    {perf >= 0 ? "+" : "\u2212"}
                    {formatMoney(Math.abs(perf))}
                  </div>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function BudgetPerformanceChart({ title, periods, budgeted, spendMap, periodLabelFn }) {
  const data = periods.map((p) => {
    const delta = budgeted.reduce((s, b) => s + budgetPerformance(b, spendMap[b.id]?.[p] || 0), 0);
    return { period: periodLabelFn(p), delta };
  });

  return (
    <div className="panel chart-card">
      <div className="hint" style={{ marginBottom: 4 }}>
        {title} — how much was saved (green, above the line) or overspent (red, below it) that period,
        combined across every budgeted category and group on this cadence
      </div>
      <div className="chart-wrap" style={{ height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--ink-muted)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--ink-muted)" }} tickFormatter={(v) => formatMoney(v)} width={72} />
            <ReferenceLine y={0} stroke="var(--ink-muted)" />
            <Tooltip
              formatter={(value) => formatMoney(value)}
              wrapperStyle={{ zIndex: 100 }}
              contentStyle={{
                fontSize: 12.5,
                fontFamily: "'Work Sans', sans-serif",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--panel)",
                boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
              }}
              itemStyle={{ color: "var(--ink)" }}
              labelStyle={{ color: "var(--ink)" }}
            />
            <Bar dataKey="delta">
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.delta >= 0 ? "var(--income)" : "var(--expense)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// A category's spending counts as genuinely tracked only if it (or the
// group it belongs to) has an actual positive budget — matching exactly
// what computeBudgetPeriodData will include. A category sitting in a
// group that itself has no budget set is just as untracked as one with
// no group at all, even though it looks "handled" at a glance.
// Categories excluded from totals (e.g. Transfers) are never "unassigned"
// spending — they're deliberately outside budget tracking altogether.
// Neither is a category flagged as Income (paychecks etc.) — it isn't
// expense spending at all, so it should never count as untracked
// spending regardless of whether it has a budget.
function getUnassignedCategoryIds(categories, budgetGroups) {
  const trackedByGroup = new Set();
  budgetGroups.forEach((g) => {
    if (g.budgetAmount != null && g.budgetAmount > 0) {
      (g.categoryIds || []).forEach((id) => trackedByGroup.add(id));
    }
  });
  const unassigned = new Set();
  categories.forEach((c) => {
    if (c.excluded) return;
    if (c.isIncome) return;
    if (trackedByGroup.has(c.id)) return;
    if (c.budgetAmount != null && c.budgetAmount > 0) return;
    unassigned.add(c.id);
  });
  return unassigned;
}

function buildBudgetItems(categories, budgetGroups) {
  const groupedCategoryIds = new Set();
  budgetGroups.forEach((g) => (g.categoryIds || []).forEach((id) => groupedCategoryIds.add(id)));

  const groupItems = budgetGroups.map((g) => ({
    id: "group:" + g.id,
    name: g.name,
    budgetAmount: g.budgetAmount,
    budgetPeriod: g.budgetPeriod,
    budgetType: g.budgetType || "spend",
    accumulateTarget: g.accumulateTarget,
    accumulateActuals: g.accumulateActuals || {},
    createdAt: g.createdAt,
    categoryIds: new Set(g.categoryIds || []),
    isGroup: true,
  }));

  const categoryItems = categories
    .filter((c) => !groupedCategoryIds.has(c.id))
    .map((c) => ({
      id: "cat:" + c.id,
      name: c.name,
      budgetAmount: c.budgetAmount,
      budgetPeriod: c.budgetPeriod,
      budgetType: c.budgetType || "spend",
      accumulateTarget: c.accumulateTarget,
      accumulateActuals: c.accumulateActuals || {},
      createdAt: c.createdAt,
      categoryIds: new Set([c.id]),
      isGroup: false,
    }));

  return [...groupItems, ...categoryItems];
}

function BudgetView({
  transactions,
  categories,
  budgetGroups,
  hiddenBudgetMonths,
  excludeUnassignedFromBudget,
  onSetActual,
  onAdjustFund,
  onToggleHiddenMonth,
  onGoCategories,
}) {
  const budgetItems = useMemo(() => buildBudgetItems(categories, budgetGroups), [categories, budgetGroups]);
  const unassignedCategoryIds = useMemo(
    () => getUnassignedCategoryIds(categories, budgetGroups),
    [categories, budgetGroups]
  );

  function withUnassignedPseudo(items, periodType) {
    if (excludeUnassignedFromBudget || unassignedCategoryIds.size === 0) return items;
    return [
      ...items,
      {
        id: "unassigned-expenses",
        name: "Unassigned Expenses",
        budgetAmount: 0,
        budgetPeriod: periodType,
        budgetType: "spend",
        accumulateTarget: null,
        accumulateActuals: {},
        createdAt: null,
        categoryIds: unassignedCategoryIds,
        isGroup: false,
        isUnassignedPseudo: true,
      },
    ];
  }

  const weeklyBudgetItems = useMemo(
    () => withUnassignedPseudo(budgetItems, "weekly"),
    [budgetItems, unassignedCategoryIds, excludeUnassignedFromBudget]
  );
  const monthlyBudgetItems = useMemo(
    () => withUnassignedPseudo(budgetItems, "monthly"),
    [budgetItems, unassignedCategoryIds, excludeUnassignedFromBudget]
  );

  const weeklyData = useMemo(
    () => computeBudgetPeriodData(transactions, weeklyBudgetItems, "weekly"),
    [transactions, weeklyBudgetItems]
  );
  const monthlyData = useMemo(
    () => computeBudgetPeriodData(transactions, monthlyBudgetItems, "monthly"),
    [transactions, monthlyBudgetItems]
  );

  const hasBudgets = (weeklyData && weeklyData.budgeted.length > 0) || (monthlyData && monthlyData.budgeted.length > 0);

  if (!hasBudgets) {
    return (
      <EmptyState
        title="No budgets set yet"
        body="Set a weekly or monthly budget on any category from the Categories tab (or roll several into a Budget Group first), and your progress will show up here."
        ctaLabel="Go to Categories"
        onCta={onGoCategories}
      />
    );
  }

  function cumulativeFor(data, itemId) {
    if (!data) return 0;
    const cells = data.spendMap[itemId] || {};
    return Object.values(cells).reduce((s, v) => s + v, 0);
  }

  const hiddenSet = new Set(hiddenBudgetMonths || []);

  // Only the chart and history table look at this — the "this week/this
  // month" progress cards above them are about the live current period,
  // which doesn't make sense to hide.
  function visiblePeriods(data) {
    if (!data) return [];
    return data.periods.filter((p) => !hiddenSet.has(getMonthStartISO(p)));
  }
  const weeklyVisiblePeriods = visiblePeriods(weeklyData);
  const monthlyVisiblePeriods = visiblePeriods(monthlyData);

  const allMonthsPresent = useMemo(() => {
    const months = new Set();
    (weeklyData?.periods || []).forEach((p) => months.add(getMonthStartISO(p)));
    (monthlyData?.periods || []).forEach((p) => months.add(p));
    return Array.from(months).sort();
  }, [weeklyData, monthlyData]);

  return (
    <div>
      <div className="view-header">
        <h1>Budget</h1>
        <p>
          How you're tracking against what you've budgeted, by category or group. "Spent" here means money out
          minus money in — for Accumulate items, it means what's been set aside.
        </p>
      </div>

      {weeklyData && (
        <>
          <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 16 }}>This week</h3>
          <div className="budget-card-grid">
            {weeklyData.budgeted.map((item) => (
              <BudgetProgressCard
                key={item.id}
                item={item}
                spent={weeklyData.spendMap[item.id]?.[weeklyData.currentKey] || 0}
                cumulativeSaved={cumulativeFor(weeklyData, item.id)}
                periodKey={weeklyData.currentKey}
                transactions={transactions}
                onSetActual={onSetActual}
                onAdjustFund={onAdjustFund}
              />
            ))}
          </div>
        </>
      )}

      {monthlyData && (
        <>
          <h3 style={{ marginBottom: 10, fontSize: 16 }}>This month</h3>
          <div className="budget-card-grid">
            {monthlyData.budgeted.map((item) => (
              <BudgetProgressCard
                key={item.id}
                item={item}
                spent={monthlyData.spendMap[item.id]?.[monthlyData.currentKey] || 0}
                cumulativeSaved={cumulativeFor(monthlyData, item.id)}
                periodKey={monthlyData.currentKey}
                transactions={transactions}
                onSetActual={onSetActual}
                onAdjustFund={onAdjustFund}
              />
            ))}
          </div>
        </>
      )}

      {allMonthsPresent.length > 0 && (
        <>
          <h3 style={{ marginBottom: 10, fontSize: 16 }}>Excluded months</h3>
          <div className="panel" style={{ marginBottom: 22 }}>
            <p className="hint" style={{ marginBottom: 10 }}>
              Hide a month from the chart and history below — handy for a starting month that's only partially
              imported and throws everything else off.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {allMonthsPresent.map((m) => {
                const hidden = hiddenSet.has(m);
                return (
                  <button
                    key={m}
                    className="btn btn-sm"
                    style={
                      hidden
                        ? { border: "1px solid var(--expense)", color: "var(--expense)", background: "var(--panel)" }
                        : { border: "1px solid var(--border)", color: "var(--ink)", background: "var(--panel)" }
                    }
                    onClick={() => onToggleHiddenMonth(m)}
                  >
                    {formatMonthLabel(m)} {hidden ? "(hidden) — show" : "— hide"}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {weeklyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginBottom: 10, fontSize: 16 }}>Weekly performance</h3>
          <BudgetPerformanceChart
            title="Weekly"
            periods={weeklyVisiblePeriods}
            budgeted={weeklyData.budgeted}
            spendMap={weeklyData.spendMap}
            periodLabelFn={formatWeekLabel}
          />
        </>
      )}

      {monthlyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Monthly performance</h3>
          <BudgetPerformanceChart
            title="Monthly"
            periods={monthlyVisiblePeriods}
            budgeted={monthlyData.budgeted}
            spendMap={monthlyData.spendMap}
            periodLabelFn={formatMonthLabel}
          />
        </>
      )}

      {weeklyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Weekly history</h3>
          <BudgetHistoryTable
            budgeted={weeklyData.budgeted}
            periods={weeklyVisiblePeriods}
            spendMap={weeklyData.spendMap}
            periodLabelFn={formatWeekLabel}
          />
        </>
      )}

      {monthlyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Monthly history</h3>
          <BudgetHistoryTable
            budgeted={monthlyData.budgeted}
            periods={monthlyVisiblePeriods}
            spendMap={monthlyData.spendMap}
            periodLabelFn={formatMonthLabel}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Budget groups view                                                   */
/* ------------------------------------------------------------------ */

function BudgetGroupCard({ group, allCategories, transactions, onRename, onSetBudget, onAddCategory, onRemoveCategory, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const [confirming, setConfirming] = useState(false);
  const [budgetAmountDraft, setBudgetAmountDraft] = useState(
    group.budgetAmount != null ? String(group.budgetAmount) : ""
  );
  const [budgetPeriodDraft, setBudgetPeriodDraft] = useState(group.budgetPeriod || "monthly");
  const [budgetTypeDraft, setBudgetTypeDraft] = useState(group.budgetType || "spend");
  const [accumulateTargetDraft, setAccumulateTargetDraft] = useState(
    group.accumulateTarget != null ? String(group.accumulateTarget) : ""
  );
  const [startDateDraft, setStartDateDraft] = useState(
    group.createdAt ? group.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [addCategoryId, setAddCategoryId] = useState("");

  const memberCategories = allCategories.filter((c) => (group.categoryIds || []).includes(c.id));
  const availableCategories = allCategories.filter((c) => !(group.categoryIds || []).includes(c.id));

  function startEdit() {
    setDraftName(group.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== group.name) onRename(group.id, trimmed);
    setEditing(false);
  }

  function handleSaveBudget() {
    const trimmed = budgetAmountDraft.trim();
    const amount = trimmed === "" ? null : parseMoney(trimmed);
    const targetTrimmed = accumulateTargetDraft.trim();
    const target = targetTrimmed === "" ? null : parseMoney(targetTrimmed);
    onSetBudget(
      group.id,
      amount != null && amount > 0 ? amount : null,
      budgetPeriodDraft,
      budgetTypeDraft,
      target != null && target > 0 ? target : null,
      budgetTypeDraft === "accumulate" ? startDateDraft : null
    );
  }

  function handleAddCategory() {
    if (!addCategoryId) return;
    onAddCategory(group.id, addCategoryId);
    setAddCategoryId("");
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 10 }}>
        {editing ? (
          <div className="row-actions">
            <input
              type="text"
              value={draftName}
              autoFocus
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={saveEdit}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="name" style={{ fontSize: 16 }}>
            {group.name}
            <button className="btn btn-ghost btn-sm" onClick={startEdit}>
              Rename
            </button>
          </div>
        )}
        {confirming ? (
          <span className="confirm-inline">
            Delete this group? Its categories stay — they just go back to being ungrouped.
            {group.budgetType === "accumulate" &&
              (() => {
                const balance = computeItemFundBalance(group, new Set(group.categoryIds || []), transactions || []);
                return Math.abs(balance) > 0.01 ? (
                  <strong style={{ color: "var(--expense)" }}>
                    {" "}
                    This fund currently shows {formatMoney(balance)} — deleting it won't move that money
                    anywhere, it'll just stop being tracked.
                  </strong>
                ) : null;
              })()}
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(group.id)}>
              Confirm
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
            Delete group
          </button>
        )}
      </div>

      <div className="hint" style={{ marginBottom: 8 }}>
        Categories in this group
      </div>
      {memberCategories.length === 0 ? (
        <div className="hint" style={{ marginBottom: 12 }}>
          None yet — add one below.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {memberCategories.map((c) => (
            <span className="group-chip" key={c.id}>
              {c.name}
              <button className="group-chip-remove" onClick={() => onRemoveCategory(group.id, c.id)} title="Remove from group">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {availableCategories.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <select value={addCategoryId} onChange={(e) => setAddCategoryId(e.target.value)}>
            <option value="">Add a category…</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={handleAddCategory} disabled={!addCategoryId}>
            Add
          </button>
        </div>
      )}

      <div className="budget-row" style={{ marginTop: 0 }}>
        <span className="budget-row-label">Group budget:</span>
        <input
          type="text"
          className="budget-amount-input"
          placeholder="none"
          value={budgetAmountDraft}
          onChange={(e) => setBudgetAmountDraft(e.target.value)}
        />
        <select value={budgetPeriodDraft} onChange={(e) => setBudgetPeriodDraft(e.target.value)}>
          <option value="weekly">per week</option>
          <option value="monthly">per month</option>
        </select>
        <select value={budgetTypeDraft} onChange={(e) => setBudgetTypeDraft(e.target.value)}>
          <option value="spend">Spend</option>
          <option value="accumulate">Accumulate</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={handleSaveBudget}>
          Save
        </button>
      </div>
      {budgetTypeDraft === "accumulate" && (
        <div className="budget-row" style={{ marginTop: 4 }}>
          <span className="budget-row-label" style={{ fontWeight: 400 }}>
            Target (optional):
          </span>
          <input
            type="text"
            className="budget-amount-input"
            placeholder="e.g. 3000"
            value={accumulateTargetDraft}
            onChange={(e) => setAccumulateTargetDraft(e.target.value)}
          />
        </div>
      )}
      {budgetTypeDraft === "accumulate" && (
        <div className="budget-row" style={{ marginTop: 4 }}>
          <span className="budget-row-label" style={{ fontWeight: 400 }}>
            Track since:
          </span>
          <input
            type="date"
            value={startDateDraft}
            onChange={(e) => setStartDateDraft(e.target.value)}
          />
          <span className="muted-cell" style={{ fontSize: 11.5 }}>
            Backdate this to see how you've been doing over past periods, not just from today forward.
          </span>
        </div>
      )}
    </div>
  );
}

function BudgetGroupsView({ budgetGroups, categories, transactions, onAdd, onRename, onDelete, onSetBudget, onAddCategory, onRemoveCategory }) {
  const [newName, setNewName] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setNewName("");
  }

  return (
    <div>
      <div className="view-header">
        <h1>Budget Groups</h1>
        <p>
          Roll several categories up into one shared budget — like combining every "Entertainment" category
          into a single target instead of budgeting each one separately.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <form onSubmit={handleAdd} style={{ display: "flex", gap: 10 }}>
          <input
            type="text"
            placeholder="New group name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{
              flex: 1,
              fontFamily: "inherit",
              fontSize: 14,
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>
            Add group
          </button>
        </form>
      </div>

      {budgetGroups.length === 0 ? (
        <div className="panel">
          <div className="hint">No groups yet — add one above, like "Entertainment" or "Essential."</div>
        </div>
      ) : (
        budgetGroups.map((g) => (
          <BudgetGroupCard
            key={g.id}
            group={g}
            allCategories={categories}
            transactions={transactions}
            onRename={onRename}
            onSetBudget={onSetBudget}
            onAddCategory={onAddCategory}
            onRemoveCategory={onRemoveCategory}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Planning view                                                        */
/* ------------------------------------------------------------------ */

function PlanningCategoryRow({ category, groupName, onSetBudget }) {
  const [budgetAmountDraft, setBudgetAmountDraft] = useState(
    category.budgetAmount != null ? String(category.budgetAmount) : ""
  );
  const [budgetPeriodDraft, setBudgetPeriodDraft] = useState(category.budgetPeriod || "monthly");
  const [budgetTypeDraft, setBudgetTypeDraft] = useState(category.budgetType || "spend");
  const [accumulateTargetDraft, setAccumulateTargetDraft] = useState(
    category.accumulateTarget != null ? String(category.accumulateTarget) : ""
  );
  const [startDateDraft, setStartDateDraft] = useState(
    category.createdAt ? category.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );

  function handleSave() {
    const trimmed = budgetAmountDraft.trim();
    const amount = trimmed === "" ? null : parseMoney(trimmed);
    const targetTrimmed = accumulateTargetDraft.trim();
    const target = targetTrimmed === "" ? null : parseMoney(targetTrimmed);
    onSetBudget(
      category.id,
      amount != null && amount > 0 ? amount : null,
      budgetPeriodDraft,
      budgetTypeDraft,
      target != null && target > 0 ? target : null,
      budgetTypeDraft === "accumulate" ? startDateDraft : null
    );
  }

  if (groupName) {
    return (
      <div className="account-card">
        <div>
          <div className="name">{category.name}</div>
          <div className="meta">Budgeted as part of the "{groupName}" group — manage it from Budget Groups.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="account-card">
      <div>
        <div className="name">{category.name}</div>
        <div className="budget-row" style={{ marginTop: 6 }}>
          <span className="budget-row-label">Budget:</span>
          <input
            type="text"
            className="budget-amount-input"
            placeholder="none"
            value={budgetAmountDraft}
            onChange={(e) => setBudgetAmountDraft(e.target.value)}
          />
          <select value={budgetPeriodDraft} onChange={(e) => setBudgetPeriodDraft(e.target.value)}>
            <option value="weekly">per week</option>
            <option value="monthly">per month</option>
          </select>
          <select value={budgetTypeDraft} onChange={(e) => setBudgetTypeDraft(e.target.value)}>
            <option value="spend">Spend</option>
            <option value="accumulate">Accumulate</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={handleSave}>
            Save
          </button>
        </div>
        {budgetTypeDraft === "accumulate" && (
          <div className="budget-row" style={{ marginTop: 4 }}>
            <span className="budget-row-label" style={{ fontWeight: 400 }}>
              Target (optional):
            </span>
            <input
              type="text"
              className="budget-amount-input"
              placeholder="e.g. 3000"
              value={accumulateTargetDraft}
              onChange={(e) => setAccumulateTargetDraft(e.target.value)}
            />
          </div>
        )}
        {budgetTypeDraft === "accumulate" && (
          <div className="budget-row" style={{ marginTop: 4 }}>
            <span className="budget-row-label" style={{ fontWeight: 400 }}>
              Track since:
            </span>
            <input type="date" value={startDateDraft} onChange={(e) => setStartDateDraft(e.target.value)} />
            <span className="muted-cell" style={{ fontSize: 11.5 }}>
              Backdate this to see how you've been doing over past periods, not just from today forward.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanningView({
  transactions,
  categories,
  budgetGroups,
  plannedIncome,
  incomeWarningDismissed,
  excludeUnassignedFromBudget,
  onSetPlannedIncome,
  onDismissIncomeWarning,
  onSetCategoryBudget,
  onToggleExcludeUnassigned,
}) {
  const [draft, setDraft] = useState(plannedIncome != null ? String(plannedIncome) : "");
  const [editing, setEditing] = useState(plannedIncome == null);

  const budgetItems = useMemo(() => buildBudgetItems(categories, budgetGroups), [categories, budgetGroups]);
  const budgeted = budgetItems.filter((b) => b.budgetAmount != null && b.budgetAmount > 0);
  const totalAssigned = budgeted.reduce((s, b) => s + monthlyEquivalent(b.budgetAmount, b.budgetPeriod), 0);
  const unassigned = (plannedIncome || 0) - totalAssigned;

  const groupNameByCategoryId = useMemo(() => {
    const map = {};
    budgetGroups.forEach((g) => (g.categoryIds || []).forEach((id) => (map[id] = g.name)));
    return map;
  }, [budgetGroups]);

  const unassignedIdSet = useMemo(
    () => getUnassignedCategoryIds(categories, budgetGroups),
    [categories, budgetGroups]
  );
  const incomeCategories = categories.filter((c) => c.isIncome);
  const unassignedCategories = categories.filter((c) => unassignedIdSet.has(c.id));
  const budgetedCategories = categories.filter(
    (c) => !c.isIncome && !unassignedIdSet.has(c.id) && !groupNameByCategoryId[c.id]
  );
  const groupedCategories = categories.filter(
    (c) => !c.isIncome && !unassignedIdSet.has(c.id) && groupNameByCategoryId[c.id]
  );

  const unassignedSpendThisMonth = useMemo(() => {
    const ids = new Set(unassignedCategories.map((c) => c.id));
    const thisMonth = getMonthStartISO(new Date().toISOString().slice(0, 10));
    let total = 0;
    transactions.forEach((t) => {
      if (!t.categoryId || !ids.has(t.categoryId) || !t.date) return;
      if (getMonthStartISO(t.date) !== thisMonth) return;
      total += (t.amountOut || 0) - (t.amountIn || 0);
    });
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, categories, groupNameByCategoryId]);

  const monthlyActualIncome = useMemo(() => {
    const excludedIds = new Set(categories.filter((c) => c.excluded).map((c) => c.id));
    const incomeIds = new Set(categories.filter((c) => c.isIncome).map((c) => c.id));
    // Once at least one category is flagged as Income, use only those —
    // more precise than counting every stray refund as "income." Until
    // then, fall back to the old broad behavior so nothing changes for
    // anyone who hasn't used the new flag yet.
    const restrictToIncomeFlag = incomeIds.size > 0;
    const byMonth = {};
    transactions.forEach((t) => {
      if (!t.date) return;
      if (t.categoryId && excludedIds.has(t.categoryId)) return;
      if (restrictToIncomeFlag && !(t.categoryId && incomeIds.has(t.categoryId))) return;
      const mKey = getMonthStartISO(t.date);
      byMonth[mKey] = (byMonth[mKey] || 0) + (t.amountIn || 0);
    });
    return byMonth;
  }, [transactions, categories]);

  // The earliest month with ANY transaction data is often partial too —
  // e.g. an account added mid-month — not just the current, still-in-
  // progress month. Both get excluded so the average is only ever built
  // from genuinely complete calendar months.
  const earliestDataMonthKey = useMemo(() => {
    let earliest = null;
    transactions.forEach((t) => {
      if (!t.date) return;
      if (earliest === null || t.date < earliest) earliest = t.date;
    });
    return earliest ? getMonthStartISO(earliest) : null;
  }, [transactions]);

  const currentMonthKey = getMonthStartISO(new Date().toISOString().slice(0, 10));
  const completeMonths = Object.keys(monthlyActualIncome)
    .filter((k) => k < currentMonthKey && k !== earliestDataMonthKey)
    .sort();
  const recentMonths = completeMonths.slice(-6);
  const avgActualIncome =
    recentMonths.length > 0
      ? recentMonths.reduce((s, k) => s + monthlyActualIncome[k], 0) / recentMonths.length
      : null;
  const incomeDriftPct =
    avgActualIncome != null && plannedIncome > 0 ? ((avgActualIncome - plannedIncome) / plannedIncome) * 100 : null;
  const showIncomeDriftWarning =
    !incomeWarningDismissed && recentMonths.length >= 2 && incomeDriftPct != null && Math.abs(incomeDriftPct) >= 10;

  function handleSave() {
    const amount = draft.trim() === "" ? null : parseMoney(draft.trim());
    onSetPlannedIncome(amount != null && amount > 0 ? amount : null);
    setEditing(false);
  }

  return (
    <div>
      <div className="view-header">
        <h1>Planning</h1>
        <p>Set your planned monthly income, then see how much of it is already assigned across your budgets.</p>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Planned monthly income</h3>
        {editing ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="e.g. 4000"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                fontFamily: "inherit",
                fontSize: 14,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                width: 160,
              }}
            />
            <button className="btn btn-primary" onClick={handleSave}>
              Save
            </button>
            {plannedIncome != null && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setDraft(String(plannedIncome));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "'Fraunces', serif", fontSize: 22 }}>{formatMoney(plannedIncome)}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(String(plannedIncome));
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {plannedIncome != null && (
        <>
          <div className="summary-row">
            <StatBlock value={formatMoney(plannedIncome)} label="Planned income" />
            <StatBlock value={formatMoney(totalAssigned)} label="Assigned to budgets" />
            <StatBlock value={formatMoney(unassigned)} label={unassigned >= 0 ? "Unassigned" : "Over-assigned"} />
          </div>

          {unassigned < 0 && (
            <div className="error-banner">
              You've assigned {formatMoney(Math.abs(unassigned))} more than your planned income covers.
            </div>
          )}

          {showIncomeDriftWarning && (
            <div className="error-banner">
              <div>
                Your actual income has averaged {formatMoney(avgActualIncome)}/month over the last{" "}
                {recentMonths.length} month{recentMonths.length === 1 ? "" : "s"} — {Math.abs(Math.round(incomeDriftPct))}%{" "}
                {incomeDriftPct > 0 ? "above" : "below"} your planned {formatMoney(plannedIncome)}. Worth updating
                your plan.
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => onDismissIncomeWarning(true)}
              >
                Dismiss this warning
              </button>
            </div>
          )}

          {incomeWarningDismissed && recentMonths.length >= 2 && incomeDriftPct != null && Math.abs(incomeDriftPct) >= 10 && (
            <div className="hint" style={{ marginBottom: 12 }}>
              Income drift warning dismissed for now.{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => onDismissIncomeWarning(false)}>
                Show it again
              </button>
            </div>
          )}

          <h3 style={{ marginTop: 6, marginBottom: 4, fontSize: 16 }}>Currently Unassigned</h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            These categories have no budget and aren't in a group, so nothing about their spending is being
            tracked.{" "}
            {unassignedCategories.length > 0 && (
              <>
                So far this month: <strong>{formatMoney(unassignedSpendThisMonth)}</strong> across{" "}
                {unassignedCategories.length} categor{unassignedCategories.length === 1 ? "y" : "ies"}.
              </>
            )}
          </p>

          <div className="excluded-note" style={{ marginBottom: 16 }}>
            <label className="radio-option" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={excludeUnassignedFromBudget}
                onChange={(e) => onToggleExcludeUnassigned(e.target.checked)}
              />
              Exclude unassigned spending from the Budget tab
            </label>
          </div>
          {excludeUnassignedFromBudget && (
            <div className="error-banner" style={{ marginBottom: 16 }}>
              With this on, real spending in these categories won't show up anywhere in your Budget totals or
              charts — it's easy to lose track of money going out with nothing keeping an eye on it. Only turn
              this off if you're confident you don't need the reminder.
            </div>
          )}

          {categories.length === 0 ? (
            <div className="panel">
              <div className="hint">No categories yet — add some from the Categories tab first.</div>
            </div>
          ) : (
            <>
              {unassignedCategories.length === 0 ? (
                <div className="panel">
                  <div className="hint">
                    Nothing unassigned — every category is either budgeted or in a group.
                  </div>
                </div>
              ) : (
                <div className="panel">
                  {unassignedCategories.map((c) => (
                    <PlanningCategoryRow key={c.id} category={c} groupName={null} onSetBudget={onSetCategoryBudget} />
                  ))}
                </div>
              )}

              <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Budgeted</h3>
              {budgetedCategories.length === 0 ? (
                <div className="panel">
                  <div className="hint">None yet — set a budget on a category above.</div>
                </div>
              ) : (
                <div className="panel">
                  {budgetedCategories.map((c) => (
                    <PlanningCategoryRow key={c.id} category={c} groupName={null} onSetBudget={onSetCategoryBudget} />
                  ))}
                </div>
              )}

              {groupedCategories.length > 0 && (
                <>
                  <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Part of a group</h3>
                  <div className="panel">
                    {groupedCategories.map((c) => (
                      <PlanningCategoryRow
                        key={c.id}
                        category={c}
                        groupName={groupNameByCategoryId[c.id]}
                        onSetBudget={onSetCategoryBudget}
                      />
                    ))}
                  </div>
                </>
              )}

              {incomeCategories.length > 0 && (
                <>
                  <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Income</h3>
                  <p className="hint" style={{ marginBottom: 12 }}>
                    Flagged as income, not spending — these are never counted as unassigned, and drive the
                    "actual income" figure above. Toggle this from the Categories tab.
                  </p>
                  <div className="panel">
                    {incomeCategories.map((c) => (
                      <div key={c.id} className="account-card">
                        <div>
                          <div className="name">{c.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Backup view                                                          */
/* ------------------------------------------------------------------ */

function BackupView({ accounts, transactions, categories, budgetGroups, plannedIncome, onRestore, onRestoreBudget }) {
  const [fileInfo, setFileInfo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef(null);

  const [budgetPreview, setBudgetPreview] = useState(null);
  const [budgetParseError, setBudgetParseError] = useState(null);
  const [budgetApplying, setBudgetApplying] = useState(false);
  const [budgetApplied, setBudgetApplied] = useState(false);
  const budgetFileInputRef = useRef(null);

  function handleExport() {
    exportBackupCSV(accounts, transactions, categories);
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    setPreview(null);
    setConfirming(false);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (!headers.includes("Account") || !headers.includes("Date")) {
        throw new Error(
          'This doesn\'t look like a backup file — expected columns like "Account" and "Date". Use a file from this app\'s Export button, or match its column headers exactly.'
        );
      }
      setFileInfo({ headers, rows, fileName: file.name });
      setPreview(buildFromBackupRows(rows));
    } catch (err) {
      setParseError(err.message || "Could not read this file.");
      setFileInfo(null);
    }
  }

  function resetRestore() {
    setFileInfo(null);
    setPreview(null);
    setConfirming(false);
    setParseError(null);
    setRestoring(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleConfirmRestore() {
    if (!preview) return;
    setRestoring(true);
    onRestore(preview.accounts, preview.categories, preview.transactions);
  }

  function handleExportBudget() {
    exportBudgetCSV(categories, budgetGroups, plannedIncome);
  }

  async function handleBudgetFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBudgetParseError(null);
    setBudgetPreview(null);
    setBudgetApplied(false);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (!headers.includes("Row Type") || !headers.includes("Name")) {
        throw new Error(
          'This doesn\'t look like a budget backup file — expected columns like "Row Type" and "Name". Use a file from the Export button below.'
        );
      }
      setBudgetPreview(buildBudgetFromRows(rows, categories, budgetGroups));
    } catch (err) {
      setBudgetParseError(err.message || "Could not read this file.");
    }
  }

  function resetBudgetRestore() {
    setBudgetPreview(null);
    setBudgetParseError(null);
    setBudgetApplying(false);
    setBudgetApplied(false);
    if (budgetFileInputRef.current) budgetFileInputRef.current.value = "";
  }

  function handleApplyBudget() {
    if (!budgetPreview) return;
    setBudgetApplying(true);
    onRestoreBudget(budgetPreview.categories, budgetPreview.budgetGroups, budgetPreview.plannedIncome);
    setBudgetApplying(false);
    setBudgetApplied(true);
  }

  return (
    <div>
      <div className="view-header">
        <h1>Backup</h1>
        <p>Download everything as one CSV file, or rebuild the app's data from a backup file.</p>
      </div>

      <div className="excluded-note" style={{ justifyContent: "flex-start", marginBottom: 16, marginTop: 0 }}>
        <span>
          <strong>Order matters if you're restoring both:</strong> apply the ledger backup first, then the
          budget backup. Budget settings attach to categories by name — the ledger restore is what creates
          those categories in the first place, so applying the budget file before it (or without it) may
          leave some budgets with nothing to attach to.
        </span>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Export</h3>
        <p className="hint" style={{ marginBottom: 12 }}>
          Downloads every transaction across all accounts — with its account and category — as a single CSV.
          Good as a local backup, or to open and review in a spreadsheet.
        </p>
        <button className="btn btn-primary" onClick={handleExport} disabled={transactions.length === 0}>
          Download all data as CSV
        </button>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Restore</h3>
        <p className="hint" style={{ marginBottom: 12 }}>
          Rebuilds accounts, categories, and transactions from a backup file — the same column format the
          Export button above produces ({BACKUP_COLUMNS.join(", ")}). This replaces everything currently in the
          app, it doesn't merge with it.
        </p>

        {parseError && <div className="error-banner">{parseError}</div>}

        {!preview && (
          <label className="file-input-label">
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} />
            <span className="btn btn-secondary">Choose backup file</span>
          </label>
        )}

        {preview && !confirming && (
          <>
            <div className="summary-row">
              <StatBlock value={preview.accounts.length} label="Accounts found" />
              <StatBlock value={preview.categories.length} label="Categories found" />
              <StatBlock value={preview.transactions.length} label="Transactions ready" />
              <StatBlock value={preview.invalid.length} label="Rows skipped" />
            </div>

            {preview.invalid.length > 0 && (
              <>
                <div className="hint" style={{ marginBottom: 8 }}>
                  These rows will be left out:
                </div>
                <div className="invalid-list" style={{ marginBottom: 14 }}>
                  {preview.invalid.slice(0, 50).map((inv) => (
                    <div className="invalid-row" key={inv.rowIndex}>
                      <span>Row {inv.rowIndex + 2}</span>
                      <span className="reason">{inv.reasons.join(", ")}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="actions-row">
              <button
                className="btn btn-danger"
                onClick={() => setConfirming(true)}
                disabled={preview.transactions.length === 0}
              >
                Replace everything with this backup
              </button>
              <button className="btn btn-secondary" onClick={resetRestore}>
                Cancel
              </button>
            </div>
          </>
        )}

        {preview && confirming && (
          <div>
            <div className="error-banner">
              This deletes the {accounts.length} account{accounts.length === 1 ? "" : "s"} and{" "}
              {transactions.length} transaction{transactions.length === 1 ? "" : "s"} currently in the app,
              replacing them with what's in this file. This can't be undone from this screen — if you're on the
              version with account sync, the current data stays recoverable for 7 days from the Household
              panel's Data History.
            </div>
            <div className="actions-row">
              <button className="btn btn-danger" onClick={handleConfirmRestore} disabled={restoring}>
                {restoring ? "Restoring…" : "Yes, replace everything"}
              </button>
              <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Budget data</h3>
        <p className="hint" style={{ marginBottom: 12 }}>
          A separate backup just for your budget setup — category and group budgets, Accumulate targets and
          what's actually been set aside each period, and your planned income. Handy for saving your setup
          before experimenting, or restoring it if something's lost.
        </p>
        <button
          className="btn btn-primary"
          onClick={handleExportBudget}
          disabled={categories.length === 0 && budgetGroups.length === 0 && plannedIncome == null}
        >
          Download budget setup as CSV
        </button>

        <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px dashed var(--border)" }}>
          <p className="hint" style={{ marginBottom: 12 }}>
            Applying a budget file <strong>updates or creates</strong> categories and groups by name — unlike
            the restore above, it never deletes anything not mentioned in the file.
          </p>

          {budgetParseError && <div className="error-banner">{budgetParseError}</div>}

          {!budgetPreview && (
            <label className="file-input-label">
              <input ref={budgetFileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleBudgetFile} />
              <span className="btn btn-secondary">Choose budget file</span>
            </label>
          )}

          {budgetPreview && !budgetApplied && (
            <>
              <div className="summary-row">
                <StatBlock value={budgetPreview.categoryCount} label="Categories in file" />
                <StatBlock value={budgetPreview.groupCount} label="Groups in file" />
                <StatBlock value={budgetPreview.plannedIncome != null ? formatMoney(budgetPreview.plannedIncome) : "—"} label="Planned income" />
                <StatBlock value={budgetPreview.invalid.length} label="Rows skipped" />
              </div>

              {budgetPreview.invalid.length > 0 && (
                <div className="invalid-list" style={{ marginBottom: 14 }}>
                  {budgetPreview.invalid.slice(0, 50).map((inv) => (
                    <div className="invalid-row" key={inv.rowIndex}>
                      <span>Row {inv.rowIndex + 2}</span>
                      <span className="reason">{inv.reasons.join(", ")}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="actions-row">
                <button className="btn btn-primary" onClick={handleApplyBudget} disabled={budgetApplying}>
                  {budgetApplying ? "Applying…" : "Apply budget file"}
                </button>
                <button className="btn btn-secondary" onClick={resetBudgetRestore}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {budgetApplied && (
            <div>
              <p className="hint" style={{ marginBottom: 10 }}>Applied.</p>
              <button className="btn btn-secondary" onClick={resetBudgetRestore}>
                Choose another file
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

function App({ householdName } = {}) {
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [budgetGroups, setBudgetGroups] = useState([]);
  const [plannedIncome, setPlannedIncome] = useState(null);
  const [incomeWarningDismissed, setIncomeWarningDismissed] = useState(false);
  const [hiddenBudgetMonths, setHiddenBudgetMonths] = useState([]);
  const [excludeUnassignedFromBudget, setExcludeUnassignedFromBudget] = useState(false);
  const [view, setView] = useState("upload");
  const [saveError, setSaveError] = useState(null);
  const [toast, setToast] = useState(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [uploadPrefill, setUploadPrefill] = useState(null);
  const [remoteChangeAvailable, setRemoteChangeAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeUploadBatch, setActiveUploadBatch] = useState(null); // { batchId, accountName }
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const baseSnapshotRef = useRef(null);
  const savingRef = useRef(false);

  // Keep the browser tab title in sync with whichever page is showing —
  // the same VIEW_TITLES map the mobile top bar already uses, so there's
  // one source of truth for a view's display name rather than two.
  useEffect(() => {
    document.title = VIEW_TITLES[view] ? `${VIEW_TITLES[view]} | Coinrose` : "Coinrose";
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    loadData().then((data) => {
      if (cancelled) return;
      const snap = normalizeSnapshot(data);
      applySnapshotToState(snap);
      baseSnapshotRef.current = snap;
      setLoaded(true);
      if (snap.accounts.length > 0) setView("overview");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Poll for changes made elsewhere so an open tab finds out before the
  // person starts editing, not only when their own save collides.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const checkForRemoteChanges = async () => {
      // A save that's still in flight has already updated the remote
      // data but hasn't updated baseSnapshotRef yet (that only happens
      // once saveData() resolves) — checking during that gap compares
      // fresh remote data against a baseline that's a beat behind it,
      // which looks exactly like "someone else changed this" even
      // though it's this same session's own edit landing.
      if (savingRef.current) return;
      try {
        const remoteData = await loadData();
        if (cancelled) return;
        const remoteBlob = normalizeSnapshot(remoteData);
        const base = baseSnapshotRef.current;
        if (base && !deepEqual(remoteBlob, base)) {
          setRemoteChangeAvailable(true);
        }
      } catch (e) {
        /* transient network issue — just try again next interval */
      }
    };
    const interval = setInterval(checkForRemoteChanges, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loaded]);

  function applySnapshotToState(snap) {
    setAccounts(snap.accounts);
    setTransactions(snap.transactions);
    setCategories(snap.categories);
    setBudgetGroups(snap.budgetGroups);
    setPlannedIncome(snap.plannedIncome);
    setIncomeWarningDismissed(snap.incomeWarningDismissed);
    setHiddenBudgetMonths(snap.hiddenBudgetMonths);
    setExcludeUnassignedFromBudget(snap.excludeUnassignedFromBudget);
  }

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    savingRef.current = true;
    try {
      const remoteData = await loadData();
      const remoteBlob = normalizeSnapshot(remoteData);
      applySnapshotToState(remoteBlob);
      baseSnapshotRef.current = remoteBlob;
      setRemoteChangeAvailable(false);
      setToast("Synced with the latest data.");
    } catch (e) {
      setToast("Couldn't sync right now — try again in a moment.");
    } finally {
      savingRef.current = false;
    }
    setSyncing(false);
  }, []);

  const persist = useCallback(
    async (
      nextAccounts,
      nextTransactions,
      nextCategories,
      nextBudgetGroups,
      nextPlannedIncome,
      nextIncomeWarningDismissed,
      nextHiddenBudgetMonths,
      nextExcludeUnassignedFromBudget
    ) => {
      const localBlob = {
        accounts: nextAccounts,
        transactions: nextTransactions,
        categories: nextCategories,
        budgetGroups: nextBudgetGroups,
        plannedIncome: nextPlannedIncome,
        incomeWarningDismissed: nextIncomeWarningDismissed,
        hiddenBudgetMonths: nextHiddenBudgetMonths,
        excludeUnassignedFromBudget: nextExcludeUnassignedFromBudget,
      };

      // Show the edit immediately — the merge check below only changes
      // this if someone else's change needs folding in too.
      applySnapshotToState(localBlob);
      savingRef.current = true;

      let toSave = localBlob;
      const base = baseSnapshotRef.current;
      try {
        try {
          const remoteData = await loadData();
          const remoteBlob = normalizeSnapshot(remoteData);
          if (base && !deepEqual(remoteBlob, base)) {
            const { merged, conflicts } = mergeLedgerData(base, localBlob, remoteBlob);
            toSave = merged;
            applySnapshotToState(toSave);
            setToast(
              conflicts.length > 0
                ? `Synced with a change made elsewhere just now — ${conflicts.length} value${
                    conflicts.length === 1 ? "" : "s"
                  } overlapped and kept the most recent edit.`
                : "Synced with a change made elsewhere just now — nothing was lost."
            );
          }
        } catch (e) {
          /* if checking remote fails, fall back to saving local as-is */
        }

        const ok = await saveData(
          toSave.accounts,
          toSave.transactions,
          toSave.categories,
          toSave.budgetGroups,
          toSave.plannedIncome,
          toSave.incomeWarningDismissed,
          toSave.hiddenBudgetMonths,
          toSave.excludeUnassignedFromBudget
        );
        if (ok) {
          baseSnapshotRef.current = toSave;
          setRemoteChangeAvailable(false);
        }
        setSaveError(ok ? null : "Your last change couldn't be saved locally — it may not persist after reload.");
      } finally {
        savingRef.current = false;
      }
    },
    []
  );

  const duplicateInfo = useMemo(() => computeDuplicates(transactions), [transactions]);

  const goToUpload = useCallback((accountId) => {
    setUploadPrefill(accountId ? { mode: "append", accountId } : null);
    setUploadKey((k) => k + 1);
    setView("upload");
  }, []);

  const handleImport = useCallback(
    (accountMeta, valid) => {
      let nextAccounts;
      if (accountMeta.isNew) {
        nextAccounts = [
          ...accounts,
          {
            id: accountMeta.id,
            name: accountMeta.name,
            dateCol: accountMeta.dateCol,
            descriptionCol: accountMeta.descriptionCol,
            outCol: accountMeta.outCol,
            inCol: accountMeta.inCol,
            invertSign: accountMeta.invertSign,
            createdAt: new Date().toISOString(),
          },
        ];
      } else {
        nextAccounts = accounts.map((a) =>
          a.id === accountMeta.id
            ? {
                ...a,
                dateCol: accountMeta.dateCol,
                descriptionCol: accountMeta.descriptionCol,
                outCol: accountMeta.outCol,
                inCol: accountMeta.inCol,
                invertSign: accountMeta.invertSign,
              }
            : a
        );
      }
      const nextTransactions = [...transactions, ...valid];
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      const batchId = valid.length > 0 ? valid[0].uploadBatchId : null;
      if (batchId) {
        setActiveUploadBatch({ batchId, accountName: accountMeta.name });
        setView("categorize");
      } else {
        setView("transactions");
      }
      setToast(`Imported ${valid.length} transaction${valid.length === 1 ? "" : "s"} into ${accountMeta.name}.`);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteAccount = useCallback(
    (accountId) => {
      const nextAccounts = accounts.filter((a) => a.id !== accountId);
      const nextTransactions = transactions.filter((t) => t.accountId !== accountId);
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRenameAccount = useCallback(
    (accountId, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const nextAccounts = accounts.map((a) => (a.id === accountId ? { ...a, name: trimmed } : a));
      const nextTransactions = transactions.map((t) =>
        t.accountId === accountId ? { ...t, accountName: trimmed } : t
      );
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleUpdateAccountSettings = useCallback(
    (accountId, mapping) => {
      const nextAccounts = accounts.map((a) =>
        a.id === accountId
          ? {
              ...a,
              dateCol: mapping.dateCol,
              descriptionCol: mapping.descriptionCol,
              outCol: mapping.outCol,
              inCol: mapping.inCol,
              invertSign: mapping.invertSign,
            }
          : a
      );
      let skipped = 0;
      const nextTransactions = transactions.map((t) => {
        if (t.accountId !== accountId) return t;
        const mapped = mapRow(t.raw || {}, mapping);
        if (mapped.reasons.length > 0) {
          skipped += 1;
          return t;
        }
        return { ...t, date: mapped.date, description: mapped.description, amountOut: mapped.amountOut, amountIn: mapped.amountIn };
      });
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      setToast(
        skipped > 0
          ? `Updated account settings. ${skipped} transaction${skipped === 1 ? "" : "s"} couldn't be remapped and were left as-is.`
          : "Updated account settings and reapplied them to existing transactions."
      );
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRestoreFromBackup = useCallback(
    (newAccounts, newCategories, newTransactions) => {
      persist(newAccounts, newTransactions, newCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      setView("transactions");
      setToast(
        `Restored ${newTransactions.length} transaction${newTransactions.length === 1 ? "" : "s"} from backup.`
      );
    },
    [budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRestoreBudget = useCallback(
    (newCategories, newBudgetGroups, restoredPlannedIncome) => {
      persist(
        accounts,
        transactions,
        newCategories,
        newBudgetGroups,
        restoredPlannedIncome != null ? restoredPlannedIncome : plannedIncome,
        incomeWarningDismissed,
        hiddenBudgetMonths,
        excludeUnassignedFromBudget
      );
      setToast("Applied budget setup from file.");
    },
    [accounts, transactions, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleUpdateTransaction = useCallback(
    (id, updates) => {
      const nextTransactions = transactions.map((t) => (t.id === id ? { ...t, ...updates } : t));
      persist(accounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteTransaction = useCallback(
    (id) => {
      const nextTransactions = transactions.filter((t) => t.id !== id);
      persist(accounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleAddCategory = useCallback(
    (name) => {
      const nextCategories = [
        ...categories,
        {
          id: uid(),
          name,
          excluded: false,
          isIncome: false,
          budgetAmount: null,
          budgetPeriod: "monthly",
          budgetType: "spend",
          accumulateTarget: null,
          accumulateActuals: {},
          fundAdjustments: [],
          createdAt: new Date().toISOString(),
        },
      ];
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRenameCategory = useCallback(
    (categoryId, newName) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, name: newName } : c));
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleCategoryExcluded = useCallback(
    (categoryId, excluded) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, excluded } : c));
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleCategoryIsIncome = useCallback(
    (categoryId, isIncome) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, isIncome } : c));
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetCategoryBudget = useCallback(
    (categoryId, budgetAmount, budgetPeriod, budgetType, accumulateTarget, startDate) => {
      const nextCategories = categories.map((c) =>
        c.id === categoryId
          ? {
              ...c,
              budgetAmount,
              budgetPeriod: budgetPeriod || "monthly",
              budgetType: budgetType === "accumulate" ? "accumulate" : "spend",
              accumulateTarget: accumulateTarget != null ? accumulateTarget : null,
              createdAt: startDate ? new Date(startDate + "T00:00:00.000Z").toISOString() : c.createdAt || new Date().toISOString(),
            }
          : c
      );
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleMergeCategory = useCallback(
    (sourceCategoryId, targetCategoryId) => {
      if (!sourceCategoryId || !targetCategoryId || sourceCategoryId === targetCategoryId) return;
      const source = categories.find((c) => c.id === sourceCategoryId);
      const target = categories.find((c) => c.id === targetCategoryId);
      const nextCategories = categories.filter((c) => c.id !== sourceCategoryId);
      const nextTransactions = transactions.map((t) =>
        t.categoryId === sourceCategoryId ? { ...t, categoryId: targetCategoryId } : t
      );
      persist(accounts, nextTransactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      setToast(`Merged "${source?.name || "category"}" into "${target?.name || "category"}".`);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleAddBudgetGroup = useCallback(
    (name) => {
      const nextGroups = [
        ...budgetGroups,
        {
          id: uid(),
          name,
          budgetAmount: null,
          budgetPeriod: "monthly",
          budgetType: "spend",
          accumulateTarget: null,
          accumulateActuals: {},
          fundAdjustments: [],
          categoryIds: [],
          createdAt: new Date().toISOString(),
        },
      ];
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRenameBudgetGroup = useCallback(
    (groupId, newName) => {
      const nextGroups = budgetGroups.map((g) => (g.id === groupId ? { ...g, name: newName } : g));
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetBudgetGroupBudget = useCallback(
    (groupId, budgetAmount, budgetPeriod, budgetType, accumulateTarget, startDate) => {
      const nextGroups = budgetGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              budgetAmount,
              budgetPeriod: budgetPeriod || "monthly",
              budgetType: budgetType === "accumulate" ? "accumulate" : "spend",
              accumulateTarget: accumulateTarget != null ? accumulateTarget : null,
              createdAt: startDate ? new Date(startDate + "T00:00:00.000Z").toISOString() : g.createdAt || new Date().toISOString(),
            }
          : g
      );
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetAccumulateActual = useCallback(
    (prefixedId, periodKey, amount) => {
      const isGroup = prefixedId.startsWith("group:");
      const rawId = prefixedId.slice(prefixedId.indexOf(":") + 1);
      if (isGroup) {
        const nextGroups = budgetGroups.map((g) =>
          g.id === rawId ? { ...g, accumulateActuals: { ...(g.accumulateActuals || {}), [periodKey]: amount } } : g
        );
        persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      } else {
        const nextCategories = categories.map((c) =>
          c.id === rawId ? { ...c, accumulateActuals: { ...(c.accumulateActuals || {}), [periodKey]: amount } } : c
        );
        persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      }
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleAdjustFundBalance = useCallback(
    (prefixedId, delta) => {
      const isGroup = prefixedId.startsWith("group:");
      const rawId = prefixedId.slice(prefixedId.indexOf(":") + 1);
      const entry = { date: new Date().toISOString(), amount: delta };
      if (isGroup) {
        const nextGroups = budgetGroups.map((g) =>
          g.id === rawId ? { ...g, fundAdjustments: [...(g.fundAdjustments || []), entry] } : g
        );
        persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      } else {
        const nextCategories = categories.map((c) =>
          c.id === rawId ? { ...c, fundAdjustments: [...(c.fundAdjustments || []), entry] } : c
        );
        persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      }
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetPlannedIncome = useCallback(
    (amount) => {
      // A newly-set plan deserves a fresh evaluation rather than staying
      // silenced against the old one.
      persist(accounts, transactions, categories, budgetGroups, amount, false, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDismissIncomeWarning = useCallback(
    (dismissed) => {
      persist(accounts, transactions, categories, budgetGroups, plannedIncome, dismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleHiddenBudgetMonth = useCallback(
    (monthKey) => {
      const nextHidden = hiddenBudgetMonths.includes(monthKey)
        ? hiddenBudgetMonths.filter((k) => k !== monthKey)
        : [...hiddenBudgetMonths, monthKey];
      persist(accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, nextHidden, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleExcludeUnassigned = useCallback(
    (exclude) => {
      persist(accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, exclude);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, persist]
  );

  const handleAddCategoryToGroup = useCallback(
    (groupId, categoryId) => {
      // A category belongs to at most one group — pull it out of any other
      // group it's currently in before adding it to this one.
      const nextGroups = budgetGroups.map((g) => {
        if (g.id === groupId) {
          const ids = g.categoryIds || [];
          return ids.includes(categoryId) ? g : { ...g, categoryIds: [...ids, categoryId] };
        }
        const ids = g.categoryIds || [];
        return ids.includes(categoryId) ? { ...g, categoryIds: ids.filter((id) => id !== categoryId) } : g;
      });
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRemoveCategoryFromGroup = useCallback(
    (groupId, categoryId) => {
      const nextGroups = budgetGroups.map((g) =>
        g.id === groupId ? { ...g, categoryIds: (g.categoryIds || []).filter((id) => id !== categoryId) } : g
      );
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteBudgetGroup = useCallback(
    (groupId) => {
      const nextGroups = budgetGroups.filter((g) => g.id !== groupId);
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteCategory = useCallback(
    (categoryId) => {
      const nextCategories = categories.filter((c) => c.id !== categoryId);
      const nextTransactions = transactions.map((t) =>
        t.categoryId === categoryId ? { ...t, categoryId: null } : t
      );
      persist(accounts, nextTransactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  if (!loaded) {
    return (
      <div className="ledger-root">
        <style>{STYLES}</style>
        <div className="loading-screen">
          <LoadingIndicator label="Loading your ledger…" />
        </div>
      </div>
    );
  }

  const totalNet = transactions.reduce((s, t) => s + (t.amountIn || 0) - (t.amountOut || 0), 0);

  return (
    <div className="ledger-root">
      <style>{STYLES}</style>
      <DecoRing className="coinrose-bg-ring beside-sidebar" />
      <div className="mobile-topbar">
        <button
          className="hamburger-btn"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label="Open menu"
        >
          <span />
          <span />
          <span />
        </button>
        <h2>{VIEW_TITLES[view] || "Ledger"}</h2>
        <ThemedLogo className="mobile-topbar-logo" />
      </div>
      <div className={"sidebar-backdrop" + (mobileMenuOpen ? " visible" : "")} onClick={() => setMobileMenuOpen(false)} />
      <div className="app-shell">
        <div className={"sidebar" + (mobileMenuOpen ? " mobile-open" : "")}>
          <div className="sidebar-brand">
            <ThemedLogo className="sidebar-brand-logo" />
            {householdName ? `${householdName} Ledger` : "Ledger"}
          </div>
          <div className="sidebar-nav" onClick={() => setMobileMenuOpen(false)}>
            <div className="sidebar-nav-label">Ledger</div>
            <button
              className={"nav-btn" + (view === "overview" ? " active" : "")}
              onClick={() => setView("overview")}
            >
              Overview
            </button>
            <button
              className={"nav-btn" + (view === "transactions" ? " active" : "")}
              onClick={() => setView("transactions")}
            >
              Transactions
            </button>
            <button
              className={"nav-btn" + (view === "reports" ? " active" : "")}
              onClick={() => setView("reports")}
            >
              Reports
            </button>
            <button
              className={"nav-btn" + (view === "accounts" ? " active" : "")}
              onClick={() => setView("accounts")}
            >
              Accounts
            </button>
            <button
              className={"nav-btn" + (view === "categories" ? " active" : "")}
              onClick={() => setView("categories")}
            >
              Categories
            </button>
            <button
              className={"nav-btn" + (view === "upload" ? " active" : "")}
              onClick={() => goToUpload(null)}
            >
              Upload
            </button>

            <div className="sidebar-section-divider" />
            <div className="sidebar-nav-label">Budgeting</div>
            <button
              className={"nav-btn" + (view === "planning" ? " active" : "")}
              onClick={() => setView("planning")}
            >
              Planning
            </button>
            <button
              className={"nav-btn" + (view === "budgetGroups" ? " active" : "")}
              onClick={() => setView("budgetGroups")}
            >
              Budget Groups
            </button>
            <button
              className={"nav-btn" + (view === "budget" ? " active" : "")}
              onClick={() => setView("budget")}
            >
              Budget
            </button>

            <div className="sidebar-section-divider" />
            <div className="sidebar-nav-label">Data</div>
            <button
              className={"nav-btn" + (view === "backup" ? " active" : "")}
              onClick={() => setView("backup")}
            >
              Backup
            </button>
          </div>
          <div className="sidebar-stats">
            <div className="stat-row">
              <span>Accounts</span>
              <span>{accounts.length}</span>
            </div>
            <div className="stat-row">
              <span>Transactions</span>
              <span>{transactions.length}</span>
            </div>
            <div className="stat-row stat-net">
              <span>Net</span>
              <span>{formatMoney(totalNet)}</span>
            </div>
          </div>
        </div>

        <div className="main">
          {saveError && <div className="error-banner">{saveError}</div>}
          {remoteChangeAvailable && (
            <div className="sync-banner">
              <span>This household's data was updated elsewhere. Sync before making changes to avoid overlap.</span>
              <button className="btn btn-primary btn-sm" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          )}

          {view === "overview" && (
            <OverviewView
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              onNavigate={(v) => setView(v)}
            />
          )}

          {view === "upload" && (
            <UploadView key={uploadKey} accounts={accounts} prefill={uploadPrefill} onImport={handleImport} />
          )}
          {view === "categorize" && activeUploadBatch && (
            <PostUploadCategorizeView
              transactions={transactions}
              batchId={activeUploadBatch.batchId}
              accountName={activeUploadBatch.accountName}
              categories={categories}
              duplicateInfo={duplicateInfo}
              onUpdate={handleUpdateTransaction}
              onDelete={handleDeleteTransaction}
              onSkip={() => setView("transactions")}
            />
          )}
          {view === "transactions" && (
            <TransactionsView
              transactions={transactions}
              accounts={accounts}
              categories={categories}
              duplicateInfo={duplicateInfo}
              onUpdate={handleUpdateTransaction}
              onDelete={handleDeleteTransaction}
              onGoUpload={goToUpload}
            />
          )}
          {view === "reports" && (
            <ReportsView
              transactions={transactions}
              accounts={accounts}
              categories={categories}
              onGoCategories={() => setView("categories")}
            />
          )}
          {view === "planning" && (
            <PlanningView
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              plannedIncome={plannedIncome}
              incomeWarningDismissed={incomeWarningDismissed}
              excludeUnassignedFromBudget={excludeUnassignedFromBudget}
              onSetPlannedIncome={handleSetPlannedIncome}
              onDismissIncomeWarning={handleDismissIncomeWarning}
              onSetCategoryBudget={handleSetCategoryBudget}
              onToggleExcludeUnassigned={handleToggleExcludeUnassigned}
            />
          )}
          {view === "budget" && (
            <BudgetView
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              hiddenBudgetMonths={hiddenBudgetMonths}
              excludeUnassignedFromBudget={excludeUnassignedFromBudget}
              onSetActual={handleSetAccumulateActual}
              onAdjustFund={handleAdjustFundBalance}
              onToggleHiddenMonth={handleToggleHiddenBudgetMonth}
              onGoCategories={() => setView("categories")}
            />
          )}
          {view === "budgetGroups" && (
            <BudgetGroupsView
              budgetGroups={budgetGroups}
              categories={categories}
              transactions={transactions}
              onAdd={handleAddBudgetGroup}
              onRename={handleRenameBudgetGroup}
              onDelete={handleDeleteBudgetGroup}
              onSetBudget={handleSetBudgetGroupBudget}
              onAddCategory={handleAddCategoryToGroup}
              onRemoveCategory={handleRemoveCategoryFromGroup}
            />
          )}
          {view === "accounts" && (
            <AccountsView
              accounts={accounts}
              transactions={transactions}
              onDelete={handleDeleteAccount}
              onRename={handleRenameAccount}
              onUpdateSettings={handleUpdateAccountSettings}
              onAddTransactions={goToUpload}
              onGoUpload={goToUpload}
            />
          )}
          {view === "categories" && (
            <CategoriesView
              categories={categories}
              transactions={transactions}
              onAdd={handleAddCategory}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
              onToggleExcluded={handleToggleCategoryExcluded}
              onToggleIsIncome={handleToggleCategoryIsIncome}
              onMerge={handleMergeCategory}
            />
          )}
          {view === "backup" && (
            <BackupView
              accounts={accounts}
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              plannedIncome={plannedIncome}
              onRestore={handleRestoreFromBackup}
              onRestoreBudget={handleRestoreBudget}
            />
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;