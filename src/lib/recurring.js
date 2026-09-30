// src/lib/recurring.js
// Patterns Coinrose notices in a household's transactions: recurring bills
// and subscriptions, recurring income, and a few quick insights. Nothing
// here changes any data; it only reads transactions and reports patterns.

import { addDaysISO } from "./periods.js";

/* ------------------------------------------------------------------ */
/* Merchants                                                            */
/* ------------------------------------------------------------------ */

// A merchant's name without the noise banks add: card-processor prefixes
// ("SQ *", "TST*"), store and reference numbers, and punctuation. So
// "SQ *SUNNY GRIFFIN 4421" and "Sunny Griffin #5873" are the same place.
export function merchantKey(description) {
  let s = String(description || "").toLowerCase();
  s = s.replace(/^(sq|tst|sp|pp|pos|ach|dd|chk|paypal|py|in)\s*\*\s*/, "");
  s = s.replace(/\d+/g, " ");
  s = s.replace(/[^a-z&' ]+/g, " ");
  s = s.replace(/\b(com|www|inc|llc|co)\b/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* Rhythms                                                              */
/* ------------------------------------------------------------------ */

// How often something recurs: the usual gap in days, and the range of gaps
// that still counts as that rhythm.
export const CADENCES = [
  { id: "weekly", label: "Every week", days: 7, min: 6, max: 8, minCount: 3 },
  { id: "biweekly", label: "Every 2 weeks", days: 14, min: 12, max: 16, minCount: 3 },
  // Twice a month (the 1st and 15th, or the 15th and the last day): gaps
  // swing between about 13 and 18 days with month lengths and weekends.
  { id: "semimonthly", label: "Twice a month", days: 15.22, min: 9, max: 21, minCount: 4 },
  { id: "monthly", label: "Every month", days: 30.44, min: 26, max: 35, minCount: 3 },
  { id: "quarterly", label: "Every 3 months", days: 91.3, min: 84, max: 98, minCount: 2 },
  { id: "yearly", label: "Every year", days: 365.25, min: 350, max: 380, minCount: 2 },
];

const dayNumber = (iso) => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / 864e5);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round2 = (n) => Math.round(n * 100) / 100;

// The next expected date: the same day next month for monthly things
// (clamped to the month's last day), otherwise the usual gap later.
function nextExpected(lastISO, cadence) {
  if (cadence.id === "monthly" || cadence.id === "quarterly" || cadence.id === "yearly") {
    const months = cadence.id === "monthly" ? 1 : cadence.id === "quarterly" ? 3 : 12;
    const [y, m, d] = lastISO.split("-").map(Number);
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return target.toISOString().slice(0, 10);
  }
  return addDaysISO(lastISO, cadence.days);
}

// Looks for a steady rhythm in one merchant's charges. Returns the rhythm,
// or null. Most gaps (at least two thirds) must fit the rhythm.
function findCadence(dates) {
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => dayNumber(d) - dayNumber(dates[i]));
  // Every 2 weeks and twice a month look alike. Pay every 2 weeks is almost
  // always exactly 14 days apart (13 or 15 around holidays); pay twice a
  // month lands once in each half of the month, with gaps that swing more.
  const byId = Object.fromEntries(CADENCES.map((c) => [c.id, c]));
  if (dates.length >= 3 && gaps.filter((g) => g >= 13 && g <= 15).length / gaps.length >= 0.8) return byId.biweekly;
  if (isTwiceAMonth(dates, gaps)) return byId.semimonthly;
  const typical = median(gaps);
  // (Twice a month is only ever decided by its own test above.)
  const cadence = CADENCES.find((c) => c.id !== "semimonthly" && typical >= c.min && typical <= c.max);
  if (!cadence || dates.length < cadence.minCount) return null;
  const fitting = gaps.filter((g) => g >= cadence.min && g <= cadence.max).length;
  return fitting / gaps.length >= 2 / 3 ? cadence : null;
}

// Twice a month: at least four dates, nearly all gaps between 9 and 21 days,
// and gaps averaging about 15.2 days (365 / 24), whatever the pattern: the
// 15th and last day, or the 1st and 15th, including paydays moved for
// weekends (the 1st paid on the last day of the month before).
function isTwiceAMonth(dates, gaps) {
  if (dates.length < 4) return false;
  const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return average >= 14 && average <= 16.5 && gaps.filter((g) => g >= 9 && g <= 21).length / gaps.length >= 0.8;
}

// The next twice-a-month date. The two paydays are learned from the history:
// one near the month's edge (the 1st, or the last day; a payday on the 30th
// or 31st may be either the last day or an early-paid 1st) and one in the
// middle (usually the 15th). The next one is the first of those at least a
// week after the last payday.
function nextTwiceAMonth(lastISO, dates) {
  const days = dates.map((d) => Number(d.slice(8, 10)));
  const nearStart = days.filter((d) => d <= 5).length;
  const nearEnd = days.filter((d) => d >= 26).length;
  // Paid on the 1st if 1st-ish days are common; otherwise on the last day.
  const edge = nearStart >= nearEnd / 2 && nearStart > 0 ? "start" : "end";
  const middle = Math.round(median(days.filter((d) => d > 5 && d < 26)) || 15);
  const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const [y0, m0] = lastISO.split("-").map(Number);
  const candidates = [];
  for (let k = 0; k < 3; k += 1) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12);
    const m = ((m0 - 1 + k) % 12) + 1;
    candidates.push(iso(y, m, edge === "start" ? 1 : lastDayOf(y, m)), iso(y, m, Math.min(middle, lastDayOf(y, m))));
  }
  return candidates.sort().find((c) => dayNumber(c) - dayNumber(lastISO) >= 7);
}

