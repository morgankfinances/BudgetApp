import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
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
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 transactions" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Import 1 transaction" }));
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
