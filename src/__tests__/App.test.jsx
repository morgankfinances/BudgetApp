import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import * as F from "./fixtures.js";
import { getImportPrefs } from "../lib/importPrefs.js";

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
    await waitFor(() => expect(document.title).toBe("Upload | Coinrose"));
  });

  it("navigating shows each page and updates the tab title", async () => {
    const { nav } = await openApp();
    nav("Transactions");
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Transactions | Coinrose"));
    nav("Budget");
    await waitFor(() => expect(document.title).toBe("Budget | Coinrose"));
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
    const csv = "Date,Description,Withdrawal,Deposit\n9/20/2026,Corner Grocer,31.07,\n9/21/2026,Refund,,5.00\n";
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([csv], "Savings.csv")] } });
    fireEvent.change(await screen.findByLabelText(/Which account is this statement from/), { target: { value: "__new__" } });
    fireEvent.click(await screen.findByRole("button", { name: "Check 2 rows" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Import 2 transactions into Savings$/ }));
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
    expect(document.body.textContent).toMatch(/Adding transactions to Griffon Card/);
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
    fireEvent.change(document.querySelectorAll('input[type="file"]:not([accept*="json"])')[1], { target: { files: [new File([file], "budget.csv")] } }); // the spreadsheet (CSV) pickers
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
    fireEvent.change(document.querySelectorAll('input[type="file"]:not([accept*="json"])')[0], { target: { files: [new File([file], "ledger.csv")] } }); // the spreadsheet (CSV) pickers
    fireEvent.click(await screen.findByRole("button", { name: "Replace everything with this backup" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, replace everything" }));
    await flush();
    expect(lastSave().deletes.transactions).toHaveLength(10);
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ description: "Only row" })]);
    await waitFor(() => expect(document.title).toBe("Transactions | Coinrose"));
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
    await waitFor(() => expect(document.title).toBe("Overview | Coinrose"));
  });

  it("the categorize-your-import screen can be skipped", async () => {
    const { nav } = await openApp();
    nav("Upload");
    const csv = "Date,Description,Money Out,Money In\n2026-09-22,Bakery,4.50,\n";
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([csv], "x.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Check 1 rows" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Import 1 transaction into/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Skip for now/ }));
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
  });
});

describe("the desktop sidebar can be hidden", () => {
  it("hides and shows, is remembered on this device, and keeps keyboard focus on the toggle", async () => {
    localStorage.removeItem("coinrose-sidebar-collapsed-v1");
    const first = await openApp();
    expect(first.container.querySelector(".app-shell").className).not.toMatch(/sidebar-collapsed/);
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(first.container.querySelector(".app-shell").className).toMatch(/sidebar-collapsed/);
    await waitFor(() => expect(document.activeElement.getAttribute("aria-label")).toBe("Show sidebar"));
    expect(localStorage.getItem("coinrose-sidebar-collapsed-v1")).toBe("true");
    first.unmount();
    const second = await openApp();
    expect(second.container.querySelector(".app-shell").className).toMatch(/sidebar-collapsed/);
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(second.container.querySelector(".app-shell").className).not.toMatch(/sidebar-collapsed/);
    await waitFor(() => expect(document.activeElement.getAttribute("aria-label")).toBe("Hide sidebar"));
  });
});

