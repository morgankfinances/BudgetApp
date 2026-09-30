// src/lib/demoData.js
// Sample data for the demo (coinrose.io/#demo). Nothing here is real: the
// household, businesses, and amounts are all made up.
//
// The data is generated relative to today's date every time the demo opens,
// so it always looks current: about four months of history ending today.
// It's deterministic for a given day (a seeded random number generator
// decides the amounts), so the demo looks the same all day.

import { addDaysISO, getMonthStartISO } from "./periods.js";
import { todayISO } from "./utils.js";
import { percentsToAmounts } from "./splits.js";

// A small, fast, seeded random number generator: same seed, same numbers.
function seededRandom(seedText) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// The demo's household members: you, and a sample partner.
export const DEMO_YOU = "demo-you";
export const DEMO_MEMBERS = [
  { user_id: DEMO_YOU, email: "you@example.com", role: "owner" },
  { user_id: "demo-sam", email: "sam@example.com", role: "owner" },
];

const ACCOUNTS = [
  { id: "demo-chk", name: "Millbrook Trust Checking", dateCol: "Date", descriptionCol: "Description", outCol: "Money Out", inCol: "Money In", invertSign: false },
  { id: "demo-sav", name: "Millbrook Trust Savings", dateCol: "Date", descriptionCol: "Description", outCol: "Money Out", inCol: "Money In", invertSign: false },
  { id: "demo-card", name: "Griffon Reserve Credit Card", dateCol: "Date", descriptionCol: "Description", outCol: "Amount", inCol: "Amount", invertSign: true },
];

const category = (id, name, extra = {}) => ({
  id,
  name,
  excluded: false,
  isIncome: false,
  budgetType: "spend",
  accumulateActuals: {},
  fundAdjustments: [],
  ...extra,
});

function buildCategories(historyStart) {
  return [
    category("demo-pay", "Paychecks", { isIncome: true }),
    category("demo-rent", "Rent"),
    category("demo-groc", "Groceries", { budgetAmount: 650, budgetPeriod: "monthly" }),
    category("demo-dine", "Dining Out", { budgetAmount: 180, budgetPeriod: "monthly" }),
    category("demo-gas", "Gas", { budgetAmount: 45, budgetPeriod: "weekly" }),
    category("demo-elec", "Electric"),
    category("demo-water", "Water"),
    category("demo-net", "Internet"),
    category("demo-subs", "Subscriptions", { budgetAmount: 40, budgetPeriod: "monthly" }),
    category("demo-home", "Home Repairs Fund", {
      budgetAmount: 150,
      budgetPeriod: "monthly",
      budgetType: "accumulate",
      accumulateTarget: 1500,
      createdAt: historyStart,
    }),
    category("demo-fun", "Fun & Hobbies", { budgetAmount: 90, budgetPeriod: "monthly" }),
    category("demo-xfer", "Transfers", { excluded: true }),
  ];
}

const BUDGET_GROUPS = [
  {
    id: "demo-bills",
    name: "Household Bills",
    budgetAmount: 280,
    budgetPeriod: "monthly",
    budgetType: "spend",
    categoryIds: ["demo-elec", "demo-water", "demo-net"],
    accumulateActuals: {},
    fundAdjustments: [],
  },
];

// The day of the week for an ISO date (0 = Sunday).
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const dayOfMonth = (iso) => Number(iso.slice(8, 10));
const money = (n) => Math.round(n * 100) / 100;

// Paid twice a month: the 15th and the month's last day, or the Friday
// before either when it falls on a weekend.
function isTwiceMonthlyPayday(iso) {
  const [y, m] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const payday = (d) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    const dow = date.getUTCDay();
    if (dow === 6) date.setUTCDate(d - 1);
    if (dow === 0) date.setUTCDate(d - 2);
    return date.toISOString().slice(0, 10);
  };
  return iso === payday(15) || iso === payday(lastDay);
}

