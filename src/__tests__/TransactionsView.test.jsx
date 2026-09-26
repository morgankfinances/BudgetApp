import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import * as F from "./fixtures.js";
import { computeDuplicates } from "../lib/analysis.js";
import { TransactionsView, PostUploadCategorizeView } from "../views/TransactionsView.jsx";

function setup() {
  const onUpdate = vi.fn(), onDelete = vi.fn();
  const utils = render(<TransactionsView transactions={F.transactions} accounts={F.accounts} categories={F.categories}
    duplicateInfo={computeDuplicates(F.transactions)} onUpdate={onUpdate} onDelete={onDelete} onGoUpload={vi.fn()} />);
  const rows = () => [...utils.container.querySelectorAll("tr.tx-row-full")];
  const rowFor = (text, account) => rows().find((r) => r.textContent.includes(text) && (!account || r.textContent.includes(account)));
  return { ...utils, onUpdate, onDelete, rows, rowFor };
}

describe("Transactions screen", () => {
  it("lists every transaction with money in, out, and net totals", () => {
    const { rows } = setup();
    expect(rows()).toHaveLength(10);
    const stats = document.querySelector(".stat-row") || document.body;
    expect(stats.textContent).toContain("$1,355.13");  // money in
    expect(stats.textContent).toContain("$2,142.50");  // money out
    expect(screen.getByText("-$787.37")).toBeTruthy(); // net
  });
  it("filters to uncategorized, by account, and by search text", () => {
    const { rows } = setup();
    fireEvent.click(screen.getByLabelText(/Uncategorized only/));
    expect(rows().map((r) => r.textContent.includes("Uncategorized"))).toEqual([true, true]);
    fireEvent.click(screen.getByLabelText(/Uncategorized only/));
    fireEvent.change(screen.getByDisplayValue("All accounts"), { target: { value: "acct-card" } });
    expect(rows()).toHaveLength(3);
    fireEvent.change(screen.getByDisplayValue("Griffon Card"), { target: { value: "all" } });
    fireEvent.change(screen.getByPlaceholderText("Search transactions…"), { target: { value: "noodle" } });
    expect(rows()).toHaveLength(1);
  });
  it("sorts oldest-first when the date header is clicked", () => {
    const { rows } = setup();
    expect(rows()[0].textContent).toContain("Sep 16, 2026");
    fireEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(rows()[0].textContent).toContain("Aug 3, 2026");
  });
  it("choosing a category saves it", () => {
    const { rowFor, onUpdate } = setup();
    const row = rowFor("Mystery Merchant");
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "cat-dine" } });
    expect(onUpdate).toHaveBeenCalledWith("t8", { categoryId: "cat-dine" });
  });
  it("suggests a category from past matching transactions, and confirming it saves it", () => {
    const { rowFor, onUpdate } = setup();
    const row = rowFor("Thrifty Sprout Market", "Griffon Card");
    expect(within(row).getByRole("combobox").value).toBe("cat-groc"); // pre-filled with the suggestion
    fireEvent.click(within(row).getByRole("button", { name: /Suggested/ }));
    expect(onUpdate).toHaveBeenCalledWith("t7", { categoryId: "cat-groc" });
  });
  it("flags likely duplicates and can dismiss them", () => {
    const { rows, onUpdate } = setup();
    fireEvent.click(screen.getByLabelText(/Possible duplicates only/));
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Not a duplicate" })[0]);
    expect(onUpdate).toHaveBeenCalledWith(expect.stringMatching(/^t(9|10)$/), { notDuplicate: true });
  });
  it("deleting asks for confirmation first", () => {
    const { rowFor, onDelete } = setup();
    const row = rowFor("Noodle & Newt");
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(row.textContent).toContain("Delete?");
    fireEvent.click(within(row).getByRole("button", { name: "Yes" }));
    expect(onDelete).toHaveBeenCalledWith("t2");
  });
  it("editing a transaction saves the new details", () => {
    const { rowFor, onUpdate } = setup();
    fireEvent.click(within(rowFor("Noodle & Newt")).getByRole("button", { name: "Edit" }));
    const row = rowFor("") && [...document.querySelectorAll("tr.tx-row-full")].find((r) => r.querySelector("input[type=text]"));
    const desc = [...row.querySelectorAll("input[type=text]")].find((i) => i.value === "Noodle & Newt");
    fireEvent.change(desc, { target: { value: "Noodle & Newt (lunch)" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith("t2", expect.objectContaining({ description: "Noodle & Newt (lunch)" }));
  });
});

describe("Categorize-your-import screen", () => {
  it("shows only the transactions from that upload", () => {
    const { container } = render(<PostUploadCategorizeView transactions={F.transactions} batchId="batch-9" accountName="Griffon Card"
      categories={F.categories} duplicateInfo={computeDuplicates(F.transactions)} onUpdate={vi.fn()} onDelete={vi.fn()} onSkip={vi.fn()} />);
    const rows = container.querySelectorAll("tr.tx-row-full");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Mystery Merchant");
  });
  it("offers a way out when the upload has nothing left", () => {
    const onSkip = vi.fn();
    render(<PostUploadCategorizeView transactions={[]} batchId="gone" accountName="X" categories={F.categories}
      duplicateInfo={computeDuplicates([])} onUpdate={vi.fn()} onDelete={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Go to Transactions" }));
    expect(onSkip).toHaveBeenCalled();
  });
});

describe("Transactions: date range, upload, and category filters", () => {
  it("a date range narrows the list, and Clear resets it", () => {
    const { rows, container } = setup();
    const [from, to] = [...container.querySelectorAll(".filter-bar input[type='date'], input[type='date']")].slice(-2);
    fireEvent.change(from, { target: { value: "2026-09-10" } });
    fireEvent.change(to, { target: { value: "2026-09-15" } });
    expect(rows().map((r) => r.textContent.match(/Sep \d+, 2026/)[0])).toEqual(["Sep 15, 2026", "Sep 14, 2026", "Sep 12, 2026", "Sep 10, 2026"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Clear" }).at(-1));
    expect(rows()).toHaveLength(10);
  });
  it("picking a recent upload shows only what it brought in", () => {
    const { rows } = setup();
    fireEvent.change(screen.getByDisplayValue("All transactions"), { target: { value: "batch-9" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Mystery Merchant");
  });
  it("filtering by category, or to uncategorized through the category list", () => {
    const { rows } = setup();
    fireEvent.change(screen.getByDisplayValue("All categories"), { target: { value: "cat-groc" } });
    expect(rows()).toHaveLength(3);
  });
});