describe("suggested categories fill in automatically", () => {
  const importFile = async (csv, name = "export.csv") => {
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([csv], name)] } });
    fireEvent.click(await screen.findByRole("button", { name: /^Check \d+ rows$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Import \d+ transactions? into/ }));
    await flush();
  };
  const csv = "Date,Description,Money Out,Money In\n2026-09-22,Thrifty Sprout Market,12.00,\n2026-09-23,Brand New Shop,3.00,\n";

  it("importing fills in categories from past choices; they count, and can be confirmed", async () => {
    const { nav, lastSave } = await openApp();
    nav("Upload");
    await importFile(csv);
    const saved = lastSave().upserts.transactions;
    const sprout = saved.find((t) => t.description === "Thrifty Sprout Market");
    expect(sprout).toMatchObject({ category_id: "cat-groc", props: expect.objectContaining({ categorySuggested: true }) });
    expect(saved.find((t) => t.description === "Brand New Shop").category_id).toBeNull();
    expect(document.body.textContent).toMatch(/1 categorized from your past choices/);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm all 1 suggestion" }));
    await flush();
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ id: sprout.id, category_id: "cat-groc", props: {} })]);
  });

  it("with the setting off, imports don't fill anything in, and the setting is saved for the household", async () => {
    const { nav, lastSave } = await openApp();
    await act(async () => getImportPrefs().onToggleAutoApply(false)); // what Settings → Importing does
    await flush();
    expect(lastSave().settings.props.autoApplySuggestions).toBe(false);
    nav("Upload");
    await importFile(csv);
    expect(lastSave().upserts.transactions.every((t) => t.category_id === null)).toBe(true);
  });

  it("older uncategorized transactions can be filled in with one click, then confirmed or changed", async () => {
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestions" }));
    await flush();
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ id: "t7", category_id: "cat-groc", props: expect.objectContaining({ categorySuggested: true }) })]);
    expect(document.body.textContent).toMatch(/1 category was filled in/);
    const row = () => [...document.querySelectorAll("tr.tx-row-full")].find((r) => r.textContent.includes("Thrifty Sprout Market") && r.textContent.includes("Griffon"));
    fireEvent.click(within(row()).getByRole("button", { name: /Confirm suggested category/ }));
    await flush();
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ id: "t7", props: {} })]);
  });

  it("picking a different category also counts as confirming, and the Overview lists suggestions to confirm", async () => {
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestions" }));
    await flush();
    nav("Overview");
    expect(document.body.textContent).toMatch(/1 suggested category to confirm/);
    nav("Transactions");
    fireEvent.click(screen.getByLabelText(/Suggested, not yet confirmed/));
    const rows = [...document.querySelectorAll("tr.tx-row-full")];
    expect(rows).toHaveLength(1);
    fireEvent.change(within(rows[0]).getByRole("combobox"), { target: { value: "cat-dine" } });
    await flush();
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ id: "t7", category_id: "cat-dine", props: {} })]);
  });
});

