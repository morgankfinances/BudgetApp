// @vitest-environment node
// Runs in plain Node: the simulated browser's File lacks text()/arrayBuffer(),
// and Node's File has them (as real browsers do).
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readFileAsRows, mapRow, buildTransactions, keepMappedColumns } from "../importing.js";

describe("readFileAsRows", () => {
  it("reads a CSV statement's headers and rows, skipping blank lines", async () => {
    const csv = "Post Date,Description,Withdrawal,Deposit\n8/24/2026,Rent,1100.00,\n\n8/28/2026,Payroll,,1355.13\n";
    const { headers, rows } = await readFileAsRows(new File([csv], "Statement.CSV"));
    expect(headers).toEqual(["Post Date", "Description", "Withdrawal", "Deposit"]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ Description: "Payroll", Deposit: "1355.13" });
  });
  it("reads the first sheet of an Excel file", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Date", "Merchant", "Amount"], ["2026-09-04", "Noodle & Newt", 23.07]]), "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const { headers, rows } = await readFileAsRows(new File([buf], "card.xlsx"));
    expect(headers).toEqual(["Date", "Merchant", "Amount"]);
    expect(rows[0]).toMatchObject({ Merchant: "Noodle & Newt", Amount: 23.07 });
  });
  it("an empty spreadsheet has no headers", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    expect(await readFileAsRows(new File([buf], "empty.xlsx"))).toEqual({ headers: [], rows: [] });
  });
  it("rejects other file types", async () => {
    await expect(readFileAsRows(new File(["x"], "notes.pdf"))).rejects.toThrow(/Unsupported file type/);
  });
});

describe("mapRow", () => {
  const split = { dateCol: "Date", descriptionCol: "Desc", outCol: "Out", inCol: "In" };
  it("separate money-out and money-in columns", () => {
    expect(mapRow({ Date: "9/5/2026", Desc: "  Thrifty Sprout  ", Out: "24.23", In: "" }, split))
      .toEqual({ date: "2026-09-05", description: "Thrifty Sprout", amountOut: 24.23, amountIn: null, reasons: [] });
    expect(mapRow({ Date: "9/5/2026", Desc: "Pay", Out: "", In: "$1,355.13" }, split).amountIn).toBe(1355.13);
  });
  it("a negative number in the money-out column is still money out", () => {
    expect(mapRow({ Date: "2026-09-05", Out: "-24.23" }, split).amountOut).toBe(24.23);
  });
  it("zero amounts count as empty", () => {
    expect(mapRow({ Date: "2026-09-05", Out: "0", In: "0" }, split).reasons).toEqual(["no amount in either column"]);
  });
  const signed = { dateCol: "Date", descriptionCol: "Desc", outCol: "Amount", inCol: "Amount" };
  it("one signed column: negative is money out, positive is money in", () => {
    expect(mapRow({ Date: "2026-09-05", Amount: "-65.87" }, signed)).toMatchObject({ amountOut: 65.87, amountIn: null });
    expect(mapRow({ Date: "2026-09-05", Amount: "65.87" }, signed)).toMatchObject({ amountOut: null, amountIn: 65.87 });
  });
  it("'invert sign' flips that, for cards that show charges as positive", () => {
    const inv = { ...signed, invertSign: true };
    expect(mapRow({ Date: "2026-09-05", Amount: "15.21" }, inv)).toMatchObject({ amountOut: 15.21, amountIn: null });
    expect(mapRow({ Date: "2026-09-05", Amount: "-237.98" }, inv)).toMatchObject({ amountOut: null, amountIn: 237.98 });
  });
  it("explains exactly what's wrong with a bad row", () => {
    expect(mapRow({ Date: "someday", Amount: "abc" }, signed).reasons).toEqual(["unrecognized date", "unrecognized amount value"]);
    expect(mapRow({ Date: "2026-09-05", Out: "x", In: "y" }, split).reasons).toEqual(["unrecognized money-out value", "unrecognized money-in value"]);
    expect(mapRow({ Date: "2026-09-05", Amount: "" }, signed).reasons).toEqual(["no amount in either column"]);
  });
  it("works without a description column, or with a missing value", () => {
    expect(mapRow({ Date: "2026-09-05", Out: "1" }, { dateCol: "Date", outCol: "Out" }).description).toBe("");
    expect(mapRow({ Date: "2026-09-05", Out: "1" }, split).description).toBe("");
    expect(mapRow({ Out: "1" }, { outCol: "Out" }).reasons).toEqual(["unrecognized date"]);
  });
});

