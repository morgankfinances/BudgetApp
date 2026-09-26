import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import * as F from "./fixtures.js";

// An in-memory stand-in for the database. The app's own change detection
// (computeLedgerChanges) is the real one; only loading and saving are fake.
const db = { data: null, version: 1, saves: [], failSave: false, failLoad: false };
vi.mock("../supabaseClient.js", () => ({ supabase: {} }));
vi.mock("../ledgerStore.js", async () => {
  const actual = await vi.importActual("../ledgerStore.js");
  return {
    ...actual,
    loadLedger: async () => {
      if (db.failLoad) throw new Error("offline");
      return { data: structuredClone(db.data), settingsSaved: true, version: db.version };
    },
    fetchLedgerVersion: async () => { db.versionChecks = (db.versionChecks || 0) + 1; return db.version; },
    saveLedgerChanges: async (changes) => {
      if (db.failSave) throw new Error("network down");
      db.saves.push(changes);
      db.version += 1;
      return db.version;
    },
  };
});
const { default: App } = await import("../App.jsx");
const { TUTORIAL_SEEN_KEY } = await import("../lib/tutorial.js");

beforeEach(() => {
  Object.assign(db, { version: 1, saves: [], failSave: false, failLoad: false, data: {
    accounts: structuredClone(F.accounts), categories: structuredClone(F.categories), budgetGroups: structuredClone(F.budgetGroups),
    transactions: structuredClone(F.transactions), plannedIncome: 2700, incomeWarningDismissed: false, hiddenBudgetMonths: [], excludeUnassignedFromBudget: false,
  } });
});

