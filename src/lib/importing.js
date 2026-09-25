import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseDateISO, parseMoney, uid } from "./utils.js";



export async function readFileAsRows(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    const headers = result.meta.fields || [];
    return { headers, rows: result.data };
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { headers, rows };
  }
  throw new Error("Unsupported file type. Please upload a .csv or .xlsx file.");
}


export function mapRow(row, mapping) {
  const dateRaw = mapping.dateCol ? row[mapping.dateCol] : null;
  const date = parseDateISO(dateRaw);
  const reasons = [];
  if (!date) reasons.push("unrecognized date");

  const description = mapping.descriptionCol
    ? String(row[mapping.descriptionCol] != null ? row[mapping.descriptionCol] : "").trim()
    : "";

  let amountOut = null;
  let amountIn = null;
  const sameCol = mapping.outCol && mapping.inCol && mapping.outCol === mapping.inCol;

  if (sameCol) {
    const raw = row[mapping.outCol];
    if (raw !== "" && raw != null) {
      const parsed = parseMoney(raw);
      if (parsed === null) reasons.push("unrecognized amount value");
      else if (parsed < 0) {
        if (mapping.invertSign) amountIn = Math.abs(parsed);
        else amountOut = Math.abs(parsed);
      } else if (parsed > 0) {
        if (mapping.invertSign) amountOut = parsed;
        else amountIn = parsed;
      }
    }
  } else {
    if (mapping.outCol) {
      const raw = row[mapping.outCol];
      if (raw !== "" && raw != null) {
        const parsed = parseMoney(raw);
        if (parsed === null) reasons.push("unrecognized money-out value");
        else if (parsed !== 0) amountOut = Math.abs(parsed);
      }
    }
    if (mapping.inCol) {
      const raw = row[mapping.inCol];
      if (raw !== "" && raw != null) {
        const parsed = parseMoney(raw);
        if (parsed === null) reasons.push("unrecognized money-in value");
        else if (parsed !== 0) amountIn = parsed;
      }
    }
  }

  if (amountOut == null && amountIn == null && reasons.length === 0) {
    reasons.push("no amount in either column");
  }

  return { date, description, amountOut, amountIn, reasons };
}


// The original row from the bank file is kept only for the columns this
// account's mapping uses (date, description, amounts). Everything else a
// bank puts in its export (account numbers, card numbers, memos, balances)
// is dropped before anything is saved.
export function keepMappedColumns(row, mapping) {
  const kept = {};
  for (const col of [mapping.dateCol, mapping.descriptionCol, mapping.outCol, mapping.inCol]) {
    if (col && Object.prototype.hasOwnProperty.call(row, col)) kept[col] = row[col];
  }
  return kept;
}

export function buildTransactions(rows, mapping, accountId, accountName, uploadBatchId) {
  const valid = [];
  const invalid = [];
  const uploadedAt = new Date().toISOString();

  rows.forEach((row, idx) => {
    const { date, description, amountOut, amountIn, reasons } = mapRow(row, mapping);

    if (reasons.length > 0) {
      invalid.push({ rowIndex: idx, raw: row, reasons });
    } else {
      valid.push({
        id: uid(),
        accountId,
        accountName,
        date,
        description,
        amountOut,
        amountIn,
        categoryId: null,
        raw: keepMappedColumns(row, mapping),
        uploadedAt,
        uploadBatchId,
      });
    }
  });

  return { valid, invalid };
}