describe("buildTransactions", () => {
  const mapping = { dateCol: "Date", descriptionCol: "Desc", outCol: "Out", inCol: "In" };
  const rows = [
    { Date: "9/5/2026", Desc: "Grocer", Out: "24.23", In: "" },
    { Date: "nope", Desc: "Broken", Out: "5", In: "" },
    { Date: "9/6/2026", Desc: "Refund", Out: "", In: "10" },
  ];
  const { valid, invalid } = buildTransactions(rows, mapping, "acct-1", "Checking", "batch-7");
  it("turns good rows into uncategorized transactions tagged with the upload", () => {
    expect(valid).toHaveLength(2);
    expect(valid[0]).toMatchObject({ accountId: "acct-1", accountName: "Checking", date: "2026-09-05", description: "Grocer",
      amountOut: 24.23, amountIn: null, categoryId: null, uploadBatchId: "batch-7" });
    expect(valid[0].uploadedAt).toBe(valid[1].uploadedAt);
    expect(valid[0].id).not.toBe(valid[1].id);
  });
  it("sets aside bad rows with their position and reasons", () => {
    expect(invalid).toEqual([{ rowIndex: 1, raw: rows[1], reasons: ["unrecognized date"] }]);
  });
});

describe("keeping only mapped columns from the bank's file", () => {
  const bankRow = {
    "Post Date": "9/5/2026", Description: "Thrifty Sprout", Amount: "-24.23",
    "Account Number": "000123456789", "Card Number": "4111111111111111", Memo: "PIN purchase #8841", Balance: "1,204.55",
  };
  it("keeps the date, description, and amount columns and drops everything else", () => {
    const kept = keepMappedColumns(bankRow, { dateCol: "Post Date", descriptionCol: "Description", outCol: "Amount", inCol: "Amount" });
    expect(kept).toEqual({ "Post Date": "9/5/2026", Description: "Thrifty Sprout", Amount: "-24.23" });
  });
  it("keeps separate money-out and money-in columns, and skips unmapped or missing ones", () => {
    expect(keepMappedColumns({ D: "1", O: "5", I: "", X: "secret" }, { dateCol: "D", outCol: "O", inCol: "I", descriptionCol: "" }))
      .toEqual({ D: "1", O: "5", I: "" });
    expect(keepMappedColumns({ D: "1" }, { dateCol: "D", outCol: "Gone" })).toEqual({ D: "1" });
  });
  it("uploaded transactions never store the bank's other columns", () => {
    const { valid } = buildTransactions([bankRow], { dateCol: "Post Date", descriptionCol: "Description", outCol: "Amount", inCol: "Amount" }, "a", "Checking", "b");
    expect(Object.keys(valid[0].raw).sort()).toEqual(["Amount", "Description", "Post Date"]);
    expect(JSON.stringify(valid[0])).not.toMatch(/000123456789|4111111111111111|PIN purchase|1,204\.55/);
  });
  it("what's kept is still enough to re-apply the mapping later", () => {
    const mapping = { dateCol: "Post Date", descriptionCol: "Description", outCol: "Amount", inCol: "Amount" };
    const { valid } = buildTransactions([bankRow], mapping, "a", "Checking", "b");
    expect(mapRow(valid[0].raw, { ...mapping, invertSign: true })).toMatchObject({ date: "2026-09-05", amountOut: null, amountIn: 24.23 });
  });
});