// Builds the whole demo ledger, ending on `today` (YYYY-MM-DD).
export function buildDemoLedger(today = todayISO()) {
  // History starts on the 1st of the month, three months before this one.
  let historyStart = getMonthStartISO(today);
  for (let i = 0; i < 3; i += 1) historyStart = getMonthStartISO(addDaysISO(historyStart, -1));

  const random = seededRandom(today);
  const between = (low, high) => money(low + random() * (high - low));
  const pick = (list) => list[Math.floor(random() * list.length)];
  const accountName = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.name]));

  const transactions = [];
  const transferPairs = [];
  let counter = 0;
  const add = (accountId, date, description, amountOut, amountIn, categoryId) => {
    counter += 1;
    transactions.push({
      id: `demo-t${counter}`,
      accountId,
      accountName: accountName[accountId],
      date,
      description,
      amountOut: amountOut || null,
      amountIn: amountIn || null,
      categoryId,
      raw: null,
    });
  };

  // Paychecks every other Friday, starting from the first Friday of history.
  let firstFriday = historyStart;
  while (weekday(firstFriday) !== 5) firstFriday = addDaysISO(firstFriday, 1);

  for (let day = historyStart; day <= today; day = addDaysISO(day, 1)) {
    const dom = dayOfMonth(day);
    const dow = weekday(day);
    const weeksSincePay = Math.round((new Date(`${day}T00:00:00Z`) - new Date(`${firstFriday}T00:00:00Z`)) / 864e5 / 7);

    // Income
    if (dow === 5 && weeksSincePay % 2 === 0) add("demo-chk", day, "Thornwick & Vale Payroll", null, 2184.62, "demo-pay");
    // The other earner is paid twice a month (the 15th and the last day,
    // moved to the Friday before when those fall on a weekend), with small
    // differences from paycheck to paycheck.
    if (isTwiceMonthlyPayday(day)) add("demo-chk", day, "Brightwater Clinic Payroll", null, between(1590, 1640), "demo-pay");

    // Monthly bills and subscriptions
    if (dom === 1) add("demo-chk", day, "Hearthside Property Management", 1450, null, "demo-rent");
    if (dom === 2) {
      add("demo-chk", day, "Transfer to Savings", 400, null, "demo-xfer");
      add("demo-sav", day, "Transfer from Checking", null, 400, "demo-xfer");
      transferPairs.push([transactions.at(-2), transactions.at(-1)]);
    }
    if (dom === 3) add("demo-card", day, "Whisperwire Music", 10.99, null, "demo-subs");
    if (dom === 6) add("demo-chk", day, "Glowlight Electric", between(78, 142), null, "demo-elec");
    if (dom === 9) add("demo-card", day, "Almanac Streaming", 15.49, null, "demo-subs");
    if (dom === 12) add("demo-chk", day, "Riverbend Water Utility", between(36, 58), null, "demo-water");
    if (dom === 18) add("demo-chk", day, "Starlane Fiber", 69.99, null, "demo-net");
    if (dom === 21) add("demo-card", day, "Cloudnest Storage", 2.99, null, "demo-subs");
    if (dom === 25) {
      const payment = between(900, 1300);
      add("demo-chk", day, "Griffon Reserve Card Payment", payment, null, "demo-xfer");
      add("demo-card", addDaysISO(day, 1) <= today ? addDaysISO(day, 1) : day, "Payment Received - Thank You", null, payment, "demo-xfer");
      transferPairs.push([transactions.at(-2), transactions.at(-1)]);
    }

    // Everyday spending, mostly on the card
    if ((dow === 2 || dow === 6) && random() < 0.9) {
      add("demo-card", day, pick(["Thrifty Sprout Market", "Bramblewick Co-op", "Thrifty Sprout Market"]), between(30, 112), null, "demo-groc");
    }
    if ((dow === 4 || dow === 5 || dow === 0) && random() < 0.55) {
      add("demo-card", day, pick(["Sunny Griffin Diner", "Noodle & Newt", "Round Loaf Bakery", "Copper Kettle Cafe"]), between(9, 58), null, "demo-dine");
    }
    if (dow === 1 && random() < 0.85) add("demo-card", day, "Cobalt Fuel", between(34, 61), null, "demo-gas");
    if (dom === 14 && random() < 0.8) add("demo-card", day, "Hollow Oak Hardware", between(22, 96), null, "demo-home");
    // A monthly superstore run, split between groceries and home supplies.
    if (dom === 16) {
      const total = between(90, 170);
      add("demo-card", day, "Tallpine Superstore", total, null, null);
      const [groceries, home] = percentsToAmounts(total, [65, 35]);
      transactions.at(-1).splits = [{ categoryId: "demo-groc", amount: groceries }, { categoryId: "demo-home", amount: home }];
    }
    if (dow === 6 && random() < 0.3) add("demo-card", day, pick(["Pinecone Books", "Starfall Cinema", "Loom & Lantern Crafts"]), between(12, 64), null, "demo-fun");
  }

  // Transfers are linked in pairs, except the most recent card payment,
  // left unmarked so the demo shows a suggested transfer to review.
  const lastCardPayment = [...transferPairs].reverse().find(([out]) => out.description === "Griffon Reserve Card Payment");
  transferPairs.forEach(([out, into]) => {
    if (lastCardPayment && out === lastCardPayment[0]) {
      out.categoryId = null;
      into.categoryId = null;
      return;
    }
    out.transferWith = into.id;
    into.transferWith = out.id;
  });

  // A short conversation on the most recent hardware store trip, to show
  // comments between household members.
  const hardware = [...transactions].reverse().find((t) => t.description === "Hollow Oak Hardware");
  if (hardware) {
    hardware.comments = [
      { id: "demo-c1", text: "Paint and brushes for the porch railing.", authorId: "demo-sam", at: `${hardware.date}T19:12:00.000Z` },
      { id: "demo-c2", text: "Nice! Can you keep the receipt in case we return the extra can?", authorId: DEMO_YOU, at: `${hardware.date}T20:03:00.000Z` },
    ];
  }

  // The last few days haven't been categorized yet, so the demo shows the
  // categorizing step (with suggestions, since similar ones exist).
  const recentStart = addDaysISO(today, -4);
  transactions.forEach((t) => {
    if (t.date >= recentStart && t.categoryId !== "demo-pay" && t.categoryId !== "demo-xfer" && !t.splits) t.categoryId = null;
  });

  return {
    accounts: ACCOUNTS.map((a) => ({ ...a })),
    categories: buildCategories(historyStart),
    budgetGroups: BUDGET_GROUPS.map((g) => ({ ...g, categoryIds: [...g.categoryIds] })),
    transactions,
    plannedIncome: 7600,
    incomeWarningDismissed: false,
    hiddenBudgetMonths: [],
    excludeUnassignedFromBudget: false,
    autoApplySuggestions: true,
  };
}