async function openApp({ seenTutorial = true } = {}) {
  if (seenTutorial) localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
  const utils = render(<App householdName="Alchemist Household" />);
  await screen.findByRole("heading", { name: "Overview" });
  const nav = (name) => fireEvent.click(within(utils.container.querySelector(".sidebar")).getByRole("button", { name }));
  const lastSave = () => db.saves[db.saves.length - 1];
  return { ...utils, nav, lastSave };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("the app", () => {
  it("a first-time visitor starts on Overview with the tour, which can be skipped for good", async () => {
    localStorage.clear();
    await openApp({ seenTutorial: false });
    expect(await screen.findByText(/Step 1 of/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByText(/Step 1 of/)).toBeNull();
    expect(localStorage.getItem(TUTORIAL_SEEN_KEY)).toBe("true");
  });

  it("the tour moves through the pages as it goes", async () => {
    localStorage.clear();
    await openApp({ seenTutorial: false });
    fireEvent.click(await screen.findByRole("button", { name: "Start the tour" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(document.title).toBe("Upload | Coinrose");
  });

  it("navigating shows each page and updates the tab title", async () => {
    const { nav } = await openApp();
    nav("Transactions");
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
    expect(document.title).toBe("Transactions | Coinrose");
    nav("Budget");
    expect(document.title).toBe("Budget | Coinrose");
  });

  it("changing one transaction's category saves just that one row", async () => {
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    const row = [...document.querySelectorAll("tr.tx-row-full")].find((r) => r.textContent.includes("Mystery Merchant"));
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "cat-dine" } });
    await flush();
    expect(db.saves).toHaveLength(1);
    expect(lastSave()).toEqual({ upserts: { transactions: [expect.objectContaining({ id: "t8", category_id: "cat-dine" })] } });
  });

  it("deleting a category also uncategorizes its transactions and removes it from its group, in one save", async () => {
    const { nav, lastSave } = await openApp();
    nav("Categories");
    const card = screen.getAllByText("Utilities").map((el) => el.closest(".category-card")).find(Boolean);
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    await flush();
    const s = lastSave();
    expect(s.deletes.categories).toEqual(["cat-util"]);
    expect(s.upserts.transactions).toEqual([expect.objectContaining({ id: "t4", category_id: null })]);
    expect(s.upserts.budget_groups).toEqual([expect.objectContaining({ id: "grp-home", category_ids: [] })]);
  });

  it("merging a category moves its transactions to the other one", async () => {
    const { nav, lastSave } = await openApp();
    nav("Categories");
    const card = screen.getAllByText("Dining Out").map((el) => el.closest(".category-card")).find(Boolean);
    fireEvent.click(within(card).getByRole("button", { name: "Merge into…" }));
    fireEvent.change(within(card).getByRole("combobox"), { target: { value: "cat-groc" } });
    fireEvent.click(within(card).getByRole("button", { name: "Merge" }));
    fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    await flush();
    expect(lastSave().deletes.categories).toEqual(["cat-dine"]);
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ id: "t2", category_id: "cat-groc" })]);
  });

  it("a failed save is reported, and sent again with the next change", async () => {
    const { nav } = await openApp();
    nav("Categories");
    db.failSave = true;
    fireEvent.change(screen.getByPlaceholderText("New category name…"), { target: { value: "Pets" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await flush();
    expect(document.body.textContent).toMatch(/couldn't be saved/);
    db.failSave = false;
    fireEvent.change(screen.getByPlaceholderText("New category name…"), { target: { value: "Garden" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await flush();
    expect(db.saves[0].upserts.categories.map((c) => c.name).sort()).toEqual(["Garden", "Pets"]);
    expect(document.body.textContent).not.toMatch(/couldn't be saved/);
  });

  it("if loading fails, it says so and offers to try again, instead of showing an empty ledger", async () => {
    db.failLoad = true;
    render(<App householdName="X" />);
    expect(await screen.findByText(/Couldn't load your ledger/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("notices when someone else saved, and 'Sync now' brings their changes in", async () => {
    vi.useRealTimers(); // replace the shared date-only fake with one that also controls intervals
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00"));
    const { nav } = await openApp();
    nav("Transactions");
    db.data.transactions.push({ ...F.transactions[0], id: "t-partner", description: "Partner's purchase" });
    db.version += 1;                                             // their save moved the counter
    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    await flush();
    expect(db.versionChecks).toBeGreaterThan(0);                  // the 45-second check ran
    const syncButton = await screen.findByRole("button", { name: "Sync now" });
    expect(document.body.textContent).not.toMatch(/Partner's purchase/);
    fireEvent.click(syncButton);
    await waitFor(() => expect(document.body.textContent).toMatch(/Partner's purchase/));
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("importing a statement adds the account and transactions, then opens them for categorizing", async () => {
    const { nav, lastSave } = await openApp();
    nav("Upload");
    fireEvent.click(screen.getByLabelText(/This is a new account/));
    const csv = "Date,Description,Withdrawal,Deposit\n9/20/2026,Corner Grocer,31.07,\n9/21/2026,Refund,,5.00\n";
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([csv], "Savings.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Check 2 rows" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 transactions" }));
    await flush();
    expect(await screen.findByRole("heading", { name: "Categorize your import" })).toBeTruthy();
    expect(lastSave().upserts.accounts).toEqual([expect.objectContaining({ name: "Savings" })]);
    expect(lastSave().upserts.transactions.map((t) => t.description)).toEqual(["Corner Grocer", "Refund"]);
  });
});

describe("the app's actions each save exactly what changed", () => {
  const card = (text, cls) => screen.getAllByText(text).map((el) => el.closest(cls)).find(Boolean);

  it("accounts: rename (and its transactions follow), change column settings, delete with its transactions", async () => {
    const { nav, lastSave } = await openApp();
    nav("Accounts");
    const chk = card("Millbrook Checking", ".account-card-wrap");
    fireEvent.click(within(chk).getByRole("button", { name: "Rename" }));
    const input = within(chk).getByDisplayValue("Millbrook Checking");
    fireEvent.change(input, { target: { value: "Checking" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(lastSave().upserts.accounts).toEqual([expect.objectContaining({ id: "acct-chk", name: "Checking" })]);
    fireEvent.click(within(chk).getByRole("button", { name: "Settings" }));
    fireEvent.click(within(chk).getByRole("button", { name: /Save|Apply/ }));
    await flush();
    expect(document.body.textContent).toMatch(/Updated account settings/);
    fireEvent.click(within(chk).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(chk).getByRole("button", { name: /Confirm|Yes/ }));
    await flush();
    expect(lastSave().deletes.accounts).toEqual(["acct-chk"]);
    expect(lastSave().deletes.transactions.sort()).toEqual(["t1", "t10", "t3", "t4", "t5", "t6", "t9"]);
  });

  it("accounts: 'Add transactions' opens Upload for that account", async () => {
    const { nav } = await openApp();
    nav("Accounts");
    fireEvent.click(within(card("Griffon Card", ".account-card-wrap")).getByRole("button", { name: "Add transactions" }));
    expect(screen.getByRole("heading", { name: "Upload a statement" })).toBeTruthy();
    expect(screen.getByDisplayValue("Griffon Card")).toBeTruthy();
  });

  it("categories: add, rename, and flag as excluded or income", async () => {
    const { nav, lastSave } = await openApp();
    nav("Categories");
    fireEvent.change(screen.getByPlaceholderText("New category name…"), { target: { value: "Pets" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await flush();
    expect(lastSave().upserts.categories).toEqual([expect.objectContaining({ name: "Pets" })]);
    fireEvent.change(screen.getByPlaceholderText("New category name…"), { target: { value: "groceries" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await flush();
    expect(db.saves).toHaveLength(1); // a name that already exists isn't added twice
    const rent = card("Rent", ".category-card");
    const [excluded, income] = within(rent).getAllByRole("checkbox");
    fireEvent.click(excluded); await flush();
    expect(lastSave().upserts.categories).toEqual([expect.objectContaining({ id: "cat-rent", excluded: true })]);
    fireEvent.click(income); await flush();
    expect(lastSave().upserts.categories).toEqual([expect.objectContaining({ id: "cat-rent", is_income: true })]);
    fireEvent.click(within(rent).getByRole("button", { name: "Rename" }));
    const input = within(rent).getByDisplayValue("Rent");
    fireEvent.change(input, { target: { value: "Housing" } });
    fireEvent.keyDown(input, { key: "Enter" }); await flush();
    expect(lastSave().upserts.categories).toEqual([expect.objectContaining({ id: "cat-rent", name: "Housing" })]);
  });

  it("transactions: edit and delete", async () => {
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    const row = () => [...document.querySelectorAll("tr.tx-row-full")].find((r) => r.textContent.includes("Noodle & Newt"));
    fireEvent.click(within(row()).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(row()).getByRole("button", { name: "Yes" }));
    await flush();
    expect(lastSave()).toEqual({ deletes: { transactions: ["t2"] } });
  });

  it("planning: planned income, a category's budget, dismissing the warning, and excluding unassigned", async () => {
    const { nav, lastSave } = await openApp();
    nav("Planning");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("2700"), { target: { value: "3000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]); await flush();
    expect(lastSave().settings.props.plannedIncome).toBe(3000);
    const rentRow = screen.getByText("Rent").closest("div").parentElement;
    fireEvent.change(within(rentRow).getByPlaceholderText("none"), { target: { value: "1100" } });
    fireEvent.click(within(rentRow).getByRole("button", { name: "Save" })); await flush();
    expect(lastSave().upserts.categories).toEqual([expect.objectContaining({ id: "cat-rent", props: expect.objectContaining({ budgetAmount: 1100, budgetPeriod: "monthly" }) })]);
    fireEvent.click(screen.getByLabelText(/Exclude unassigned spending/)); await flush();
    expect(lastSave().settings.props.excludeUnassignedFromBudget).toBe(true);
  });

  it("budget groups: create, rename, set its budget, add and remove categories, delete", async () => {
    const { nav, lastSave } = await openApp();
    nav("Budget Groups");
    fireEvent.change(screen.getByPlaceholderText("New group name…"), { target: { value: "Food" } });
    fireEvent.click(screen.getByRole("button", { name: "Add group" })); await flush();
    expect(lastSave().upserts.budget_groups).toEqual([expect.objectContaining({ name: "Food", category_ids: [] })]);
    const home = card("Household Overhead", ".account-card") || screen.getByText("Household Overhead").closest("div").parentElement.parentElement;
    fireEvent.change(within(home).getByDisplayValue("Add a category…"), { target: { value: "cat-groc" } });
    fireEvent.click(within(home).getByRole("button", { name: "Add" })); await flush();
    expect(lastSave().upserts.budget_groups).toEqual([expect.objectContaining({ id: "grp-home", category_ids: ["cat-util", "cat-groc"] })]);
    const utilChip = within(home).getAllByRole("button", { name: "×" }).find((b) => b.parentElement.textContent.includes("Utilities"));
    fireEvent.click(utilChip); await flush();
    expect(lastSave().upserts.budget_groups).toEqual([expect.objectContaining({ id: "grp-home", category_ids: ["cat-groc"] })]);
    fireEvent.change(within(home).getByDisplayValue("220"), { target: { value: "300" } });
    fireEvent.click(within(home).getByRole("button", { name: "Save" })); await flush();
    expect(lastSave().upserts.budget_groups).toEqual([expect.objectContaining({ id: "grp-home", props: expect.objectContaining({ budgetAmount: 300 }) })]);
    fireEvent.click(within(home).getByRole("button", { name: "Rename" }));
    const input = within(home).getByDisplayValue("Household Overhead");
    fireEvent.change(input, { target: { value: "Home" } });
    fireEvent.keyDown(input, { key: "Enter" }); await flush();
    expect(lastSave().upserts.budget_groups).toEqual([expect.objectContaining({ id: "grp-home", name: "Home" })]);
    fireEvent.click(within(home).getByRole("button", { name: "Delete group" }));
    fireEvent.click(within(home).getByRole("button", { name: "Confirm" })); await flush();
    expect(lastSave().deletes.budget_groups).toEqual(["grp-home"]);
  });

  it("budget: set this month's savings, adjust a fund's balance, and hide a month", async () => {
    const { nav, lastSave } = await openApp();
    nav("Budget");
    const fundCard = screen.getAllByText("Supplies Fund").map((el) => el.closest(".budget-card")).find(Boolean);
    fireEvent.click(within(fundCard).getAllByRole("button", { name: "Adjust" })[0]);
    const input = within(fundCard).getByDisplayValue("170");
    fireEvent.change(input, { target: { value: "200" } });
    fireEvent.keyDown(input, { key: "Enter" }); await flush();
    expect(lastSave().upserts.categories[0].props.accumulateActuals).toEqual({ "2026-09-01": 200 });
    fireEvent.click(within(fundCard).getAllByRole("button", { name: "Adjust" }).at(-1));
    const bal = within(fundCard).getByDisplayValue(/^\d+\.\d\d$/);
    fireEvent.change(bal, { target: { value: "600" } });
    fireEvent.keyDown(bal, { key: "Enter" }); await flush();
    expect(lastSave().upserts.categories[0].props.fundAdjustments).toEqual([expect.objectContaining({ amount: expect.any(Number) })]);
    fireEvent.click(screen.getByRole("button", { name: "Jul 2026 — hide" })); await flush();
    expect(lastSave().settings.props.hiddenBudgetMonths).toEqual(["2026-07-01"]);
  });

  it("backup: restoring a budget file updates budgets by name", async () => {
    const { nav, lastSave } = await openApp();
    nav("Backup");
    const file = "Row Type,Item Type,Name,Budget Amount,Budget Period,Budget Type,Accumulate Target,Group,Members,Period,Amount\n" +
      "Settings,,,,,,,,,,3200\nCategory,Category,Rent,1100,monthly,spend,,,,,\n";
    fireEvent.change(document.querySelectorAll('input[type="file"]')[1], { target: { files: [new File([file], "budget.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: /Apply/ }));
    await flush();
    expect(lastSave().settings.props.plannedIncome).toBe(3200);
    expect(lastSave().upserts.categories).toEqual([expect.objectContaining({ id: "cat-rent", props: expect.objectContaining({ budgetAmount: 1100 }) })]);
  });

  it("backup: restoring a ledger file replaces everything", async () => {
    const { nav, lastSave } = await openApp();
    nav("Backup");
    const file = "Account,Date,Description,Money Out,Money In,Category,Category Excluded,Category Income,Uploaded At,Upload Batch,Not A Duplicate,Counts Toward Period\n" +
      "Vault,2026-09-01,Only row,5,,Misc,No,No,,,No,\n";
    fireEvent.change(document.querySelectorAll('input[type="file"]')[0], { target: { files: [new File([file], "ledger.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Replace everything with this backup" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, replace everything" }));
    await flush();
    expect(lastSave().deletes.transactions).toHaveLength(10);
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ description: "Only row" })]);
    expect(document.title).toBe("Transactions | Coinrose");
  });

  it("the phone menu opens and closes, and Settings can replay the tour from any page", async () => {
    const { nav, container } = await openApp();
    fireEvent.click(container.querySelector(".hamburger-btn"));
    expect(container.querySelector(".sidebar").className).toMatch(/mobile-open/);
    fireEvent.click(container.querySelector(".sidebar-backdrop"));
    expect(container.querySelector(".sidebar").className).not.toMatch(/mobile-open/);
    nav("Reports");
    act(() => window.dispatchEvent(new Event("coinrose:start-tutorial")));
    expect(await screen.findByText(/Step 1 of/)).toBeTruthy();
    expect(document.title).toBe("Overview | Coinrose");
  });

  it("the categorize-your-import screen can be skipped", async () => {
    const { nav } = await openApp();
    nav("Upload");
    const csv = "Date,Description,Money Out,Money In\n2026-09-22,Bakery,4.50,\n";
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([csv], "x.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Check 1 rows" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 1 transaction" }));
    fireEvent.click(await screen.findByRole("button", { name: /Skip for now/ }));
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
  });
});