describe("duplicates skipped on import", () => {
  const importCsv = async (csv) => {
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([csv], "export.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: /^Check \d+ rows$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Import \d+ transactions? into/ }));
    await flush();
  };
  const csv = "Date,Description,Money Out,Money In\n2026-09-02,THRIFTY SPROUT MARKET,180.00,\n2026-09-22,New Place,5.00,\n";

  it("skips what's already here, keeps it for review, and it can be restored or deleted", async () => {
    const { nav, lastSave } = await openApp();
    nav("Upload");
    await importCsv(csv);
    const saved = lastSave().upserts.transactions;
    const skipped = saved.find((t) => t.description === "THRIFTY SPROUT MARKET");
    expect(skipped.props.skippedDuplicateOf).toBe("t1");
    expect(saved.find((t) => t.description === "New Place").props.skippedDuplicateOf).toBeUndefined();
    expect(document.body.textContent).toMatch(/skipped 1 already in Coinrose/);
    nav("Transactions");
    expect(document.querySelectorAll("tr.tx-row-full")).toHaveLength(9); // September's 8 + the new one, not the skipped one
    fireEvent.click(screen.getByRole("button", { name: /Skipped duplicates \(1\)/ }));
    expect(document.body.textContent).toMatch(/Matched Thrifty Sprout Market on Sep 2, 2026/);
    fireEvent.click(screen.getByRole("button", { name: /^Restore THRIFTY SPROUT MARKET/ }));
    await flush();
    const restored = lastSave().upserts.transactions[0];
    expect(restored.props).toEqual(expect.objectContaining({ notDuplicate: true }));
    expect(restored.props.skippedDuplicateOf).toBeUndefined();
    expect(document.querySelectorAll("tr.tx-row-full")).toHaveLength(10);
  });

  it("skipped ones can be deleted for good, one at a time or all together", async () => {
    const { nav, lastSave, store } = await openApp();
    nav("Upload");
    await importCsv(csv);
    nav("Transactions");
    fireEvent.click(screen.getByRole("button", { name: /Skipped duplicates \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete them" }));
    await flush();
    expect(lastSave().deletes.transactions).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Skipped duplicates/ })).toBeNull();
  });

  it("'Flag only' imports everything; 'Off' imports everything and flags nothing", async () => {
    const { nav, lastSave } = await openApp();
    await act(async () => getImportPrefs().onSetDuplicateHandling("flag"));
    await flush();
    expect(lastSave().settings.props.duplicateHandling).toBe("flag");
    nav("Upload");
    await importCsv(csv);
    expect(lastSave().upserts.transactions.every((t) => !t.props.skippedDuplicateOf)).toBe(true);
    nav("Transactions");
    expect(document.body.textContent).toMatch(/Possible duplicates only \(4\)/); // t9/t10, and t1 with its new twin
    await act(async () => getImportPrefs().onSetDuplicateHandling("off"));
    await flush();
    expect(document.body.textContent).not.toMatch(/Possible duplicates only/);
  });
});

describe("transfers between accounts", () => {
  const addCardPayment = () => {
    db.data.transactions.push(
      { id: "pay-out", accountId: "acct-chk", accountName: "Millbrook Checking", date: "2026-09-20", description: "Card Payment", amountOut: 300, amountIn: null, categoryId: null, raw: null },
      { id: "pay-in", accountId: "acct-card", accountName: "Griffon Card", date: "2026-09-21", description: "Payment Thank You", amountOut: null, amountIn: 300, categoryId: null, raw: null }
    );
  };
  it("suggests the pair, and marking it moves both sides into Transfers, linked", async () => {
    addCardPayment();
    const { nav, lastSave } = await openApp();
    expect(document.body.textContent).toMatch(/1 possible transfer between your accounts/); // on the Overview
    nav("Transactions");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(document.body.textContent).toMatch(/from Millbrook Checking/);
    fireEvent.click(screen.getByRole("button", { name: /^Mark as transfer: \$300\.00 from Millbrook Checking to Griffon Card/ }));
    await flush();
    const saved = lastSave().upserts.transactions;
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pay-out", category_id: "cat-xfer", props: expect.objectContaining({ transferWith: "pay-in" }) }),
      expect.objectContaining({ id: "pay-in", category_id: "cat-xfer", props: expect.objectContaining({ transferWith: "pay-out" }) }),
    ]));
    expect(screen.queryByText(/possible transfer/)).toBeNull();
    expect(screen.getAllByText(/↔ Transfer (to|from)/)).toHaveLength(2);
    expect(screen.getByText("↔ Transfer to Griffon Card")).toBeTruthy();
  });
  it("Unpair puts both back to uncategorized; 'Not a transfer' is never suggested again", async () => {
    addCardPayment();
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    fireEvent.click(screen.getByRole("button", { name: "Mark all 1 as transfers" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Unpair this transfer: Card Payment" }));
    await flush();
    expect(lastSave().upserts.transactions.map((t) => [t.id, t.category_id, t.props.transferWith]).sort()).toEqual([["pay-in", null, undefined], ["pay-out", null, undefined]]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: /^Not a transfer:/ }));
    await flush();
    expect(lastSave().upserts.transactions.find((t) => t.id === "pay-out").props.notTransferWith).toEqual(["pay-in"]);
    expect(screen.queryByText(/possible transfer/)).toBeNull();
  });
  it("giving one side a different category unpairs both", async () => {
    addCardPayment();
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    fireEvent.click(screen.getByRole("button", { name: "Mark all 1 as transfers" }));
    await flush();
    const row = [...document.querySelectorAll("tr.tx-row-full")].find((r) => r.textContent.includes("Card Payment"));
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "cat-groc" } });
    await flush();
    const saved = lastSave().upserts.transactions;
    expect(saved.find((t) => t.id === "pay-out")).toEqual(expect.objectContaining({ category_id: "cat-groc" }));
    expect(saved.every((t) => t.props.transferWith === undefined)).toBe(true);
  });
});

