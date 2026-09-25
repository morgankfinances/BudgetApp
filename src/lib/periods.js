
export function getWeekStartISO(dateISO) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
  return dt.toISOString().slice(0, 10);
}


export function getMonthStartISO(dateISO) {
  const [y, m] = dateISO.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}


export function formatWeekLabel(weekStartISO) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}


export function formatMonthLabel(monthStartISO) {
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
export const WEEKS_PER_MONTH = 52 / 12;


export function monthlyEquivalent(amount, period) {
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

export const REPORT_CONFIG_KEY = "ledger-report-period-config-v1";


export function defaultReportPeriodConfig() {
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


export function loadReportPeriodConfig() {
  try {
    const raw = window.localStorage.getItem(REPORT_CONFIG_KEY);
    if (!raw) return defaultReportPeriodConfig();
    const parsed = JSON.parse(raw);
    return { ...defaultReportPeriodConfig(), ...parsed };
  } catch (e) {
    return defaultReportPeriodConfig();
  }
}


export function saveReportPeriodConfig(config) {
  try {
    window.localStorage.setItem(REPORT_CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    /* private browsing or storage disabled — the preference just won't persist */
  }
}


export function addDaysISO(dateISO, days) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}


export function daysInMonth(year, month1based) {
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}


// Buckets a date into an N-day period counted from an anchor date —
// covers biweekly (14) and any other "every N days" cadence, extending
// correctly to dates before the anchor as well as after it.
export function getIntervalPeriodStartISO(dateISO, anchorISO, intervalDays) {
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


export function formatIntervalLabel(startISO, intervalDays) {
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
export function getSemiMonthlyPeriodStartISO(dateISO, day1, day2) {
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


export function formatSemiMonthlyLabel(periodStartISO, day1, day2) {
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


export function periodFnsForConfig(config) {
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


export function addPeriod(dateISO, periodType) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (periodType === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}


// Every period key from startKey through endKey (inclusive), stepping by
// the given cadence. Capped as a safety net against a runaway loop from
// a malformed date.
export function enumeratePeriodsBetween(startKey, endKey, periodType) {
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
