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
    expect(changes).toEqual([{ id: "change-dine", title: "Dining Out went up", body: "$330.00 last month, 57% more than your usual $210.00 (the average of the 2 months before).", tone: "watch" }]);
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
    expect(insights.find((i) => i.id === "biggest").body).toBe("$80.00 at Shop, on 09/03.");
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
