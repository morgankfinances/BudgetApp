import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import * as F from "./fixtures.js";
import { CategoriesView } from "../views/CategoriesView.jsx";

function setup() {
  const fns = { onAdd: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onToggleExcluded: vi.fn(), onToggleIsIncome: vi.fn(), onMerge: vi.fn() };
  render(<CategoriesView categories={F.categories} transactions={F.transactions} {...fns} />);
  const card = (name) => screen.getAllByText(name).map((el) => el.closest(".category-card")).find(Boolean);
  return { ...fns, card };
}

describe("Categories screen", () => {
  it("shows each category with its transaction count", () => {
    const { card } = setup();
    expect(card("Groceries").textContent).toContain("3 transactions");
    expect(card("Dining Out").textContent).toContain("1 transaction");
  });
  it("adds a category, ignoring blank names", () => {
    const { onAdd } = setup();
    const input = screen.getByPlaceholderText("New category name…");
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  Pets  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(onAdd).toHaveBeenCalledWith("Pets");
  });
  it("renames a category", () => {
    const { card, onRename } = setup();
    const rent = card("Rent");
    fireEvent.click(within(rent).getByRole("button", { name: "Rename" }));
    const input = within(rent).getByDisplayValue("Rent");
    fireEvent.change(input, { target: { value: "Housing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("cat-rent", "Housing");
  });
  it("toggles the excluded and income flags", () => {
    const { card, onToggleExcluded, onToggleIsIncome } = setup();
    const boxes = within(card("Rent")).getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(onToggleExcluded).toHaveBeenCalledWith("cat-rent", true);
    expect(onToggleIsIncome).toHaveBeenCalledWith("cat-rent", true);
  });
  it("merging asks for confirmation, saying how many transactions move", () => {
    const { card, onMerge } = setup();
    fireEvent.click(within(card("Dining Out")).getByRole("button", { name: "Merge into…" }));
    fireEvent.change(within(card("Dining Out")).getByRole("combobox"), { target: { value: "cat-groc" } });
    fireEvent.click(within(card("Dining Out")).getByRole("button", { name: "Merge" }));
    expect(card("Dining Out").textContent).toMatch(/Move 1 transaction into "Groceries"/);
    fireEvent.click(within(card("Dining Out")).getByRole("button", { name: "Confirm" }));
    expect(onMerge).toHaveBeenCalledWith("cat-dine", "cat-groc");
  });
  it("deleting warns what happens to its transactions, and to a fund's balance", () => {
    const { card, onDelete } = setup();
    fireEvent.click(within(card("Groceries")).getByRole("button", { name: "Delete" }));
    expect(card("Groceries").textContent).toMatch(/3 transactions will become uncategorized/);
    fireEvent.click(within(card("Groceries")).getByRole("button", { name: "Confirm" }));
    expect(onDelete).toHaveBeenCalledWith("cat-groc");
    fireEvent.click(within(card("Supplies Fund")).getByRole("button", { name: "Delete" }));
    expect(card("Supplies Fund").textContent).toMatch(/This fund currently shows \$510\.00/);
  });
});

describe("duplicate category names", () => {
  it("adding a name that already exists (in any capitalization) is refused with a message", () => {
    const { onAdd } = setup();
    fireEvent.change(screen.getByPlaceholderText("New category name…"), { target: { value: "  groceries " } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe('There\'s already a category called "Groceries".');
    fireEvent.change(screen.getByPlaceholderText("New category name…"), { target: { value: "Groceries 2" } });
    expect(screen.queryByRole("alert")).toBeNull(); // typing clears the message
  });
  it("renaming to another category's name is refused; changing only the capitalization is fine", () => {
    const { card, onRename } = setup();
    const rent = card("Rent");
    fireEvent.click(within(rent).getByRole("button", { name: "Rename" }));
    const input = within(rent).getByDisplayValue("Rent");
    fireEvent.change(input, { target: { value: "UTILITIES" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(within(rent).getByRole("alert").textContent).toMatch(/already a category called "Utilities"/);
    fireEvent.change(input, { target: { value: "RENT" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("cat-rent", "RENT");
  });
});
