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
  const typical = median(gaps);
  const cadence = CADENCES.find((c) => typical >= c.min && typical <= c.max);
  if (!cadence || dates.length < cadence.minCount) return null;
  const fitting = gaps.filter((g) => g >= cadence.min && g <= cadence.max).length;
  return fitting / gaps.length >= 2 / 3 ? cadence : null;
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
    const fixed = Math.max(...amounts) - Math.min(...amounts) <= Math.max(1, typical * 0.03);
    // Varying amounts only count as a bill on a monthly-or-longer rhythm
    // (utilities). Weekly shopping at the same store is a habit, not a bill.
    if (!fixed) {
      if (cadence.days < 26) return;
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
      const earlierFixed = Math.max(...before) - Math.min(...before) <= Math.max(1, median(before) * 0.03);
      if (earlierFixed && Math.abs(lastAmount - median(before)) > Math.max(0.5, median(before) * 0.03)) {
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
      nextDate: nextExpected(last.date, cadence),
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

  // 1. This month so far, compared with the same point last month.
  const upToDay = (ym) => spending.filter((t) => monthOf(t.date) === ym && Number(t.date.slice(8, 10)) <= dayOfMonth);
  const sum = (list) => list.reduce((s, t) => s + (t.amountOut || 0), 0);
  const soFar = sum(upToDay(thisMonth));
  const asideNow = setAside(counted.filter((t) => monthOf(t.date) === thisMonth && Number(t.date.slice(8, 10)) <= dayOfMonth));
  const lastAtThisPoint = sum(upToDay(lastMonth));
  if (spending.some((t) => monthOf(t.date) === lastMonth) && (soFar > 0 || lastAtThisPoint > 0)) {
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

  // 2. Categories that changed notably last month, against the three months before.
  // Compared with the average of up to three months before it (at least two
  // with data, so one odd month doesn't set "usual").
  const priorMonths = [shiftMonth(lastMonth, -1), shiftMonth(lastMonth, -2), shiftMonth(lastMonth, -3)].filter((ym) =>
    spending.some((t) => monthOf(t.date) === ym)
  );
  if (priorMonths.length >= 2 && spending.some((t) => monthOf(t.date) === lastMonth)) {
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
      const usual = prior.reduce((s, p) => s + (p[id] || 0), 0) / prior.length;
      const now = last[id] || 0;
      const change = now - usual;
      if (usual > 0 && Math.abs(change) >= 25 && Math.abs(change) / usual >= 0.25) changes.push({ id, now, usual, change });
    });
    changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    changes.slice(0, 2).forEach((c) => {
      const pct = Math.round((Math.abs(c.change) / c.usual) * 100);
      insights.push({
        id: `change-${c.id}`,
        title: `${nameOf(c.id)} ${c.change > 0 ? "went up" : "went down"}`,
        body: `${formatMoney(c.now)} last month, ${pct}% ${c.change > 0 ? "more" : "less"} than your usual ${formatMoney(c.usual)} (the average of the ${priorMonths.length} months before).`,
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
  const oneOffs = spending.filter((t) => monthOf(t.date) === thisMonth && !recurringMerchants.has(merchantKey(t.description)));
  if (oneOffs.length >= 3) {
    const biggest = oneOffs.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
    insights.push({
      id: "biggest",
      title: "Biggest one-off purchase this month",
      body: `${formatMoney(biggest.amountOut)} at ${biggest.description || "an unnamed merchant"}, on ${biggest.date.slice(5).replace("-", "/")}.`,
      tone: "info",
    });
  }
  return insights;
}
