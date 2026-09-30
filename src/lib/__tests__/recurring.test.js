import { describe, it, expect } from "vitest";
import { merchantKey, findRecurring, isSubscriptionLike, buildInsights } from "../recurring.js";

const cats = [
  { id: "subs", name: "Subscriptions" }, { id: "util", name: "Utilities" }, { id: "groc", name: "Groceries" },
  { id: "dine", name: "Dining Out" }, { id: "xfer", name: "Transfers", excluded: true }, { id: "pay", name: "Pay", isIncome: true },
];
let n = 0;
const out = (date, description, amount, categoryId = null, extra = {}) => ({ id: `t${++n}`, accountId: "a", accountName: "Card", date, description, amountOut: amount, amountIn: null, categoryId, ...extra });
const inc = (date, description, amount) => ({ id: `t${++n}`, accountId: "a", accountName: "Checking", date, description, amountOut: null, amountIn: amount, categoryId: "pay" });
const fm = (x) => "$" + x.toFixed(2);

describe("merchant names", () => {
  it("ignore card-processor prefixes, store and reference numbers, and punctuation", () => {
    expect(merchantKey("SQ *SUNNY GRIFFIN 4421")).toBe("sunny griffin");
    expect(merchantKey("Sunny Griffin #5873")).toBe("sunny griffin");
    expect(merchantKey("NETFLIX.COM 866-579-7172")).toBe("netflix");
    expect(merchantKey("TST* Noodle & Newt")).toBe("noodle & newt");
    expect(merchantKey("")).toBe("");
  });
});

describe("finding recurring charges", () => {
  it("finds a fixed monthly subscription, even when the bank adds reference numbers", () => {
    const list = [out("2026-06-09", "ALMANAC STREAMING 1001", 15.49, "subs"), out("2026-07-09", "ALMANAC STREAMING 1002", 15.49, "subs"), out("2026-08-10", "Almanac Streaming 1003", 15.49, "subs")];
    const [r] = findRecurring(list, cats, "2026-08-20");
    expect(r).toMatchObject({ direction: "out", cadence: "monthly", fixed: true, typicalAmount: 15.49, monthlyCost: 15.49, nextDate: "2026-09-10", count: 3, categoryId: "subs", priceChange: null });
    expect(isSubscriptionLike(r)).toBe(true);
  });
  it("monthly bills that vary (utilities) count; weekly shopping that varies doesn't", () => {
    const util = ["2026-06-06", "2026-07-06", "2026-08-06"].map((d, i) => out(d, "Glowlight Electric", [90, 118, 131][i], "util"));
    const groceries = ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25", "2026-08-01"].map((d, i) => out(d, "Thrifty Sprout", [40, 95, 62, 120, 71][i], "groc"));
    const found = findRecurring([...util, ...groceries], cats, "2026-08-10");
    expect(found.map((r) => [r.name, r.fixed])).toEqual([["Glowlight Electric", false]]);
    expect(isSubscriptionLike(found[0])).toBe(false);
  });
  it("finds pay every two weeks, and a yearly charge from two payments", () => {
    const pay = ["2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14"].map((d) => inc(d, "Thornwick Payroll", 2184.62));
    const yearly = [out("2025-08-15", "Pinecone Annual", 120, "subs"), out("2026-08-14", "Pinecone Annual", 120, "subs")];
    const found = findRecurring([...pay, ...yearly], cats, "2026-08-20");
    const payroll = found.find((r) => r.direction === "in");
    expect(payroll).toMatchObject({ cadence: "biweekly", nextDate: "2026-08-28" });
    expect(payroll.monthlyCost).toBeCloseTo(2184.62 * (30.44 / 14), 2);
    expect(found.find((r) => r.cadence === "yearly")).toMatchObject({ monthlyCost: 10, nextDate: "2027-08-14" });
  });
  it("needs a steady rhythm, enough occurrences, and recent activity", () => {
    const irregular = ["2026-06-01", "2026-06-20", "2026-08-15"].map((d) => out(d, "Hollow Oak", 30));
    const twoMonthly = ["2026-07-01", "2026-08-01"].map((d) => out(d, "Starlane", 69.99));
    const stopped = ["2026-01-03", "2026-02-03", "2026-03-03"].map((d) => out(d, "Old Gym", 25));
    expect(findRecurring([...irregular, ...twoMonthly, ...stopped], cats, "2026-08-10")).toEqual([]);
  });
  it("ignores transfers and excluded categories, and counts several charges on one day once", () => {
    const xfer = ["2026-06-02", "2026-07-02", "2026-08-02"].map((d) => out(d, "Transfer to Savings", 400, "xfer"));
    const paired = ["2026-06-25", "2026-07-25", "2026-08-25"].map((d) => out(d, "Card Payment", 900, null, { transferWith: "x" }));
    const doubled = ["2026-06-09", "2026-07-09", "2026-07-09", "2026-08-09"].map((d) => out(d, "Cloudnest", 2.99));
    const found = findRecurring([...xfer, ...paired, ...doubled], cats, "2026-08-26");
    expect(found.map((r) => [r.name, r.count])).toEqual([["Cloudnest", 3]]);
  });
  it("notices a price increase, and uses the new price", () => {
    const list = ["2026-05-03", "2026-06-03", "2026-07-03"].map((d) => out(d, "Whisperwire", 10.99)).concat(out("2026-08-03", "Whisperwire", 12.99));
    const [r] = findRecurring(list, cats, "2026-08-10");
    expect(r.priceChange).toEqual({ from: 10.99, to: 12.99 });
    expect(r.typicalAmount).toBe(12.99);
  });
  it("monthly dates stay on the same day, clamped to short months", () => {
    const list = ["2026-11-30", "2026-12-30", "2027-01-30"].map((d) => out(d, "Rent", 1450));
    expect(findRecurring(list, cats, "2027-02-05")[0].nextDate).toBe("2027-02-28");
  });
});

