import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, waitFor, cleanup } from "@testing-library/react";
import * as F from "./fixtures.js";
import { OverviewView } from "../views/OverviewView.jsx";
import { BudgetView } from "../views/BudgetView.jsx";
import { PlanningView } from "../views/PlanningView.jsx";
import { BudgetGroupsView } from "../views/BudgetGroupsView.jsx";
import { AccountsView } from "../views/AccountsView.jsx";
import { UploadView } from "../views/UploadView.jsx";
import { ReportsView } from "../views/ReportsView.jsx";
import { BackupView } from "../views/BackupView.jsx";
import { TutorialDialog } from "../components/TutorialDialog.jsx";
import { EmptyState, StatBlock, DualScrollPanel } from "../components/common.jsx";
import { TUTORIAL_STEPS } from "../lib/tutorial.js";
import { REPORT_CONFIG_KEY } from "../lib/periods.js";

describe("Overview", () => {
  it("shows this month's totals, what needs attention, and top spending, and links onward", () => {
    const onNavigate = vi.fn();
    render(<OverviewView transactions={F.transactions} categories={F.categories} budgetGroups={F.budgetGroups} onNavigate={onNavigate} />);
    const text = document.body.textContent;
    expect(text).toContain("A snapshot of Sep 2026");
    expect(text).toContain("-$167.37");                     // September net, excluding the transfer
    expect(text).toMatch(/Dining OutNearing its limit/);    // $45 of $50 = 90%
    expect(text).toMatch(/3 of 4 budgets on track/);
    expect(text).toMatch(/Top spending this periodRent\$1,100\.00/);
    fireEvent.click(screen.getByRole("button", { name: /2 uncategorized transactions/ }));
    fireEvent.click(screen.getByRole("button", { name: /See full Reports/ }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(["transactions", "reports"]);
  });
  it("with nothing flagged, says so", () => {
    render(<OverviewView transactions={[]} categories={[]} budgetGroups={[]} onNavigate={vi.fn()} />);
    expect(document.body.textContent).toMatch(/Nothing flagged right now/);
  });
});

describe("Budget", () => {
  const setup = () => {
    const fns = { onSetActual: vi.fn(), onAdjustFund: vi.fn(), onToggleHiddenMonth: vi.fn(), onGoCategories: vi.fn() };
    render(<BudgetView transactions={F.transactions} categories={F.categories} budgetGroups={F.budgetGroups}
      hiddenBudgetMonths={[]} excludeUnassignedFromBudget={false} {...fns} />);
    return fns;
  };
  it("shows each budget's spending against its limit this month, including groups", () => {
    setup();
    const text = document.body.textContent;
    expect(text).toContain("$180.00 of $240.00");
    expect(text).toContain("$45.00 of $50.00");
    expect(text).toContain("$150.00 of $220.00");
    expect(text).toMatch(/\$170\.00 set aside of \$170\.00 planned/);
  });
  it("shows a fund's running balance and progress toward its goal", () => {
    setup();
    expect(document.body.textContent).toMatch(/\$510\.00/);
    expect(document.body.textContent).toMatch(/28% of \$1,800\.00 goal/);
  });
  it("adjusting a fund's balance records the difference", () => {
    const { onAdjustFund } = setup();
    const balanceSection = screen.getByText(/FUND BALANCE|Fund balance/i).closest("div").parentElement;
    fireEvent.click(within(balanceSection).getByRole("button", { name: "Adjust" }));
    const input = within(balanceSection).getByDisplayValue("510.00");
    fireEvent.change(input, { target: { value: "600" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdjustFund).toHaveBeenCalledWith("cat:cat-fund", 90);
  });
  it("hiding a month from the history is passed along", () => {
    const { onToggleHiddenMonth } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Jul 2026 — hide" }));
    expect(onToggleHiddenMonth).toHaveBeenCalledWith("2026-07-01");
  });
});

describe("Planning", () => {
  const setup = (extra = {}) => {
    const fns = { onSetPlannedIncome: vi.fn(), onDismissIncomeWarning: vi.fn(), onSetCategoryBudget: vi.fn(), onToggleExcludeUnassigned: vi.fn() };
    render(<PlanningView transactions={F.transactions} categories={F.categories} budgetGroups={F.budgetGroups} plannedIncome={2700}
      incomeWarningDismissed={false} excludeUnassignedFromBudget={false} {...fns} {...extra} />);
    return fns;
  };
  it("shows planned income, what's assigned, and what's left", () => {
    setup();
    expect(document.body.textContent).toMatch(/\$2,700\.00Planned income\$680\.00Assigned to budgets\$2,020\.00Unassigned/);
  });
  it("editing planned income saves the new amount", () => {
    const { onSetPlannedIncome } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByDisplayValue("2700");
    fireEvent.change(input, { target: { value: "$3,100" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    expect(onSetPlannedIncome).toHaveBeenCalledWith(3100);
  });
  it("giving an unbudgeted category a budget saves its amount, period, and type", () => {
    const { onSetCategoryBudget } = setup();
    const row = screen.getByText("Rent").closest("div").parentElement;
    fireEvent.change(within(row).getByPlaceholderText("none"), { target: { value: "1100" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(onSetCategoryBudget).toHaveBeenCalledWith("cat-rent", 1100, "monthly", "spend", null, null);
  });
  it("the exclude-unassigned setting is passed along", () => {
    const { onToggleExcludeUnassigned } = setup();
    fireEvent.click(screen.getByLabelText(/Exclude unassigned spending/));
    expect(onToggleExcludeUnassigned).toHaveBeenCalledWith(true);
  });
  it("warns when budgets add up to more than planned income", () => {
    setup({ plannedIncome: 500 });
    expect(document.body.textContent).toMatch(/more than|exceed|over/i);
  });
});

describe("Budget Groups", () => {
  const setup = () => {
    const fns = { onAdd: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onSetBudget: vi.fn(), onAddCategory: vi.fn(), onRemoveCategory: vi.fn() };
    render(<BudgetGroupsView budgetGroups={F.budgetGroups} categories={F.categories} transactions={F.transactions} {...fns} />);
    return fns;
  };
  it("creates a group, adds and removes categories, and sets its budget", () => {
    const f = setup();
    fireEvent.change(screen.getByPlaceholderText("New group name…"), { target: { value: "Food" } });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(f.onAdd).toHaveBeenCalledWith("Food");
    fireEvent.change(screen.getByDisplayValue("Add a category…"), { target: { value: "cat-groc" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(f.onAddCategory).toHaveBeenCalledWith("grp-home", "cat-groc");
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(f.onRemoveCategory).toHaveBeenCalledWith("grp-home", "cat-util");
    fireEvent.change(screen.getByDisplayValue("220"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(f.onSetBudget).toHaveBeenCalledWith("grp-home", 250, "monthly", "spend", null, null);
  });
  it("renames and deletes a group", () => {
    const f = setup();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Household Overhead");
    fireEvent.change(input, { target: { value: "Home" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(f.onRename).toHaveBeenCalledWith("grp-home", "Home");
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(f.onDelete).toHaveBeenCalledWith("grp-home");
  });
});

describe("Accounts", () => {
  const setup = () => {
    const fns = { onDelete: vi.fn(), onAddTransactions: vi.fn(), onRename: vi.fn(), onUpdateSettings: vi.fn(), onGoUpload: vi.fn() };
    render(<AccountsView accounts={F.accounts} transactions={F.transactions} {...fns} />);
    const card = (name) => screen.getByText(name).closest(".account-card");
    return { ...fns, card };
  };
  it("shows each account's balance and activity", () => {
    const { card } = setup();
    expect(card("Millbrook Checking").textContent).toMatch(/7 transactions.*-\$694\.87.*\$1,355\.13 in \/ \$2,050\.00 out/);
  });
  it("renames, adds transactions, and deletes with confirmation", () => {
    const { card, onRename, onAddTransactions, onDelete } = setup();
    const chk = card("Millbrook Checking");
    fireEvent.click(within(chk).getByRole("button", { name: "Add transactions" }));
    expect(onAddTransactions).toHaveBeenCalledWith("acct-chk");
    fireEvent.click(within(chk).getByRole("button", { name: "Rename" }));
    const input = within(chk).getByDisplayValue("Millbrook Checking");
    fireEvent.change(input, { target: { value: "Checking" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("acct-chk", "Checking");
    fireEvent.click(within(chk).getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(chk).getByRole("button", { name: /Confirm|Yes/ }));
    expect(onDelete).toHaveBeenCalledWith("acct-chk");
  });
  it("column settings offer only the columns that were kept, and save changes", () => {
    const { card, onUpdateSettings } = setup();
    const chk = card("Millbrook Checking").closest(".account-card-wrap");
    fireEvent.click(within(chk).getByRole("button", { name: "Settings" }));
    expect(chk.textContent).toMatch(/Only the columns you mapped are kept/);
    const options = within(chk).getAllByRole("combobox")[0].querySelectorAll("option");
    expect([...options].map((o) => o.textContent)).toEqual(["Select a column…", "Date", "Description"]);
    fireEvent.click(within(chk).getByRole("button", { name: /Save|Apply/ }));
    expect(onUpdateSettings).toHaveBeenCalledWith("acct-chk", expect.objectContaining({ dateCol: "Date" }));
  });
  it("with no accounts, points to Upload", () => {
    const onGoUpload = vi.fn();
    render(<AccountsView accounts={[]} transactions={[]} onDelete={vi.fn()} onAddTransactions={vi.fn()} onRename={vi.fn()}
      onUpdateSettings={vi.fn()} onGoUpload={onGoUpload} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onGoUpload).toHaveBeenCalled();
  });
});

describe("Upload", () => {
  const csv = "Post Date,Description,Withdrawal,Deposit,Account Number\n9/20/2026,Corner Grocer,31.07,,000123456789\n9/21/2026,Refund,,5.00,000123456789\nbad date,Broken,1,,000123456789\n";
  const choose = (container, text, name = "statement.csv") =>
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File([text], name)] } });

  it("a new account: guesses the columns, checks the rows, and imports only the good ones", async () => {
    const onImport = vi.fn();
    const { container } = render(<UploadView accounts={[]} prefill={null} onImport={onImport} />);
    choose(container, csv, "Millbrook Savings.csv");
    await screen.findByRole("button", { name: "Check 3 rows" });
    expect(screen.getByDisplayValue("Millbrook Savings")).toBeTruthy();       // name guessed from the file
    expect(screen.getByDisplayValue("Post Date")).toBeTruthy();                // date column guessed
    expect(screen.getByDisplayValue("Withdrawal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check 3 rows" }));
    expect(document.body.textContent).toMatch(/unrecognized date/);
    fireEvent.click(await screen.findByRole("button", { name: /^Import 2 transactions into Millbrook Savings$/ }));
    const [meta, txs] = onImport.mock.calls[0];
    expect(meta).toMatchObject({ name: "Millbrook Savings", dateCol: "Post Date", outCol: "Withdrawal", inCol: "Deposit" });
    expect(txs.map((t) => [t.date, t.description, t.amountOut, t.amountIn])).toEqual([
      ["2026-09-20", "Corner Grocer", 31.07, null], ["2026-09-21", "Refund", null, 5]]);
    expect(JSON.stringify(txs)).not.toContain("000123456789"); // the bank's extra column isn't kept
  });
  it("adding to an existing account reuses its column settings", async () => {
    const onImport = vi.fn();
    const { container } = render(<UploadView accounts={F.accounts} prefill={null} onImport={onImport} />);
    choose(container, "Date,Description,Money Out,Money In\n2026-09-22,Bakery,4.50,\n");
    fireEvent.click(await screen.findByRole("button", { name: "Check 1 rows" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Import 1 transaction into Millbrook Checking$/ }));
    expect(onImport.mock.calls[0][0]).toMatchObject({ id: "acct-chk", name: "Millbrook Checking" });
  });
  it("explains a file it can't read", async () => {
    const { container } = render(<UploadView accounts={[]} prefill={null} onImport={vi.fn()} />);
    choose(container, "x", "notes.pdf");
    await waitFor(() => expect(document.body.textContent).toMatch(/Unsupported file type/));
  });
});

describe("Reports", () => {
  it("totals spending by category per month, and lets categories be hidden from charts", () => {
    render(<ReportsView transactions={F.transactions} accounts={F.accounts} categories={F.categories} onGoCategories={vi.fn()} />);
    const table = document.querySelector(".pivot-table");
    expect(table.textContent).toMatch(/AUG 2026|Aug 2026/i);
    expect(table.textContent).toMatch(/Groceries.*-\$420\.00.*-\$180\.00/);
    expect(table.textContent).not.toMatch(/Transfers/);                    // excluded category
    fireEvent.click(screen.getByRole("button", { name: "Rent — hide" }));
    expect(screen.getByRole("button", { name: /Rent \(hidden\) — show/ })).toBeTruthy();
    expect(table.textContent).toMatch(/Rent/);                              // still in the table
    expect(JSON.parse(localStorage.getItem(REPORT_CONFIG_KEY)).hiddenCategories).toEqual(["cat-rent"]); // remembered
  });
  it("switches period modes", () => {
    render(<ReportsView transactions={F.transactions} accounts={F.accounts} categories={F.categories} onGoCategories={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(document.querySelector(".pivot-table").textContent).toMatch(/Sep 13/);
    fireEvent.click(screen.getByRole("button", { name: "Donut chart" }));
    expect(document.body.textContent).toMatch(/Each donut shows that period/);
  });
});

describe("Backup", () => {
  it("restoring a ledger backup previews it first, then applies it", async () => {
    const onRestore = vi.fn();
    const { container } = render(<BackupView accounts={F.accounts} transactions={F.transactions} categories={F.categories}
      budgetGroups={F.budgetGroups} plannedIncome={2700} onRestore={onRestore} onRestoreBudget={vi.fn()} />);
    const backup = "Account,Date,Description,Money Out,Money In,Category,Category Excluded,Category Income,Uploaded At,Upload Batch,Not A Duplicate,Counts Toward Period\n" +
      "Checking,2026-09-01,Rent,1100,,Rent,No,No,,,No,\n";
    fireEvent.change(container.querySelectorAll('input[type="file"]')[0], { target: { files: [new File([backup], "ledger.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Replace everything with this backup" }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/undo it for 7 days from Settings → Data History/);
    fireEvent.click(screen.getByRole("button", { name: "Yes, replace everything" }));
    const [accts, cats, txs] = onRestore.mock.calls[0];
    expect([accts[0].name, cats[0].name, txs[0].description, txs[0].amountOut]).toEqual(["Checking", "Rent", "Rent", 1100]);
  });
});

describe("Tutorial dialog", () => {
  const setup = (step, showUpload = false) => {
    const fns = { onBack: vi.fn(), onNext: vi.fn(), onSkip: vi.fn(), onFinish: vi.fn(), onUpload: vi.fn() };
    render(<TutorialDialog step={step} showUpload={showUpload} {...fns} />);
    return fns;
  };
  it("the first step starts the tour or skips it", () => {
    const f = setup(0);
    expect(screen.getByText(`Step 1 of ${TUTORIAL_STEPS.length}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start the tour" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect([f.onNext.mock.calls.length, f.onSkip.mock.calls.length]).toEqual([1, 1]);
  });
  it("middle steps go back and forward; Escape skips", () => {
    const f = setup(4);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect([f.onBack.mock.calls.length, f.onNext.mock.calls.length, f.onSkip.mock.calls.length]).toEqual([1, 1, 1]);
  });
  it("the last step finishes, and offers an upload to a new household", () => {
    const f = setup(TUTORIAL_STEPS.length - 1, true);
    fireEvent.click(screen.getByRole("button", { name: "Upload a statement" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect([f.onUpload.mock.calls.length, f.onFinish.mock.calls.length]).toEqual([1, 1]);
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
  });
});

describe("shared pieces", () => {
  it("empty state shows its message and action; stat block shows a value and label; the scroll panel shows its content", () => {
    const onCta = vi.fn();
    render(<div><EmptyState title="Nothing here" body="Add something" ctaLabel="Add" onCta={onCta} /><StatBlock value="$5.00" label="Net" />
      <DualScrollPanel><table><tbody><tr><td>cell</td></tr></tbody></table></DualScrollPanel></div>);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCta).toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/Nothing hereAdd something.*\$5\.00Net.*cell/);
  });
});

describe("duplicate budget group names", () => {
  it("adding or renaming to an existing group's name is refused", () => {
    const onAdd = vi.fn(), onRename = vi.fn();
    const groups = [...F.budgetGroups, { id: "grp-food", name: "Food", categoryIds: [], accumulateActuals: {}, fundAdjustments: [] }];
    render(<BudgetGroupsView budgetGroups={groups} categories={F.categories} transactions={F.transactions} onAdd={onAdd} onRename={onRename}
      onDelete={vi.fn()} onSetBudget={vi.fn()} onAddCategory={vi.fn()} onRemoveCategory={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("New group name…"), { target: { value: "FOOD" } });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/already a group called "Food"/);
    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    const input = screen.getByDisplayValue("Household Overhead");
    fireEvent.change(input, { target: { value: "food" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("Reports: custom periods, account filter, remembered settings", () => {
  const open = () => render(<ReportsView transactions={F.transactions} accounts={F.accounts} categories={F.categories} onGoCategories={vi.fn()} />);
  const tableText = () => document.querySelector(".pivot-table").textContent;

  it("'Every X days' groups by blocks from a chosen start date, and keeps the length sensible", () => {
    const { container } = open();
    fireEvent.click(screen.getByRole("button", { name: "Every X days" }));
    const [days] = container.querySelectorAll('input[type="number"]');
    fireEvent.change(days, { target: { value: "14" } });
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: "2026-09-01" } });
    expect(tableText()).toMatch(/Sep 1–14/);
    expect(tableText()).toMatch(/Sep 15–28/);
    fireEvent.change(days, { target: { value: "abc" } });
    expect(days.value).toBe("1");                    // nonsense becomes a 1-day period, not an error
  });

  it("'Twice a month' splits each month on the chosen days, and keeps days within 1–31", () => {
    const { container } = open();
    fireEvent.click(screen.getByRole("button", { name: "Twice a month" }));
    const [d1, d2] = container.querySelectorAll('input[type="number"]');
    fireEvent.change(d1, { target: { value: "1" } });
    fireEvent.change(d2, { target: { value: "15" } });
    expect(tableText()).toMatch(/Sep 1–14/);
    expect(tableText()).toMatch(/Sep 15–30/);
    fireEvent.change(d2, { target: { value: "40" } });
    expect(d2.value).toBe("31");
    fireEvent.change(d1, { target: { value: "0" } });
    expect(d1.value).toBe("1");
  });

  it("filtering to one account shows only that account's spending", () => {
    open();
    fireEvent.change(screen.getByDisplayValue("All accounts"), { target: { value: "acct-card" } });
    expect(tableText()).toMatch(/Dining Out/);
    expect(tableText()).not.toMatch(/Rent/);
  });

  it("chosen settings are remembered next time", () => {
    const first = open();
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    fireEvent.click(screen.getByRole("button", { name: "Groceries — hide" }));
    first.unmount();
    open();
    expect(screen.getByRole("button", { name: /Groceries \(hidden\) — show/ })).toBeTruthy();
    expect(tableText()).toMatch(/Sep 13/);           // still weekly
    fireEvent.click(screen.getByRole("button", { name: /Groceries \(hidden\) — show/ }));
    expect(screen.getByRole("button", { name: "Groceries — hide" })).toBeTruthy();
  });

  it("donut charts work with a category hidden, and a month with no activity says so", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Donut chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Rent — hide" }));
    expect(document.body.textContent).toMatch(/Each donut shows that period/);
    expect(document.querySelectorAll(".recharts-wrapper, .recharts-responsive-container").length).toBeGreaterThan(0);
  });
});

import { matchAccountToFile } from "../views/UploadView.jsx";
describe("Upload: choosing the account", () => {
  const choose = (container, text, name) =>
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File([text], name)] } });
  const accountSelect = () => screen.getByLabelText(/Uploading to|Which account is this statement from/);

  it("matches a file to an account only when it's unambiguous", () => {
    const accts = [...F.accounts, { id: "restored", name: "Old Card" }]; // restored accounts have no saved columns
    expect(matchAccountToFile(accts, ["x"], "griffon-card-aug.csv")).toEqual({ id: "acct-card", reason: "name" });
    expect(matchAccountToFile(accts, ["x"], "Griffon_Reserve_2026-08.CSV")).toEqual({ id: "acct-card", reason: "name" });
    expect(matchAccountToFile(accts, ["x"], "millbrook-stmt.xlsx")).toEqual({ id: "acct-chk", reason: "name" });
    // generic words alone never match ("card" appears in "Griffon Card")
    expect(matchAccountToFile(accts, ["x"], "card-statement.csv")).toBeNull();
    // a word shared by two accounts' names is ambiguous
    expect(matchAccountToFile([{ id: "a", name: "Summit Checking" }, { id: "b", name: "Summit Savings" }], ["x"], "summit.csv")).toBeNull();
    expect(matchAccountToFile(accts, ["Date", "Description", "Money Out", "Money In"], "export.csv")).toEqual({ id: "acct-chk", reason: "columns" });
    expect(matchAccountToFile(accts, ["Date", "Description", "Amount", "Money Out", "Money In"], "export.csv")).toBeNull(); // both match
    expect(matchAccountToFile(accts, ["Posted", "Memo"], "statement.csv")).toBeNull();
  });
  it("with no clear match, nothing is pre-chosen and you can't continue until you pick", async () => {
    const onImport = vi.fn();
    const { container } = render(<UploadView accounts={F.accounts} prefill={null} onImport={onImport} />);
    expect(document.body.textContent).toMatch(/Choose the statement file first/);
    choose(container, "Posted,Memo,Out\n2026-09-01,Shop,5\n", "statement.csv");
    const select = await screen.findByLabelText(/Which account is this statement from/);
    expect(select.value).toBe("");
    expect(screen.getByRole("button", { name: "Check 1 rows" }).disabled).toBe(true);
    fireEvent.change(select, { target: { value: "__new__" } });
    expect(screen.getByLabelText("What should this account be called?").value).toBe("statement");
    fireEvent.change(screen.getByLabelText("Date column"), { target: { value: "Posted" } });
    fireEvent.change(screen.getByLabelText("Money out (expenses) column"), { target: { value: "Out" } });
    expect(screen.getByRole("button", { name: "Check 1 rows" }).disabled).toBe(false);
  });
  it("a clear match is pre-chosen, says why, and applies that account's column settings", async () => {
    const { container } = render(<UploadView accounts={F.accounts} prefill={null} onImport={vi.fn()} />);
    choose(container, "Date,Description,Money Out,Money In\n2026-09-22,Bakery,4.50,\n", "export.csv");
    await screen.findByText(/Matched by the file's columns/);
    expect(accountSelect().value).toBe("acct-chk");
    expect(document.body.textContent).toMatch(/Uploading to Millbrook Checking/);
    expect(screen.getByLabelText("Money out (expenses) column").value).toBe("Money Out");
  });
  it("switching to an account whose statements look different warns about it", async () => {
    const { container } = render(<UploadView accounts={F.accounts} prefill={null} onImport={vi.fn()} />);
    choose(container, "Date,Description,Money Out,Money In\n2026-09-22,Bakery,4.50,\n", "export.csv");
    await screen.findByText(/Matched by the file's columns/);
    fireEvent.change(accountSelect(), { target: { value: "acct-card" } });
    expect(screen.getByRole("alert").textContent).toMatch(/doesn't have the columns Griffon Card's statements have used before \(Amount\)/);
    expect(screen.queryByText(/Matched by/)).toBeNull();
  });
  it("starting from an account keeps it, and the review step names it with a way back", async () => {
    const onImport = vi.fn();
    const { container } = render(<UploadView accounts={F.accounts} prefill={{ mode: "append", accountId: "acct-card" }} onImport={onImport} />);
    expect(document.body.textContent).toMatch(/Adding transactions to Griffon Card/);
    choose(container, "Date,Description,Amount\n2026-09-22,Bakery,4.50\n", "whatever.csv");
    await screen.findByText(/Chosen because you started from this account/);
    fireEvent.click(screen.getByRole("button", { name: "Check 1 rows" }));
    expect(document.body.textContent).toMatch(/Adding to Griffon Card/);
    fireEvent.click(screen.getByRole("button", { name: "Change account or columns" }));
    expect(accountSelect().value).toBe("acct-card");
  });
});


describe("Overview: periods", () => {
  const open = (transactions = F.transactions) =>
    render(<OverviewView transactions={transactions} categories={F.categories} budgetGroups={F.budgetGroups} onNavigate={vi.fn()} />);
  const stats = () => [...document.querySelectorAll(".summary-stat")].map((s) => s.textContent);

  it("steps back to earlier periods and returns to the current one", () => {
    open();
    expect(screen.getByText("Sep 2026 (current)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the previous period, Aug 2026" }));
    expect(stats()).toEqual(["$0.00Money in", "$420.00Money out", "-$420.00Net"]);
    expect(screen.getByRole("button", { name: /Show the next period, Sep 2026/ }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Back to the current period" }));
    expect(screen.getByText("Sep 2026 (current)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Show the next period/ }).disabled).toBe(true);
  });
  it("the next button walks forward one period at a time", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Show the previous period, Aug 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Show the previous period, Jul 2026" }));
    fireEvent.click(screen.getByRole("button", { name: /Show the next period, Aug 2026/ }));
    expect(screen.getByText("Aug 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show the next period, Sep 2026/ }));
    expect(screen.getByText("Sep 2026 (current)")).toBeTruthy();
  });
  it("when the current period has nothing yet, it says so and offers the latest period with activity", () => {
    open(F.transactions.filter((t) => t.date < "2026-09-01"));
    expect(stats()).toEqual(["$0.00Money in", "$0.00Money out", "$0.00Net"]);
    expect(screen.getByRole("status").textContent).toMatch(/Nothing recorded for Sep 2026 yet\. Your most recent transaction is from Aug 3, 2026\./);
    fireEvent.click(screen.getByRole("button", { name: "Show Aug 2026" }));
    expect(stats()[1]).toBe("$420.00Money out");
  });
  it("late on the last evening of the month, it's still that month", () => {
    vi.setSystemTime(new Date(2026, 8, 30, 22, 45));
    open();
    expect(screen.getByText("Sep 2026 (current)")).toBeTruthy();
  });
});

describe("Upload: OFX files, transaction IDs, and duplicates", () => {
  const choose = (container, text, name) =>
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File([text], name)] } });
  const ofx = "<OFX><BANKACCTFROM><ACCTID>99884321</BANKACCTFROM><STMTTRN><DTPOSTED>20260920<TRNAMT>-7.25<FITID>F1<NAME>Round Loaf</STMTTRN></OFX>";
  it("explains why OFX/QFX or an ID column is the best choice", () => {
    render(<UploadView accounts={F.accounts} prefill={null} onImport={vi.fn()} />);
    expect(document.body.textContent).toMatch(/choose OFX or QFX if your bank offers it/);
    expect(document.querySelector('input[type="file"]').getAttribute("accept")).toBe(".csv,.xlsx,.xls,.ofx,.qfx");
  });
  it("an OFX file fills in every column, including IDs, and shows the account's last four digits", async () => {
    const { container } = render(<UploadView accounts={F.accounts} prefill={{ mode: "append", accountId: "acct-card" }} onImport={vi.fn()} />);
    choose(container, ofx, "export.ofx");
    await screen.findByText(/Read from an OFX\/QFX file/);
    expect(document.body.textContent).toMatch(/account ending in 4321/);
    expect(screen.getByLabelText("Transaction ID (optional)").value).toBe("Transaction ID");
    expect(screen.getByLabelText("Money out (expenses) column").value).toBe("Amount");
    expect(screen.queryByRole("alert")).toBeNull(); // no "different columns" warning for standard OFX columns
  });
  it("guesses a CSV's ID column, and remembers it with the account", async () => {
    const onImport = vi.fn();
    const { container } = render(<UploadView accounts={[]} prefill={null} onImport={onImport} />);
    choose(container, "Date,Description,Debit,Transaction ID\n2026-09-20,Bakery,4.50,T-1\n", "new.csv");
    expect((await screen.findByLabelText("Transaction ID (optional)")).value).toBe("Transaction ID");
    fireEvent.click(screen.getByRole("button", { name: "Check 1 rows" }));
    fireEvent.click(screen.getByRole("button", { name: /^Import 1 transaction into new$/ }));
    expect(onImport.mock.calls[0][0].idCol).toBe("Transaction ID");
    expect(onImport.mock.calls[0][1][0].externalId).toBe("T-1");
  });
  it("lists what's already in Coinrose, skips it, and lets you import any anyway", async () => {
    const onImport = vi.fn();
    const sortDuplicates = (incoming) => ({ imported: incoming.slice(1), skipped: [{ transaction: incoming[0], duplicateOf: "t1", by: "details" }], alreadySkipped: 1 });
    const { container } = render(<UploadView accounts={F.accounts} prefill={null} onImport={onImport} sortDuplicates={sortDuplicates} />);
    choose(container, "Date,Description,Money Out,Money In\n2026-09-02,Thrifty Sprout Market,180,\n2026-09-22,New Place,5,\n", "export.csv");
    fireEvent.click(await screen.findByRole("button", { name: "Check 2 rows" }));
    expect(document.body.textContent).toMatch(/1 already in Coinrose, so it will be skipped/);
    expect(document.body.textContent).toMatch(/matched by account, date, amount, and description/);
    expect(document.body.textContent).toMatch(/1 more was already skipped in an earlier import/);
    expect(screen.getByRole("button", { name: /^Import 1 transaction into/ })).toBeTruthy();
    const stat = (label) => [...document.querySelectorAll(".summary-stat")].find((el) => el.textContent.endsWith(label)).textContent;
    expect(stat("Ready to import")).toBe("1Ready to import");
    expect(stat("Already in Coinrose")).toBe("2Already in Coinrose"); // 1 found now + 1 skipped in an earlier import
    fireEvent.click(screen.getByLabelText(/Import anyway: Thrifty Sprout Market/));
    expect(stat("Ready to import")).toBe("2Ready to import");
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 transactions into/ }));
    const plan = onImport.mock.calls[0][2];
    expect(plan.imported.map((t) => t.description)).toEqual(["New Place", "Thrifty Sprout Market"]);
    expect(plan.skipped).toEqual([]);
  });
  it("when duplicates aren't skipped, it says where to change that", async () => {
    const { container } = render(<UploadView accounts={F.accounts} prefill={null} onImport={vi.fn()} duplicateHandling="flag" />);
    choose(container, "Date,Description,Money Out,Money In\n2026-09-22,New Place,5,\n", "export.csv");
    fireEvent.click(await screen.findByRole("button", { name: "Check 1 rows" }));
    expect(document.body.textContent).toMatch(/Duplicates aren't skipped automatically \(see Settings → Importing\)/);
  });
});

describe("Upload: how duplicates were matched is described accurately", () => {
  const review = async (skippedBy) => {
    const sortDuplicates = (incoming) => ({ imported: [], skipped: incoming.map((t, i) => ({ transaction: t, duplicateOf: "t1", by: skippedBy[i] })), alreadySkipped: 0 });
    const { container } = render(<UploadView accounts={F.accounts} prefill={null} onImport={vi.fn()} sortDuplicates={sortDuplicates} />);
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["Date,Description,Money Out,Money In\n2026-09-02,A,1,\n2026-09-03,B,2,\n"], "export.csv")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Check 2 rows" }));
    return container.querySelector(".duplicate-review").textContent;
  };
  it("all by ID, all by details, or a mix", async () => {
    expect(await review(["id", "id"])).toMatch(/\(matched by the bank's transaction IDs\)/);
    cleanup();
    expect(await review(["details", "details"])).toMatch(/\(matched by account, date, amount, and description\)/);
    cleanup();
    expect(await review(["id", "details"])).toMatch(/or by account, date, amount, and description where there's no ID to compare/);
  });
});

import { SplitEditor } from "../components/SplitEditor.jsx";
import { TransactionsView, ROW_LIMIT } from "../views/TransactionsView.jsx";
describe("the split editor", () => {
  const t = { id: "t2", description: "Noodle & Newt", amountOut: 180, amountIn: null, categoryId: "cat-dine" };
  const open = (props = {}) => {
    const onSave = vi.fn(), onCancel = vi.fn();
    render(<SplitEditor t={t} categories={F.categories} onSave={onSave} onCancel={onCancel} {...props} />);
    return { onSave, onCancel };
  };
  const status = () => document.querySelector(".split-status").textContent;
  it("starts with the current category, shows what's unassigned, and saves only when it adds up", () => {
    const { onSave } = open();
    expect(screen.getByLabelText("Category for part 1").value).toBe("cat-dine");
    fireEvent.change(screen.getByLabelText("Amount for part 1"), { target: { value: "120" } });
    expect(status()).toBe("Assigned $120.00 of $180.00 · $60.00 unassigned");
    const save = screen.getByRole("button", { name: "Save split" });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Category for part 2"), { target: { value: "cat-groc" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Put the rest here" })[1]);
    expect(screen.getByLabelText("Amount for part 2").value).toBe("60.00");
    expect(status()).toBe("Fully assigned: $180.00");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith([{ categoryId: "cat-dine", amount: 120 }, { categoryId: "cat-groc", amount: 60 }]);
  });
  it("quick splits divide evenly, and more than the total is called out", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "⅓ each" }));
    expect([1, 2, 3].map((i) => screen.getByLabelText(`Amount for part ${i}`).value)).toEqual(["60.00", "60.00", "60.00"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove part 3" }));
    expect(status()).toMatch(/\$60\.00 unassigned/);
    fireEvent.change(screen.getByLabelText("Amount for part 1"), { target: { value: "150" } });
    expect(status()).toBe("Assigned $210.00: $30.00 more than the transaction");
    fireEvent.click(screen.getByRole("button", { name: "¼ each" }));
    expect(screen.getByLabelText("Amount for part 4").value).toBe("45.00");
    fireEvent.click(screen.getByRole("button", { name: "½ each" }));
    expect(screen.queryByLabelText("Amount for part 3")).toBeNull();
  });
  it("by percentage: amounts follow the percentages, and 'the rest' fills to 100%", () => {
    const { onSave } = open();
    fireEvent.click(screen.getByLabelText("By percentage"));
    fireEvent.change(screen.getByLabelText("Percent for part 1"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Category for part 2"), { target: { value: "cat-groc" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Put the rest here" })[1]);
    expect(screen.getByLabelText("Percent for part 2").value).toBe("75");
    expect(status()).toBe("Fully assigned: $180.00");
    fireEvent.click(screen.getByRole("button", { name: "Save split" }));
    expect(onSave).toHaveBeenCalledWith([{ categoryId: "cat-dine", amount: 45 }, { categoryId: "cat-groc", amount: 135 }]);
    fireEvent.click(screen.getByLabelText("By percentage")); // back to amounts, keeping them
    expect(screen.getByLabelText("Amount for part 2").value).toBe("135.00");
  });
  it("an existing split can be edited or removed, and Cancel closes without saving", () => {
    const { onSave, onCancel } = open({ t: { ...t, categoryId: null, splits: [{ categoryId: "cat-dine", amount: 100 }, { categoryId: "cat-groc", amount: 80 }] } });
    expect(screen.getByLabelText("Amount for part 2").value).toBe("80.00");
    fireEvent.click(screen.getByRole("button", { name: "+ Add a line" }));
    expect(screen.getByLabelText("Category for part 3").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Remove split" }));
    expect(onSave).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("Transactions: splits, searching all time, and the row limit", () => {
  const view = (transactions, extra = {}) =>
    render(<TransactionsView transactions={transactions} accounts={F.accounts} categories={F.categories} duplicateInfo={{ dupIds: new Set(), groupByKey: {}, keyByTxId: {} }}
      onUpdate={vi.fn()} onDelete={vi.fn()} onGoUpload={vi.fn()} {...extra} />);
  const rows = () => [...document.querySelectorAll("tr.tx-row-full")];
  it("Split opens the editor; a split shows its pieces, counts as categorized, and matches its categories' filters", () => {
    const onSetSplits = vi.fn();
    const list = F.transactions.map((t) => (t.id === "t7" ? { ...t, splits: [{ categoryId: "cat-groc", amount: 20 }, { categoryId: "cat-dine", amount: 15.5 }] } : t));
    view(list, { onSetSplits });
    const splitRow = rows().find((r) => r.textContent.includes("Split: Groceries $20.00, Dining Out $15.50"));
    expect(splitRow).toBeTruthy();
    expect(screen.getByLabelText(/Uncategorized only \(1\)/)).toBeTruthy(); // t8 only
    fireEvent.change(screen.getByDisplayValue("All categories"), { target: { value: "cat-dine" } });
    expect(rows().map((r) => r.textContent.match(/Noodle|Thrifty/)[0]).sort()).toEqual(["Noodle", "Thrifty"]);
    fireEvent.click(within(splitRow).getByRole("button", { name: "Edit split" }));
    expect(screen.getByRole("group", { name: /Split Thrifty Sprout Market among categories/ })).toBeTruthy();
    const plain = rows().find((r) => r.textContent.includes("Noodle"));
    fireEvent.click(within(plain).getByRole("button", { name: "Split Noodle & Newt among categories" }));
    expect(screen.getAllByRole("button", { name: "Save split" })).toHaveLength(2);
  });
  it("searching looks across all months, and says so", () => {
    view(F.transactions);
    fireEvent.change(screen.getByPlaceholderText("Search transactions…"), { target: { value: "Thrifty" } });
    expect(rows()).toHaveLength(4); // September's 2 and August's 2
    expect(document.body.textContent).toMatch(/Showing matches from all time/);
  });
  it("shows a page of rows at a time (200 in the app), with 'Show more'", () => {
    expect(ROW_LIMIT).toBe(200);
    // A small page keeps this test quick; the logic is the same at 200.
    const many = Array.from({ length: 23 }, (_, i) => ({ ...F.transactions[0], id: `m${i}`, date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }));
    view(many, { pageSize: 10 });
    expect(rows()).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more (13 not shown yet)" }));
    expect(rows()).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more (3 not shown yet)" }));
    expect(rows()).toHaveLength(23);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  });
});

import { InsightsView } from "../views/InsightsView.jsx";
describe("Insights page", () => {
  const rec = (over) => ({ key: "out|music", name: "Whisperwire", direction: "out", cadence: "monthly", cadenceLabel: "Every month", fixed: true,
    typicalAmount: 12.99, monthlyCost: 12.99, lastDate: "2026-09-03", nextDate: "2026-10-03", count: 4, categoryId: "cat-dine", accountName: "Griffon Card", priceChange: null, ...over });
  it("shows insights, recurring bills with totals, and income, and says it changes nothing", () => {
    const onHide = vi.fn();
    render(<InsightsView today="2026-09-25" categories={F.categories} onHideRecurring={onHide} onShowRecurring={vi.fn()}
      insights={[{ id: "pace", title: "This month so far", body: "You've spent $10.00.", tone: "watch" }]}
      recurring={[rec({ priceChange: { from: 10.99, to: 12.99 } }), rec({ key: "out|water", name: "Riverbend Water", fixed: false, typicalAmount: 46.22, monthlyCost: 46.22, nextDate: "2026-09-12" }),
        rec({ key: "in|pay", name: "Thornwick Payroll", direction: "in", cadenceLabel: "Every 2 weeks", typicalAmount: 2184.62, monthlyCost: 4749.99 })]} />);
    expect(document.body.textContent).toMatch(/Nothing here changes your data/);
    expect(screen.getByRole("heading", { name: "This month so far" }).closest("li").className).toMatch(/insight-watch/);
    expect(document.body.textContent).toMatch(/2 found, about \$59\.21 a month in total/);
    const bills = screen.getByRole("table", { name: "Recurring bills and subscriptions" });
    expect(within(bills).getByText("Price went up")).toBeTruthy();
    expect(within(bills).getByText("Was expected Sep 12, 2026")).toBeTruthy(); // a date already past
    expect(within(bills).getByText(/about/)).toBeTruthy(); // varying amounts say "about"
    expect(screen.getByRole("table", { name: "Recurring income" }).textContent).toMatch(/Thornwick Payroll/);
    fireEvent.click(screen.getByRole("button", { name: "Not recurring: hide Riverbend Water from these lists" }));
    expect(onHide).toHaveBeenCalledWith("out|water");
  });
  it("explains what's needed when there isn't enough yet, and lists hidden items to show again", () => {
    const onShow = vi.fn();
    render(<InsightsView today="2026-09-25" categories={F.categories} insights={[]} recurring={[rec()]} hiddenRecurring={["out|music"]} onHideRecurring={vi.fn()} onShowRecurring={onShow} />);
    expect(document.body.textContent).toMatch(/Insights appear once there's about a month of transactions/);
    expect(document.body.textContent).toMatch(/None found yet\. Coinrose needs at least three charges/);
    fireEvent.click(screen.getByRole("button", { name: /Marked not recurring \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show Whisperwire again" }));
    expect(onShow).toHaveBeenCalledWith("out|music");
  });
});

import { CommentThread, authorLabel } from "../components/CommentThread.jsx";
describe("comments on a transaction", () => {
  const members = [{ user_id: "me", email: "morgan@example.com" }, { user_id: "sam", email: "sam@example.com" }];
  const t = { id: "t1", description: "Hollow Oak Hardware", comments: [
    { id: "c1", text: "Paint for the porch.", authorId: "sam", at: "2026-09-14T19:12:00.000Z" },
    { id: "c2", text: "Keep the receipt?", authorId: "me", at: "2026-09-14T20:03:00.000Z" },
    { id: "c3", text: "Old note", authorId: "gone", at: "2026-09-10T08:00:00.000Z" },
  ] };
  it("shows who wrote each one: you, a member by email, or a former member", () => {
    expect(authorLabel("me", "me", members)).toBe("You");
    expect(authorLabel("sam", "me", members)).toBe("sam@example.com");
    expect(authorLabel("gone", "me", members)).toBe("Former member");
    expect(authorLabel(undefined, "me", members)).toBe("Former member");
    render(<CommentThread t={t} currentUserId="me" members={members} onAdd={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
    const text = document.querySelector(".comment-list").textContent;
    expect(text).toMatch(/sam@example\.com.*Paint for the porch\..*You.*Keep the receipt\?.*Former member.*Old note/);
  });
  it("only your own comments can be deleted", () => {
    const onDelete = vi.fn();
    render(<CommentThread t={t} currentUserId="me" members={members} onAdd={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />);
    const deletes = screen.getAllByRole("button", { name: /^Delete your comment/ });
    expect(deletes).toHaveLength(1);
    fireEvent.click(deletes[0]);
    expect(onDelete).toHaveBeenCalledWith("t1", "c2");
  });
  it("posts with the button or Ctrl+Enter, trimmed, and never posts an empty comment", () => {
    const onAdd = vi.fn(), onClose = vi.fn();
    render(<CommentThread t={{ id: "t9", description: "Diner" }} currentUserId="me" members={members} onAdd={onAdd} onDelete={vi.fn()} onClose={onClose} />);
    expect(document.body.textContent).toMatch(/No comments yet\. Comments are shared with everyone in your household\./);
    const box = screen.getByLabelText("Add a comment");
    expect(screen.getByRole("button", { name: "Post comment" }).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Post comment" }).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  Is this the vet bill?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(onAdd).toHaveBeenCalledWith("t9", "Is this the vet bill?");
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "Second" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onAdd).toHaveBeenLastCalledWith("t9", "Second");
    fireEvent.change(box, { target: { value: "x".repeat(950) } });
    expect(document.body.textContent).toMatch(/50 characters left/);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Transactions: comments", () => {
  it("each row has a comment button with the count, and search finds comment text", () => {
    const list = F.transactions.map((t) => (t.id === "t2" ? { ...t, comments: [{ id: "c", text: "Birthday dinner", authorId: "me", at: "2026-09-05T20:00:00Z" }] } : t));
    render(<TransactionsView transactions={list} accounts={F.accounts} categories={F.categories} duplicateInfo={{ dupIds: new Set(), groupByKey: {}, keyByTxId: {} }}
      onUpdate={vi.fn()} onDelete={vi.fn()} onGoUpload={vi.fn()} comments={{ currentUserId: "me", members: [], onAdd: vi.fn(), onDelete: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "1 comment on Noodle & Newt" }));
    expect(screen.getByRole("group", { name: "Comments on Noodle & Newt" }).textContent).toMatch(/You.*Birthday dinner/);
    expect(screen.getByRole("button", { name: "Comment on Mystery Merchant" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search transactions…"), { target: { value: "birthday" } });
    expect([...document.querySelectorAll("tr.tx-row-full")].map((r) => r.textContent.includes("Noodle"))).toEqual([true]);
  });
});

describe("Insights: dates in order, and the full list behind a card", () => {
  const rec = (key, name, nextDate, extra = {}) => ({ key, name, direction: "out", cadence: "monthly", cadenceLabel: "Every month", fixed: true,
    typicalAmount: 20, monthlyCost: 20, lastDate: "2026-09-01", nextDate, count: 3, categoryId: null, accountName: "Card", priceChange: null, ...extra });
  it("recurring bills and income are listed soonest first, with anything overdue at the top", () => {
    render(<InsightsView today="2026-09-25" categories={F.categories} insights={[]} onHideRecurring={vi.fn()} onShowRecurring={vi.fn()}
      recurring={[rec("out|b", "Big bill", "2026-10-20", { monthlyCost: 900 }), rec("out|s", "Soon", "2026-09-28"), rec("out|o", "Overdue", "2026-09-12"), rec("out|m", "Middle", "2026-10-03"),
        rec("in|p2", "Pay later", "2026-10-09", { direction: "in" }), rec("in|p1", "Pay soon", "2026-09-30", { direction: "in" })]} />);
    const names = (table) => within(screen.getByRole("table", { name: table })).getAllByRole("rowheader").map((th) => th.textContent.split(/Card|Price/)[0]);
    expect(names("Recurring bills and subscriptions")).toEqual(["Overdue", "Soon", "Middle", "Big bill"]);
    expect(names("Recurring income")).toEqual(["Pay soon", "Pay later"]);
  });
  it("a card with more behind it opens to show everything", () => {
    const details = { label: "See all 3 bills", items: [
      { key: "a", name: "Whisperwire", date: "2026-09-30", amount: 10.99 },
      { key: "b", name: "Rent", date: "2026-10-01", amount: 1450 },
      { key: "c", name: "Water", date: "2026-10-06", amount: 46.2, approximate: true },
    ] };
    render(<InsightsView today="2026-09-28" categories={F.categories} recurring={[]} onHideRecurring={vi.fn()} onShowRecurring={vi.fn()}
      insights={[{ id: "upcoming", title: "3 bills expected in the next 2 weeks", body: "About $1,507.19 in total.", tone: "info", details }]} />);
    const toggle = screen.getByText("See all 3 bills");
    const box = toggle.closest("details");
    expect(box.open).toBe(false);
    fireEvent.click(toggle);
    expect(box.open).toBe(true);
    expect([...box.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "WhisperwireSep 30, 2026$10.99", "RentOct 1, 2026$1,450.00", "WaterOct 6, 2026about $46.20",
    ]);
  });
});

describe("Accounts: estimated balances", () => {
  const open = (accounts, onSetStartingBalance = vi.fn()) =>
    render(<AccountsView accounts={accounts} transactions={F.transactions} onDelete={vi.fn()} onAddTransactions={vi.fn()} onRename={vi.fn()}
      onUpdateSettings={vi.fn()} onGoUpload={vi.fn()} onSetStartingBalance={onSetStartingBalance} />);
  it("always explains that balances are estimates, not a bank connection", () => {
    open(F.accounts);
    expect(document.body.textContent).toMatch(/Balances are estimates\. Coinrose isn't connected to your bank\./);
    expect(document.body.textContent).toMatch(/pending transactions, fees, or statements you haven't uploaded yet/);
  });
  it("tracking a balance: a starting amount as of a day, saved only when both are valid", () => {
    const onSet = vi.fn();
    open(F.accounts, onSet);
    fireEvent.click(screen.getByRole("button", { name: "Track the balance of Griffon Card" }));
    const editor = screen.getByRole("group", { name: "Starting balance for Griffon Card" });
    expect(within(editor).getByText(/It's an estimate: Coinrose isn't connected to\s+your bank/)).toBeTruthy();
    const save = within(editor).getByRole("button", { name: "Save starting balance" });
    fireEvent.change(within(editor).getByLabelText("Balance"), { target: { value: "" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(editor).getByLabelText("Balance"), { target: { value: "750.555" } });
    fireEvent.change(within(editor).getByLabelText("At the end of"), { target: { value: "2026-09-01" } });
    fireEvent.click(within(editor).getByLabelText(/This is a credit card or loan/));
    expect(within(editor).getByLabelText("Amount owed")).toBeTruthy();
    fireEvent.click(save);
    expect(onSet).toHaveBeenCalledWith("acct-card", { amount: 750.56, date: "2026-09-01", owed: true });
  });
  it("shows the estimate, how it was worked out, the total, and can stop tracking", () => {
    const onSet = vi.fn();
    open(F.accounts.map((a) => (a.id === "acct-chk" ? { ...a, startingBalance: { amount: 1000, date: "2026-09-01", owed: false } } : a)), onSet);
    const est = estimateNumbers();
    expect(est).toMatch(/Estimated balance/);
    expect(est).toMatch(/From \$1,000\.00 on Sep 1, 2026, plus \d+ transactions? since \(newest uploaded: Sep \d+, 2026\)\./);
    expect(screen.getByText("In accounts (estimated)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change the starting balance for Millbrook Checking" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    expect(onSet).toHaveBeenCalledWith("acct-chk", null);
  });
  const estimateNumbers = () => document.querySelector(".balance-row").textContent;
});

describe("Backup: complete backups", () => {
  const complete = { accounts: F.accounts, transactions: F.transactions, categories: F.categories, budgetGroups: F.budgetGroups, plannedIncome: 2700 };
  const open = (onRestoreComplete = vi.fn()) =>
    render(<BackupView accounts={F.accounts} transactions={F.transactions} categories={F.categories} budgetGroups={F.budgetGroups} plannedIncome={2700}
      onRestore={vi.fn()} onRestoreBudget={vi.fn()} completeLedger={complete} onRestoreComplete={onRestoreComplete} />);
  const pick = (text, name = "coinrose-backup.json") =>
    fireEvent.change(document.querySelector('input[type="file"][accept*="json"]'), { target: { files: [new File([text], name)] } });
  it("recommends the complete backup, and says what the spreadsheet copies leave out", () => {
    open();
    expect(screen.getByRole("heading", { name: "Complete backup (recommended)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download complete backup" }).disabled).toBe(false);
    expect(document.body.textContent).toMatch(/They don't include splits, transfer pairs, comments, bank\s+transaction IDs, starting balances/);
  });
  it("previews what a backup contains, then replaces everything only when confirmed", async () => {
    const onRestoreComplete = vi.fn();
    open(onRestoreComplete);
    const file = buildFullBackup({ ...complete, transactions: F.transactions.map((t, i) => (i === 0 ? { ...t, comments: [{ id: "c", text: "hi", authorId: "u", at: "2026-09-01T00:00:00Z" }] } : t)) }, "2026-09-20T08:00:00Z");
    pick(JSON.stringify(file));
    const preview = await screen.findByRole("region", { name: "Backup to restore" });
    expect(preview.textContent).toMatch(/This backup from Sep 20, 2026 contains: 10 transactions, 2 accounts, \d+ categories, 1 budget group, 1 comment\./);
    expect(onRestoreComplete).not.toHaveBeenCalled();
    fireEvent.click(within(preview).getByRole("button", { name: "Replace everything with this backup" }));
    expect(onRestoreComplete).toHaveBeenCalledTimes(1);
    expect(onRestoreComplete.mock.calls[0][0].transactions).toHaveLength(10);
  });
  it("explains a file that isn't a complete backup", async () => {
    open();
    pick("Date,Description\n1,2", "ledger.csv");
    expect((await screen.findByRole("alert")).textContent).toMatch(/isn't a Coinrose complete backup/);
  });
});
import { buildFullBackup } from "../lib/backup.js";

import { BalanceChart } from "../components/BalanceChart.jsx";
describe("balance over time", () => {
  const withBalances = F.accounts.map((a) => ({ ...a, startingBalance: a.id === "acct-card" ? { amount: 300, date: "2026-08-31", owed: true } : { amount: 1000, date: "2026-08-31", owed: false } }));
  const summary = () => document.querySelector(".balance-chart-summary").textContent;
  it("shows one account at a time, described in words, and can switch to all accounts combined", () => {
    render(<BalanceChart accounts={withBalances} transactions={F.transactions} />);
    const select = screen.getByLabelText("Show");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Millbrook Checking", "Griffon Card", "All tracked accounts combined"]);
    expect(summary()).toMatch(/^Balance: \$1,000\.00 on Aug 31, 2026, now \$[\d,.]+ as of Sep \d+, 2026 \((up|down) \$[\d,.]+\)\. Lowest .* highest .*\.$/);
    fireEvent.change(select, { target: { value: "acct-card" } });
    expect(summary()).toMatch(/^Amount owed: \$300\.00 on Aug 31, 2026.*For a card or loan, lower is better\.$/);
    fireEvent.change(select, { target: { value: "__all__" } });
    expect(summary()).toMatch(/^In accounts minus owed: \$700\.00 on Aug 31, 2026/);
  });
  it("with one tracked account there's no 'combined' choice; with none, no chart", () => {
    const { unmount } = render(<BalanceChart accounts={[withBalances[0], F.accounts[1]]} transactions={F.transactions} />);
    expect([...screen.getByLabelText("Show").options].map((o) => o.value)).toEqual(["acct-chk"]);
    unmount();
    const { container } = render(<BalanceChart accounts={F.accounts} transactions={F.transactions} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Overview: account balances", () => {
  it("lists each tracked account's estimate and the total, and links to the history", () => {
    const onNavigate = vi.fn();
    const accounts = F.accounts.map((a) => ({ ...a, startingBalance: { amount: a.id === "acct-card" ? 300 : 1000, date: "2026-08-31", owed: a.id === "acct-card" } }));
    render(<OverviewView transactions={F.transactions} categories={F.categories} budgetGroups={F.budgetGroups} onNavigate={onNavigate} accounts={accounts} />);
    const panel = screen.getByRole("heading", { name: "Account balances" }).closest(".panel");
    expect(panel.textContent).toMatch(/Estimated from your starting balances and uploads\./);
    expect(panel.textContent).toMatch(/Millbrook CheckingBalance as of Sep \d+, 2026\$/);
    expect(panel.textContent).toMatch(/Griffon CardOwed as of/);
    expect(panel.textContent).toMatch(/In accounts minus owed/);
    fireEvent.click(within(panel).getByRole("button", { name: "See balance history" }));
    expect(onNavigate).toHaveBeenCalledWith("accounts");
  });
  it("isn't shown until a balance is being tracked", () => {
    render(<OverviewView transactions={F.transactions} categories={F.categories} budgetGroups={F.budgetGroups} onNavigate={vi.fn()} accounts={F.accounts} />);
    expect(screen.queryByRole("heading", { name: "Account balances" })).toBeNull();
  });
});