/* ------------------------------------------------------------------ */
/* Recurring bills, subscriptions, and income                           */
/* ------------------------------------------------------------------ */

// Transactions that count for patterns: not in an excluded category (like
// transfers between your own accounts), and not a paired transfer.
function countable(transactions, categories) {
  const excluded = new Set(categories.filter((c) => c.excluded).map((c) => c.id));
  return transactions.filter((t) => t.date && !t.transferWith && !(t.categoryId && excluded.has(t.categoryId)));
}

// Finds what recurs, as of `today`. Money going out gives bills and
// subscriptions; money coming in gives income.
//
// Each result: { key, name, direction, cadence, fixed, typicalAmount,
// monthlyCost, lastDate, nextDate, count, categoryId, accountName,
// priceChange: { from, to } | null }.
export function findRecurring(transactions, categories, today) {
  const groups = new Map();
  countable(transactions, categories).forEach((t) => {
    const direction = t.amountOut != null ? "out" : "in";
    const key = merchantKey(t.description);
    if (!key) return;
    const groupKey = `${direction}|${key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(t);
  });

  const results = [];
  groups.forEach((list, groupKey) => {
    const direction = groupKey.split("|")[0];
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // Several charges on one day (a split order, two identical coffees)
    // count once for the rhythm.
    const byDay = [];
    sorted.forEach((t) => {
      if (!byDay.length || byDay[byDay.length - 1].date !== t.date) byDay.push(t);
    });
    const cadence = findCadence(byDay.map((t) => t.date));
    if (!cadence) return;

    const amounts = byDay.map((t) => (direction === "out" ? t.amountOut : t.amountIn) || 0);
    const typical = median(amounts);
    // "Same each time": within $1 or 1% (so a paycheck varying by $25 isn't).
    const fixed = Math.max(...amounts) - Math.min(...amounts) <= Math.max(1, typical * 0.01);
    // Spending that varies only counts as a bill on a monthly-or-longer
    // rhythm (utilities): weekly shopping at the same store is a habit, not a
    // bill. Income that varies (paychecks with changing hours or taxes)
    // counts on any rhythm.
    if (!fixed) {
      if (direction === "out" && cadence.days < 26) return;
      const tolerance = direction === "out" ? 0.5 : 0.25;
      if (amounts.some((a) => Math.abs(a - typical) > typical * tolerance)) return;
    }

    const last = byDay[byDay.length - 1];
    // Stopped: nothing for about one and a half rhythms.
    if (dayNumber(today) - dayNumber(last.date) > cadence.days * 1.5 + 3) return;

    // A fixed price that just changed (a subscription going up).
    let priceChange = null;
    if (amounts.length >= 2) {
      const lastAmount = amounts[amounts.length - 1];
      const before = amounts.slice(0, -1);
      const earlierFixed = Math.max(...before) - Math.min(...before) <= Math.max(1, median(before) * 0.01);
      if (earlierFixed && Math.abs(lastAmount - median(before)) > Math.max(0.5, median(before) * 0.01)) {
        priceChange = { from: round2(median(before)), to: round2(lastAmount) };
      }
    }
    const recentCategory = [...sorted].reverse().find((t) => t.categoryId);
    const current = priceChange ? priceChange.to : typical;
    results.push({
      key: groupKey,
      name: last.description,
      direction,
      cadence: cadence.id,
      cadenceLabel: cadence.label,
      fixed: fixed || !!priceChange,
      typicalAmount: round2(current),
      monthlyCost: round2(current * (30.44 / cadence.days)),
      lastDate: last.date,
      nextDate: cadence.id === "semimonthly" ? nextTwiceAMonth(last.date, byDay.map((t) => t.date)) : nextExpected(last.date, cadence),
      count: byDay.length,
      categoryId: recentCategory ? recentCategory.categoryId : null,
      isSplit: Array.isArray(last.splits) && last.splits.length > 0,
      accountName: last.accountName,
      priceChange,
    });
  });
  return results.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

// Subscriptions: fixed-price charges going out, excluding big housing-type
// bills (a fixed $1,450 rent isn't what anyone means by a subscription).
export function isSubscriptionLike(r) {
  return r.direction === "out" && r.fixed && r.monthlyCost <= 100;
}

/* ------------------------------------------------------------------ */
/* Quick insights                                                       */
/* ------------------------------------------------------------------ */

const monthOf = (iso) => iso.slice(0, 7);
const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// A few plain-language observations, each only when there's enough data for
// it to mean something. `transactions` should be what budgets count (split
// transactions as their pieces). Transactions currently suggested as
// transfers (pendingTransferIds) are set aside, since they probably aren't
// spending, and the insight says so. Returns [{ id, title, body, tone }]
// where tone is "info", "good", or "watch".
export function buildInsights(transactions, categories, recurring, today, formatMoney, pendingTransferIds = new Set()) {
  const excluded = new Set(categories.filter((c) => c.excluded || c.isIncome).map((c) => c.id));
  const nameOf = (id) => (categories.find((c) => c.id === id) || {}).name || "Uncategorized";
  const counted = transactions.filter((t) => t.date && t.amountOut != null && !t.transferWith && !(t.categoryId && excluded.has(t.categoryId)));
  const spending = counted.filter((t) => !pendingTransferIds.has(t.id));
  const setAside = (list) => list.filter((t) => pendingTransferIds.has(t.id)).length;
  const insights = [];
  const thisMonth = monthOf(today);
  const lastMonth = shiftMonth(thisMonth, -1);
  const dayOfMonth = Number(today.slice(8, 10));

  // When records start partway through a month (the first transaction after
  // the 7th), that month is incomplete: comparing against it would make
  // everything since look like an increase.
  const firstDate = counted.reduce((min, t) => (!min || t.date < min ? t.date : min), "");
  const partialMonth = firstDate && Number(firstDate.slice(8, 10)) > 7 ? monthOf(firstDate) : null;

  // 1. This month so far, compared with the same point last month.
  const upToDay = (ym) => spending.filter((t) => monthOf(t.date) === ym && Number(t.date.slice(8, 10)) <= dayOfMonth);
  const sum = (list) => list.reduce((s, t) => s + (t.amountOut || 0), 0);
  const soFar = sum(upToDay(thisMonth));
  const asideNow = setAside(counted.filter((t) => monthOf(t.date) === thisMonth && Number(t.date.slice(8, 10)) <= dayOfMonth));
  const lastAtThisPoint = sum(upToDay(lastMonth));
  if (lastMonth !== partialMonth && spending.some((t) => monthOf(t.date) === lastMonth) && (soFar > 0 || lastAtThisPoint > 0)) {
    const diff = soFar - lastAtThisPoint;
    insights.push({
      id: "pace",
      title: "This month so far",
      body:
        `You've spent ${formatMoney(soFar)} through day ${dayOfMonth}. ` +
        (Math.abs(diff) < 1
          ? "That's about the same as this point last month."
          : `That's ${formatMoney(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than at this point last month (${formatMoney(lastAtThisPoint)}).`) +
        (asideNow ? ` Not counting ${asideNow} transaction${asideNow === 1 ? "" : "s"} that look${asideNow === 1 ? "s" : ""} like a transfer between your accounts.` : ""),
      tone: diff > 0 && lastAtThisPoint > 0 && diff / lastAtThisPoint > 0.15 ? "watch" : diff < 0 ? "good" : "info",
    });
  }

  // 2. Categories that changed notably last month. "Usual" is the average of
  // up to three months before it, counting only months when that category
  // actually had spending (a month with no rent payment isn't a $0 rent
  // month), and never a partial first month. At least two such months are
  // needed, so one odd month doesn't set "usual".
  const priorMonths = [shiftMonth(lastMonth, -1), shiftMonth(lastMonth, -2), shiftMonth(lastMonth, -3)].filter(
    (ym) => ym !== partialMonth && spending.some((t) => monthOf(t.date) === ym)
  );
  if (lastMonth !== partialMonth && priorMonths.length >= 2 && spending.some((t) => monthOf(t.date) === lastMonth)) {
    const byCategory = (ym) => {
      const totals = {};
      spending.filter((t) => monthOf(t.date) === ym && t.categoryId).forEach((t) => {
        totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amountOut;
      });
      return totals;
    };
    const last = byCategory(lastMonth);
    const prior = priorMonths.map(byCategory);
    const changes = [];
    new Set([...Object.keys(last), ...prior.flatMap(Object.keys)]).forEach((id) => {
      const active = prior.filter((p) => (p[id] || 0) > 0);
      if (active.length < 2) return;
      const usual = active.reduce((s, p) => s + p[id], 0) / active.length;
      const now = last[id] || 0;
      const change = now - usual;
      if (Math.abs(change) >= 25 && Math.abs(change) / usual >= 0.25) changes.push({ id, now, usual, change, months: active.length });
    });
    changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    changes.slice(0, 2).forEach((c) => {
      const pct = Math.round((Math.abs(c.change) / c.usual) * 100);
      insights.push({
        id: `change-${c.id}`,
        title: `${nameOf(c.id)} ${c.change > 0 ? "went up" : "went down"}`,
        body: `${formatMoney(c.now)} last month, ${pct}% ${c.change > 0 ? "more" : "less"} than your usual ${formatMoney(c.usual)} (the average of the ${c.months} months before it with ${nameOf(c.id)} spending).`,
        tone: c.change > 0 ? "watch" : "good",
      });
    });
  }

  // 3. Bills due in the next two weeks.
  const soon = addDaysISO(today, 14);
  const upcoming = recurring.filter((r) => r.direction === "out" && r.nextDate >= today && r.nextDate <= soon).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  if (upcoming.length) {
    const total = upcoming.reduce((s, r) => s + r.typicalAmount, 0);
    insights.push({
      id: "upcoming",
      title: `${upcoming.length} bill${upcoming.length === 1 ? "" : "s"} expected in the next 2 weeks`,
      body: `About ${formatMoney(total)} in total, starting with ${upcoming[0].name} (about ${formatMoney(upcoming[0].typicalAmount)}).`,
      tone: "info",
      // Everything the summary is based on, soonest first.
      details: {
        label: `See all ${upcoming.length} bill${upcoming.length === 1 ? "" : "s"}`,
        items: upcoming.map((r) => ({ key: r.key, name: r.name, date: r.nextDate, amount: r.typicalAmount, approximate: !r.fixed })),
      },
    });
  }

  // 4. What subscriptions cost.
  const subscriptions = recurring.filter(isSubscriptionLike);
  if (subscriptions.length) {
    const monthly = subscriptions.reduce((s, r) => s + r.monthlyCost, 0);
    insights.push({
      id: "subscriptions",
      title: `${subscriptions.length} fixed-price service${subscriptions.length === 1 ? "" : "s"}`,
      body: `Subscriptions and other services that charge the same amount each time: about ${formatMoney(monthly)} a month, or ${formatMoney(monthly * 12)} a year.`,
      tone: "info",
      details: {
        label: `See all ${subscriptions.length} service${subscriptions.length === 1 ? "" : "s"}`,
        items: [...subscriptions]
          .sort((a, b) => b.monthlyCost - a.monthlyCost)
          .map((r) => ({ key: r.key, name: r.name, amount: r.monthlyCost, suffix: "a month" })),
      },
    });
  }

  // 5. Price increases.
  recurring
    .filter((r) => r.direction === "out" && r.priceChange && r.priceChange.to > r.priceChange.from)
    .slice(0, 2)
    .forEach((r) => {
      insights.push({
        id: `price-${r.key}`,
        title: `${r.name} costs more`,
        body: `Now ${formatMoney(r.priceChange.to)}, up from ${formatMoney(r.priceChange.from)}.`,
        tone: "watch",
      });
    });

  // 6. The biggest purchase this month.
  const recurringMerchants = new Set(recurring.filter((r) => r.direction === "out").map((r) => r.key.slice(4)));
  // A regular payment isn't a one-off, even when it goes through something
  // generic like Venmo: the same category had a similar amount (within 10%)
  // in each of the two months before.
  const similarIn = (ym, t) =>
    spending.some((o) => monthOf(o.date) === ym && o.categoryId === t.categoryId && Math.abs(o.amountOut - t.amountOut) <= t.amountOut * 0.1);
  const isRegular = (t) => t.categoryId && similarIn(lastMonth, t) && similarIn(shiftMonth(lastMonth, -1), t);
  const oneOffs = spending.filter((t) => monthOf(t.date) === thisMonth && !recurringMerchants.has(merchantKey(t.description)) && !isRegular(t));
  if (oneOffs.length >= 3) {
    const biggest = oneOffs.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
    insights.push({
      id: "biggest",
      title: "Biggest one-off purchase this month",
      body: `${formatMoney(biggest.amountOut)} at ${biggest.description || "an unnamed merchant"}, on ${biggest.date.slice(5).replace("-", "/")} (${biggest.categoryId ? nameOf(biggest.categoryId) : "not categorized yet"}).`,
      tone: "info",
    });
  }
  return insights;
}