describe("split transactions", () => {
  const splitNoodle = async (dine, groc) => {
    const row = [...document.querySelectorAll("tr.tx-row-full")].find((r) => r.textContent.includes("Noodle & Newt"));
    fireEvent.click(within(row).getByRole("button", { name: /^Split Noodle/ }));
    fireEvent.change(screen.getByLabelText("Amount for part 1"), { target: { value: String(dine) } });
    fireEvent.change(screen.getByLabelText("Category for part 2"), { target: { value: "cat-groc" } });
    fireEvent.change(screen.getByLabelText("Amount for part 2"), { target: { value: String(groc) } });
    fireEvent.click(screen.getByRole("button", { name: "Save split" }));
    await flush();
  };
  it("saving a split stores its lines, and budgets and totals count each piece", async () => {
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    await splitNoodle(30, 15);
    expect(lastSave().upserts.transactions).toEqual([expect.objectContaining({ id: "t2", category_id: null,
      props: expect.objectContaining({ splits: [{ categoryId: "cat-dine", amount: 30 }, { categoryId: "cat-groc", amount: 15 }] }) })]);
    nav("Overview");
    const top = document.querySelector(".overview-grid").textContent;
    expect(top).toMatch(/Groceries\$195\.00/); // t1's $180 plus the $15 piece
  });
  it("changing the amount so the split no longer adds up clears it", async () => {
    const { nav, lastSave } = await openApp();
    nav("Transactions");
    await splitNoodle(30, 15);
    const row = [...document.querySelectorAll("tr.tx-row-full")].find((r) => r.textContent.includes("Noodle & Newt"));
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(row).getByDisplayValue("45"), { target: { value: "50" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await flush();
    const saved = lastSave().upserts.transactions[0];
    expect(saved.amount_out).toBe(50);
    expect(saved.props.splits).toBeUndefined();
  });
});

describe("recurring bills and insights", () => {
  const addSubscription = () => {
    ["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"].forEach((date, i) =>
      db.data.transactions.push({ id: `sub${i}`, accountId: "acct-card", accountName: "Griffon Card", date, description: `WHISPERWIRE MUSIC ${1000 + i}`, amountOut: 10.99, amountIn: null, categoryId: "cat-dine", raw: null })
    );
  };
  it("the Overview shows what's coming up, and Insights lists it; 'Not recurring' is saved for the household", async () => {
    addSubscription();
    const { nav, lastSave } = await openApp();
    const coming = screen.getByRole("heading", { name: "Coming up" }).closest(".panel");
    expect(coming.textContent).toMatch(/WHISPERWIRE MUSIC 1003.*Oct 3, 2026.*\$10\.99/);
    fireEvent.click(within(coming).getByRole("button", { name: "See Insights" }));
    expect(screen.getByRole("heading", { name: "Insights", level: 1 })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Insights | Coinrose"));
    const bills = screen.getByRole("table", { name: "Recurring bills and subscriptions" });
    expect(bills.textContent).toMatch(/Every month/);
    expect(document.body.textContent).toMatch(/1 fixed-price service/);
    fireEvent.click(screen.getByRole("button", { name: /^Not recurring: hide WHISPERWIRE/ }));
    await flush();
    expect(lastSave().settings.props.hiddenRecurring).toEqual(["out|whisperwire music"]);
    expect(screen.queryByRole("table", { name: "Recurring bills and subscriptions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Marked not recurring \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Show WHISPERWIRE MUSIC 1003 again/ }));
    await flush();
    expect(lastSave().settings.props.hiddenRecurring).toEqual([]);
    nav("Overview");
    expect(screen.getByRole("heading", { name: "Coming up" })).toBeTruthy();
  });
});

describe("comments", () => {
  const openAs = async (currentUserId) => {
    localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
    const utils = render(<App householdName="Alchemist Household" currentUserId={currentUserId} householdMembers={[{ user_id: "me", email: "morgan@example.com" }]} />);
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(within(utils.container.querySelector(".sidebar")).getByRole("button", { name: "Transactions" }));
    return () => db.saves[db.saves.length - 1];
  };
  it("posting saves the comment on the transaction with your account ID (not your email); deleting removes it", async () => {
    const lastSave = await openAs("me");
    fireEvent.click(screen.getByRole("button", { name: "Comment on Noodle & Newt" }));
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "Birthday dinner" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await flush();
    const saved = lastSave().upserts.transactions[0];
    expect(saved.id).toBe("t2");
    expect(saved.props.comments).toEqual([{ id: expect.any(String), text: "Birthday dinner", authorId: "me", at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }]);
    expect(JSON.stringify(saved.props)).not.toMatch(/morgan@example\.com/);
    expect(screen.getByRole("button", { name: "1 comment on Noodle & Newt" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Delete your comment: Birthday dinner/ }));
    await flush();
    expect(lastSave().upserts.transactions[0].props.comments).toBeUndefined();
  });
  it("someone else's comment can't be deleted", async () => {
    db.data.transactions = db.data.transactions.map((t) => (t.id === "t2" ? { ...t, comments: [{ id: "c", text: "Mine", authorId: "sam", at: "2026-09-05T20:00:00Z" }] } : t));
    await openAs("me");
    fireEvent.click(screen.getByRole("button", { name: "1 comment on Noodle & Newt" }));
    expect(screen.getByRole("group", { name: "Comments on Noodle & Newt" }).textContent).toMatch(/Former member/);
    expect(screen.queryByRole("button", { name: /^Delete your comment/ })).toBeNull();
  });
});

describe("the guided tour, start to finish", () => {
  it("visits every page it describes, in order, including Accounts and Insights, and ends on the Overview", async () => {
    localStorage.clear();
    await openApp({ seenTutorial: false });
    fireEvent.click(await screen.findByRole("button", { name: "Start the tour" }));
    const titles = [];
    for (let i = 0; i < 20; i += 1) {
      await waitFor(() => expect(document.title).toMatch(/\| Coinrose$/));
      titles.push(document.title.replace(" | Coinrose", ""));
      const next = screen.queryByRole("button", { name: "Next" });
      if (!next) break;
      fireEvent.click(next);
    }
    const pages = titles.filter((t, i) => t !== titles[i - 1]); // each page once, in the order visited
    expect(pages).toEqual(["Overview", "Upload", "Accounts", "Transactions", "Categories", "Reports", "Insights", "Planning", "Budget Groups", "Budget", "Backup", "Overview"]);
    expect(document.body.textContent).toMatch(/turn on two-step sign-in/);
  });
});

describe("balances and complete backups, through the app", () => {
  it("a starting balance is saved with the account, and removing it stops tracking", async () => {
    const { nav, lastSave } = await openApp();
    nav("Accounts");
    fireEvent.click(screen.getByRole("button", { name: "Track the balance of Millbrook Checking" }));
    fireEvent.change(screen.getByLabelText("Balance"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("At the end of"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save starting balance" }));
    await flush();
    expect(lastSave().upserts.accounts).toEqual([expect.objectContaining({ id: "acct-chk", props: expect.objectContaining({ startingBalance: { amount: 1500, date: "2026-09-01", owed: false } }) })]);
    expect(document.querySelector(".balance-row").textContent).toMatch(/Estimated balance/);
    fireEvent.click(screen.getByRole("button", { name: "Change the starting balance for Millbrook Checking" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    await flush();
    expect(lastSave().upserts.accounts[0].props.startingBalance).toBeUndefined();
  });
  it("restoring a complete backup replaces everything, including the household's settings", async () => {
    const { nav, lastSave } = await openApp();
    nav("Backup");
    const backup = buildFullBackup({ accounts: [{ id: "new-acct", name: "Restored Checking" }], categories: [{ id: "c-new", name: "Restored Category" }], budgetGroups: [],
      transactions: [{ id: "r1", accountId: "new-acct", date: "2026-09-10", description: "Restored", amountOut: 5, amountIn: null, categoryId: "c-new", comments: [{ id: "k", text: "kept", authorId: "u", at: "2026-09-10T00:00:00Z" }] }],
      plannedIncome: 1234, duplicateHandling: "off", autoApplySuggestions: false, hiddenRecurring: ["out|x"] });
    fireEvent.change(document.querySelector('input[type="file"][accept*="json"]'), { target: { files: [new File([JSON.stringify(backup)], "coinrose-backup.json")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Replace everything with this backup" }));
    await flush();
    const save = lastSave();
    expect(save.upserts.transactions).toEqual([expect.objectContaining({ id: "r1", props: expect.objectContaining({ comments: [expect.objectContaining({ text: "kept" })] }) })]);
    expect(save.deletes.transactions).toHaveLength(10);
    expect(save.settings.props).toEqual(expect.objectContaining({ plannedIncome: 1234, duplicateHandling: "off", autoApplySuggestions: false, hiddenRecurring: ["out|x"] }));
    expect(document.body.textContent).toMatch(/Restored everything from the complete backup/);
  });
});
import { buildFullBackup } from "../lib/backup.js";

describe("importing a budget, through the app", () => {
  it("applying saves only the budget changes, and says it can be undone", async () => {
    const { nav, lastSave } = await openApp();
    nav("Planning");
    fireEvent.change(document.querySelector('.budget-templates input[type="file"]'), { target: { files: [new File(["Kind,Name,Amount,Period,Type,Goal,Group\nCategory,Groceries,500,monthly,Spend,,"], "t.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Apply this budget" }));
    await flush();
    const save = lastSave();
    expect(save.upserts.categories.map((c) => [c.name, c.props.budgetAmount])).toEqual([["Groceries", 500]]);
    expect(save.upserts.transactions).toBeUndefined();
    expect(document.body.textContent).toMatch(/Budget imported\. You can undo it from Settings → Data History for 7 days\./);
  });
});