describe("quick insights", () => {
  const month = (ym, dayAmounts, description = "Shop", categoryId = "groc") => dayAmounts.map(([d, a]) => out(`${ym}-${String(d).padStart(2, "0")}`, description, a, categoryId));
  it("compares this month so far with the same point last month", () => {
    const list = [...month("2026-08", [[3, 100], [20, 500]]), ...month("2026-09", [[2, 60], [8, 90]])];
    const [pace] = buildInsights(list, cats, [], "2026-09-10", fm);
    expect(pace).toMatchObject({ id: "pace", tone: "watch" }); // 50% more than at this point last month
    expect(pace.body).toBe("You've spent $150.00 through day 10. That's $50.00 more than at this point last month ($100.00).");
    const [calmer] = buildInsights([...month("2026-08", [[3, 300]]), ...month("2026-09", [[2, 60]])], cats, [], "2026-09-10", fm);
    expect(calmer.tone).toBe("good");
  });
  it("names categories that changed a lot last month, against the months before", () => {
    const list = [
      ...month("2026-06", [[5, 200]], "Diner", "dine"), ...month("2026-07", [[5, 220]], "Diner", "dine"), ...month("2026-08", [[5, 330]], "Diner", "dine"),
      ...month("2026-06", [[6, 100]]), ...month("2026-07", [[6, 104]]), ...month("2026-08", [[6, 110]]), // small change: not mentioned
    ];
    const changes = buildInsights(list, cats, [], "2026-09-02", fm).filter((i) => i.id.startsWith("change-"));
    expect(changes).toEqual([{ id: "change-dine", title: "Dining Out went up", body: "$330.00 last month, 57% more than your usual $210.00 (the average of the 2 months before it with Dining Out spending).", tone: "watch" }]);
  });
  it("lists upcoming bills and what fixed-price services cost, and flags price increases", () => {
    const recurring = [
      { key: "out|rent", name: "Rent", direction: "out", fixed: true, typicalAmount: 1450, monthlyCost: 1450, nextDate: "2026-10-01", priceChange: null },
      { key: "out|music", name: "Whisperwire", direction: "out", fixed: true, typicalAmount: 12.99, monthlyCost: 12.99, nextDate: "2026-10-03", priceChange: { from: 10.99, to: 12.99 } },
      { key: "out|later", name: "Water", direction: "out", fixed: false, typicalAmount: 40, monthlyCost: 40, nextDate: "2026-10-20", priceChange: null },
    ];
    const ids = buildInsights([], cats, recurring, "2026-09-28", fm);
    expect(ids.find((i) => i.id === "upcoming")).toMatchObject({ title: "2 bills expected in the next 2 weeks", body: "About $1462.99 in total, starting with Rent (about $1450.00)." });
    expect(ids.find((i) => i.id === "subscriptions").title).toBe("1 fixed-price service");
    expect(ids.find((i) => i.id === "price-out|music").body).toBe("Now $12.99, up from $10.99.");
  });
  it("the biggest one-off purchase skips recurring bills and suggested transfers, which are also set aside from the pace", () => {
    const list = [...month("2026-08", [[1, 50]]), out("2026-09-01", "Rent", 1450), ...month("2026-09", [[3, 80], [5, 30], [8, 20]]), out("2026-09-06", "Card Payment", 1200)];
    const pending = new Set([list.at(-1).id]);
    const insights = buildInsights(list, cats, [{ key: "out|rent", direction: "out" }], "2026-09-10", fm, pending);
    expect(insights.find((i) => i.id === "biggest").body).toBe("$80.00 at Shop, on 09/03 (Groceries).");
    expect(insights.find((i) => i.id === "pace").body).toMatch(/You've spent \$1580\.00 .* Not counting 1 transaction that looks like a transfer between your accounts\.$/);
  });
  it("says nothing without enough data", () => {
    expect(buildInsights([], cats, [], "2026-09-10", fm)).toEqual([]);
  });
});

describe("recurring split purchases", () => {
  it("are marked as split rather than uncategorized", () => {
    const list = ["2026-06-16", "2026-07-16", "2026-08-16"].map((d, i) => out(d, "Tallpine Superstore", [120, 140, 131][i], null, { splits: [{ categoryId: "groc", amount: 60 }, { categoryId: "util", amount: 60 }] }));
    const [r] = findRecurring(list, cats, "2026-08-20");
    expect(r).toMatchObject({ isSplit: true, categoryId: null });
  });
});

describe("paychecks twice a month versus every two weeks", () => {
  const pay = (dates, amounts, name = "Brightwater Clinic Payroll") => dates.map((d, i) => inc(d, name, amounts ? amounts[i] : 1612.4));
  it("twice a month: the 15th and the last day, moved for weekends, with amounts that vary", () => {
    const dates = ["2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15"];
    const [r] = findRecurring(pay(dates, [1612.4, 1598.22, 1630.11, 1612.4, 1587.9, 1644.02, 1612.4]), cats, "2026-09-20");
    expect(r).toMatchObject({ cadence: "semimonthly", cadenceLabel: "Twice a month", fixed: false, nextDate: "2026-09-30" });
    expect(r.monthlyCost).toBeCloseTo(1612.4 * 2, 0);
  });
  it("twice a month on the 1st and 15th, even when the 1st is paid on the last day of the month before", () => {
    const dates = ["2026-06-01", "2026-06-15", "2026-07-01", "2026-07-15", "2026-07-31", "2026-08-14", "2026-09-01"];
    const [r] = findRecurring(pay(dates), cats, "2026-09-05");
    expect(r).toMatchObject({ cadence: "semimonthly", nextDate: "2026-09-15" });
  });
  it("every two weeks stays every two weeks, and its pay may vary too", () => {
    const dates = ["2026-06-19", "2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11"];
    const [r] = findRecurring(pay(dates, [2184.62, 2201.1, 2150.33, 2184.62, 2190, 2176.4, 2184.62], "Thornwick Payroll"), cats, "2026-09-20");
    expect(r).toMatchObject({ cadence: "biweekly", fixed: false, nextDate: "2026-09-25" });
  });
  it("two paydays in the same half of a month isn't twice a month", () => {
    const dates = ["2026-06-02", "2026-06-12", "2026-06-24", "2026-07-06", "2026-07-16"];
    expect(findRecurring(pay(dates), cats, "2026-07-20").map((r) => r.cadence)).not.toContain("semimonthly");
  });
});

describe("insights with records that start partway through a month", () => {
  const cats2 = [{ id: "rent", name: "Rent" }, { id: "groc", name: "Groceries" }, { id: "fun", name: "Fun" }];
  const spend = (date, description, amount, categoryId) => out(date, description, amount, categoryId);
  const rent = ["2026-07-01", "2026-08-01", "2026-09-01"].map((d) => spend(d, "VENMO PAYMENT 1027384", 1450, "rent"));
  const groceries = [["2026-06-18", 90], ["2026-06-25", 80], ["2026-07-05", 150], ["2026-07-19", 160], ["2026-08-02", 150], ["2026-08-20", 170], ["2026-09-06", 40]]
    .map(([d, a]) => spend(d, "Thrifty Sprout", a, "groc"));
  it("a partial first month isn't compared against, and a month with no rent isn't a $0 rent month", () => {
    const ids = buildInsights([...rent, ...groceries], cats2, [], "2026-09-28", fm).map((i) => i.id);
    expect(ids.filter((id) => id.startsWith("change-"))).toEqual([]); // no false "Rent went up 100%" or "Groceries went up"
  });
  it("'usual' averages only the months that category had spending", () => {
    const fun = [spend("2026-05-10", "Cinema", 40, "fun"), spend("2026-07-10", "Cinema", 40, "fun"), spend("2026-08-10", "Cinema", 120, "fun")];
    const filler = ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02"].map((d) => spend(d, "Thrifty Sprout", 100, "groc"));
    const change = buildInsights([...fun, ...filler], cats2, [], "2026-09-05", fm).find((i) => i.id === "change-fun");
    expect(change.body).toBe("$120.00 last month, 200% more than your usual $40.00 (the average of the 2 months before it with Fun spending).");
  });
  it("the pace comparison waits until last month is a full month of records", () => {
    const list = [spend("2026-08-20", "Shop", 50, "groc"), spend("2026-09-03", "Shop", 20, "groc")];
    expect(buildInsights(list, cats2, [], "2026-09-10", fm).find((i) => i.id === "pace")).toBeUndefined();
  });
  it("a regular payment through something generic (rent by Venmo) isn't a one-off, and one-offs name their category", () => {
    const list = [...rent, spend("2026-09-12", "Pinecone Books", 120, "fun"), spend("2026-09-14", "Thrifty Sprout", 60, "groc"), spend("2026-09-15", "Corner Store", 30, null)];
    const biggest = buildInsights(list, cats2, [], "2026-09-28", fm).find((i) => i.id === "biggest");
    expect(biggest.body).toBe("$120.00 at Pinecone Books, on 09/12 (Fun).");
    const uncategorized = buildInsights([spend("2026-09-12", "Mystery", 500, null), ...list], cats2, [], "2026-09-28", fm).find((i) => i.id === "biggest");
    expect(uncategorized.body).toBe("$500.00 at Mystery, on 09/12 (not categorized yet).");
  });
});

describe("insight cards include the full list behind their summary", () => {
  const rec = (key, name, nextDate, typicalAmount, monthlyCost, fixed = true) => ({ key, name, direction: "out", fixed, typicalAmount, monthlyCost, nextDate, priceChange: null });
  it("every bill expected in the next two weeks, soonest first, and every fixed-price service by cost", () => {
    const recurring = [rec("out|rent", "Rent", "2026-10-01", 1450, 1450), rec("out|water", "Water", "2026-10-06", 46.2, 46.2, false),
      rec("out|music", "Whisperwire", "2026-09-30", 10.99, 10.99), rec("out|cloud", "Cloudnest", "2026-10-09", 2.99, 2.99), rec("out|later", "Insurance", "2026-11-02", 90, 90)];
    const insights = buildInsights([], cats, recurring, "2026-09-28", fm);
    const upcoming = insights.find((i) => i.id === "upcoming");
    expect(upcoming.details.label).toBe("See all 4 bills");
    expect(upcoming.details.items.map((d) => [d.name, d.date, d.amount, d.approximate])).toEqual([
      ["Whisperwire", "2026-09-30", 10.99, false], ["Rent", "2026-10-01", 1450, false], ["Water", "2026-10-06", 46.2, true], ["Cloudnest", "2026-10-09", 2.99, false],
    ]);
    const services = insights.find((i) => i.id === "subscriptions");
    expect(services.details.label).toBe("See all 3 services");
    expect(services.details.items.map((d) => [d.name, d.amount, d.suffix])).toEqual([["Insurance", 90, "a month"], ["Whisperwire", 10.99, "a month"], ["Cloudnest", 2.99, "a month"]]);
  });
});
