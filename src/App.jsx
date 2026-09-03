import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "ledger-data-v1";

const DEFAULT_CATEGORY_NAMES = [
  "Groceries",
  "Dining & Restaurants",
  "Transportation",
  "Bills & Utilities",
  "Shopping",
  "Entertainment",
  "Health",
  "Income",
  "Transfers",
];

function createDefaultCategories() {
  return DEFAULT_CATEGORY_NAMES.map((name) => ({ id: uid(), name, excluded: name === "Transfers" }));
}

async function loadData() {
  try {
    const res = await window.storage.get(STORAGE_KEY, false);
    if (res && res.value) {
      const parsed = JSON.parse(res.value);
      const categories = Array.isArray(parsed.categories) ? parsed.categories : createDefaultCategories();
      return {
        accounts: parsed.accounts || [],
        transactions: parsed.transactions || [],
        categories: categories.map((c) => ({ ...c, excluded: !!c.excluded })),
      };
    }
  } catch (e) {
    /* key doesn't exist yet on first run */
  }
  return { accounts: [], transactions: [], categories: createDefaultCategories() };
}

async function saveData(accounts, transactions, categories) {
  try {
    const result = await window.storage.set(
      STORAGE_KEY,
      JSON.stringify({ accounts, transactions, categories }),
      false
    );
    return !!result;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function guessHeader(headers, candidates) {
  const lower = headers.map((h) => String(h).toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

function parseDateISO(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = (+yr > 50 ? "19" : "20") + yr;
    const d = new Date(Date.UTC(+yr, +mo - 1, +da));
    if (!isNaN(d.getTime()) && d.getUTCMonth() === +mo - 1) {
      return d.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function parseMoney(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  let str = String(value).trim();
  if (!str) return null;
  let negative = false;
  if (/^\(.*\)$/.test(str)) {
    negative = true;
    str = str.slice(1, -1);
  }
  str = str.replace(/[$,\s]/g, "");
  if (str.startsWith("-")) {
    negative = true;
    str = str.slice(1);
  } else if (str.startsWith("+")) {
    str = str.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

function formatMoney(n) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateDisplay(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getWeekStartISO(dateISO) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
  return dt.toISOString().slice(0, 10);
}

function getMonthStartISO(dateISO) {
  const [y, m] = dateISO.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function formatWeekLabel(weekStartISO) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatMonthLabel(monthStartISO) {
  const [y, m] = monthStartISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const CHART_PALETTE = ["#3B5BA0", "#3F7D5C", "#AC4A2C", "#8A5A15", "#6B5B95", "#2E8B8B", "#9C4F6E"];

async function readFileAsRows(file) {
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

function mapRow(row, mapping) {
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

function buildTransactions(rows, mapping, accountId, accountName) {
  const valid = [];
  const invalid = [];

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
        raw: row,
      });
    }
  });

  return { valid, invalid };
}

function computeDuplicates(transactions) {
  const map = {};
  transactions.forEach((t) => {
    const amt = t.amountOut != null ? t.amountOut : t.amountIn;
    if (amt == null || !t.date) return;
    const direction = t.amountOut != null ? "out" : "in";
    const key = `${t.date}|${Math.abs(amt).toFixed(2)}|${direction}`;
    if (!map[key]) map[key] = [];
    map[key].push(t.id);
  });
  const dupIds = new Set();
  const groupByKey = {};
  const keyByTxId = {};
  Object.entries(map).forEach(([key, ids]) => {
    if (ids.length > 1) {
      ids.forEach((id) => {
        dupIds.add(id);
        keyByTxId[id] = key;
      });
      groupByKey[key] = ids;
    }
  });
  return { dupIds, groupByKey, keyByTxId };
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600;700&display=swap');

.ledger-root {
  --bg: #F5F6F1;
  --panel: #FFFFFF;
  --ink: #1E241F;
  --ink-muted: #62685E;
  --border: #DAD9CC;
  --accent: #3B5BA0;
  --accent-hover: #2E4880;
  --income: #3F7D5C;
  --expense: #AC4A2C;
  --warn-bg: #FBF1DA;
  --warn-border: #E3B558;
  --warn-ink: #8A5A15;
  --danger: #A6392B;
  --radius: 6px;
  font-family: 'Work Sans', -apple-system, sans-serif;
  color: var(--ink);
  background: var(--bg);
  min-height: 100vh;
  font-variant-numeric: tabular-nums;
}

.ledger-root * { box-sizing: border-box; }

.ledger-root h1, .ledger-root h2, .ledger-root h3 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  margin: 0;
  letter-spacing: -0.01em;
}

.app-shell {
  display: grid;
  grid-template-columns: 216px 1fr;
  min-height: 100vh;
}

.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.sidebar-brand {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 19px;
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.sidebar-brand-mark {
  width: 9px; height: 9px;
  background: var(--accent);
  border-radius: 2px;
  display: inline-block;
  margin-right: 2px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius);
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.nav-btn:hover { background: #F0EFE8; color: var(--ink); }
.nav-btn.active { background: #EBEEF7; color: var(--accent); font-weight: 600; }

.sidebar-stats {
  margin-top: auto;
  border-top: 1px solid var(--border);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-muted);
}

.sidebar-stats .stat-row { display: flex; justify-content: space-between; }
.sidebar-stats .stat-net { color: var(--ink); font-weight: 600; font-size: 14px; }

.main {
  padding: 28px 36px 60px;
  max-width: 980px;
  width: 100%;
}

.view-header {
  margin-bottom: 22px;
}

.view-header h1 { font-size: 24px; }
.view-header p { color: var(--ink-muted); margin: 6px 0 0; font-size: 14.5px; max-width: 60ch; }

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}

.panel + .panel { margin-top: 16px; }

.btn {
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

.btn-secondary { background: transparent; border-color: var(--border); color: var(--ink); }
.btn-secondary:hover:not(:disabled) { border-color: var(--ink-muted); }

.btn-danger { background: transparent; border-color: var(--danger); color: var(--danger); }
.btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }

.btn-ghost { background: transparent; border: none; color: var(--ink-muted); padding: 6px 8px; }
.btn-ghost:hover { color: var(--ink); }

.btn-sm { padding: 5px 10px; font-size: 12.5px; }

.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink); }
.field .hint { font-size: 12px; color: var(--ink-muted); margin-top: 1px; }

.field input[type="text"],
.field input[type="date"],
.field input[type="number"],
.field select {
  font-family: inherit;
  font-size: 14px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  color: var(--ink);
}
.field input:focus, .field select:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.form-grid .field.span-2 { grid-column: 1 / -1; }

.radio-row { display: flex; gap: 16px; margin-bottom: 16px; }
.radio-option { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }

.invert-note {
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 14px;
}
.invert-note .hint { color: var(--warn-ink); margin: 0; }
.invert-note .radio-option { color: var(--ink); }

.dropzone {
  border: 1.5px dashed var(--border);
  border-radius: var(--radius);
  padding: 34px 20px;
  text-align: center;
  color: var(--ink-muted);
  font-size: 14px;
  background: #FBFBF8;
}
.dropzone strong { color: var(--ink); }

.file-input-label {
  display: inline-block;
  margin-top: 12px;
}
.file-input-label input { display: none; }

.error-banner {
  background: #FBEAE6;
  border: 1px solid #E3A190;
  color: var(--danger);
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13.5px;
  margin-bottom: 14px;
}

.preview-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); margin-top: 6px; }
.preview-table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.preview-table th, .preview-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  text-align: left;
}
.preview-table th { background: #FAFAF6; color: var(--ink-muted); font-weight: 600; }

.summary-row { display: flex; gap: 22px; flex-wrap: wrap; margin-bottom: 18px; }
.summary-stat .num { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 500; }
.summary-stat .label { font-size: 12px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; }

.invalid-list { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); }
.invalid-row { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12.5px; display: flex; justify-content: space-between; gap: 10px; }
.invalid-row:last-child { border-bottom: none; }
.invalid-row .reason { color: var(--danger); }

.actions-row { display: flex; gap: 10px; margin-top: 18px; }

.filter-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.filter-bar select, .filter-bar input[type="text"] {
  font-family: inherit; font-size: 13.5px; padding: 7px 9px;
  border: 1px solid var(--border); border-radius: var(--radius); background: #fff;
}
.filter-bar .checkbox-filter { display: flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--ink-muted); }

.tx-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.tx-table th {
  text-align: left; padding: 8px 10px; font-size: 11.5px; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ink-muted); border-bottom: 1px solid var(--border); font-weight: 600;
}
.th-sort-btn {
  font-family: inherit; font-size: 11.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ink-muted); background: none; border: none; padding: 0;
  cursor: pointer;
}
.th-sort-btn:hover { color: var(--ink); }
.tx-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.tx-table tr:last-child td { border-bottom: none; }
.tx-table select {
  font-family: inherit;
  font-size: 12.5px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  color: var(--ink);
  max-width: 150px;
}
.tx-table td.desc-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx-table .muted-cell { color: var(--ink-muted); }
.money-in { color: var(--income); font-weight: 600; }
.money-out { color: var(--expense); font-weight: 600; }

.toggle-group { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.toggle-btn {
  padding: 7px 16px; font-family: inherit; font-size: 13px; font-weight: 600;
  border: none; background: #fff; color: var(--ink-muted); cursor: pointer;
}
.toggle-btn.active { background: var(--accent); color: #fff; }
.toggle-btn + .toggle-btn { border-left: 1px solid var(--border); }

.chart-card { padding: 18px 20px 8px; }
.chart-wrap { width: 100%; height: 280px; margin-top: 6px; }

.pivot-table { border-collapse: collapse; font-size: 13px; white-space: nowrap; width: 100%; }
.pivot-table th, .pivot-table td { padding: 8px 14px; text-align: right; border-bottom: 1px solid var(--border); }
.pivot-table th:first-child, .pivot-table td:first-child {
  text-align: left; position: sticky; left: 0; background: var(--panel); z-index: 1;
}
.pivot-table thead th {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--ink-muted); font-weight: 600; border-bottom: 2px solid var(--border);
}
.pivot-table tfoot td { border-top: 2px solid var(--border); border-bottom: none; background: #FAFAF6; font-weight: 700; }
.pivot-table tbody tr:last-child td { border-bottom: none; }
.pivot-row-label { font-weight: 500; }
.pivot-total-col { font-weight: 600; }

.excluded-note {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 12.5px; color: var(--ink-muted); margin-top: 12px; padding: 10px 14px;
  border: 1px solid var(--border); border-radius: var(--radius); background: #FAFAF6;
}

.badge {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
  padding: 2px 7px; border-radius: 999px; border: 1px solid var(--warn-border);
  background: var(--warn-bg); color: var(--warn-ink); cursor: pointer;
}

.dup-detail-row td { background: #FBF8EF; padding: 10px 14px; }
.dup-detail-title { font-size: 12px; font-weight: 600; color: var(--warn-ink); margin-bottom: 6px; }
.dup-detail-item { font-size: 12.5px; color: var(--ink-muted); padding: 3px 0; }

.row-actions { display: flex; gap: 6px; }
.row-actions input[type="text"] {
  font-family: inherit;
  font-size: 14px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.confirm-inline { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--danger); }

.empty-state {
  text-align: center; padding: 50px 20px; color: var(--ink-muted);
}
.empty-state h2 { color: var(--ink); font-size: 19px; margin-bottom: 8px; }
.empty-state p { max-width: 42ch; margin: 0 auto 18px; font-size: 14px; }

.toast {
  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
  background: var(--ink); color: #fff; padding: 10px 18px; border-radius: var(--radius);
  font-size: 13.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); z-index: 40;
}

.account-card {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 4px; border-bottom: 1px solid var(--border);
}
.account-card:last-child { border-bottom: none; }
.account-card .name { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.account-card .meta { font-size: 12.5px; color: var(--ink-muted); margin-top: 2px; }
.account-card .figures { text-align: right; margin-right: 18px; }
.account-card .figures .net { font-family: 'Fraunces', serif; font-size: 17px; }

.account-card-wrap { border-bottom: 1px solid var(--border); }
.account-card-wrap:last-child { border-bottom: none; }
.account-card-wrap .account-card { border-bottom: none; }
.account-settings-panel {
  padding: 4px 4px 18px;
  border-top: 1px dashed var(--border);
  margin-top: -2px;
}
.account-settings-panel .form-grid { margin-top: 12px; }

.step-track { display: flex; gap: 8px; margin-bottom: 20px; font-size: 12.5px; color: var(--ink-muted); }
.step-track .step.current { color: var(--accent); font-weight: 600; }

.loading-screen {
  display: flex; align-items: center; justify-content: center; min-height: 100vh; color: var(--ink-muted); font-size: 14px;
}

@media (max-width: 760px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { flex-direction: row; align-items: center; padding: 12px 16px; gap: 14px; overflow-x: auto; }
  .sidebar-brand { flex-shrink: 0; }
  .sidebar-nav { flex-direction: row; }
  .sidebar-stats { display: none; }
  .main { padding: 20px 18px 50px; }
  .form-grid { grid-template-columns: 1fr; }
}
`;

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

function StatBlock({ value, label }) {
  return (
    <div className="summary-stat">
      <div className="num">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function EmptyState({ title, body, ctaLabel, onCta }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      {ctaLabel && (
        <button className="btn btn-primary" onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upload wizard                                                       */
/* ------------------------------------------------------------------ */

function UploadView({ accounts, prefill, onImport }) {
  const [mode, setMode] = useState(prefill && prefill.mode === "append" ? "append" : "new");
  const [targetAccountId, setTargetAccountId] = useState(
    (prefill && prefill.accountId) || (accounts[0] && accounts[0].id) || ""
  );
  const [fileInfo, setFileInfo] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [step, setStep] = useState("select");
  const [form, setForm] = useState({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", invertSign: false });
  const [reviewResult, setReviewResult] = useState(null);
  const fileInputRef = useRef(null);

  const existingAccount = mode === "append" ? accounts.find((a) => a.id === targetAccountId) : null;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (headers.length === 0) throw new Error("No columns were found in this file.");
      if (rows.length === 0) throw new Error("This file doesn't have any data rows.");
      setFileInfo({ headers, rows, fileName: file.name });

      const guessedName = file.name.replace(/\.(csv|xlsx|xls)$/i, "");
      if (mode === "append" && existingAccount) {
        setForm({
          name: existingAccount.name,
          dateCol: headers.includes(existingAccount.dateCol) ? existingAccount.dateCol : "",
          descriptionCol: headers.includes(existingAccount.descriptionCol) ? existingAccount.descriptionCol : "",
          outCol: headers.includes(existingAccount.outCol) ? existingAccount.outCol : "",
          inCol: headers.includes(existingAccount.inCol) ? existingAccount.inCol : "",
          invertSign: !!existingAccount.invertSign,
        });
      } else {
        setForm({
          name: guessedName,
          dateCol: guessHeader(headers, ["transaction date", "posted date", "date"]),
          descriptionCol: guessHeader(headers, ["description", "memo", "payee", "merchant", "name"]),
          outCol: guessHeader(headers, ["debit", "withdrawal", "money out", "amount out"]),
          inCol: guessHeader(headers, ["credit", "deposit", "money in", "amount in"]),
          invertSign: false,
        });
      }
      setStep("mapping");
    } catch (err) {
      setParseError(err.message || "Could not read this file.");
      setFileInfo(null);
    }
  }

  function handleMappingSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.dateCol || (!form.outCol && !form.inCol)) return;
    const accountId = mode === "append" && existingAccount ? existingAccount.id : uid();
    const { valid, invalid } = buildTransactions(fileInfo.rows, form, accountId, form.name.trim());
    setReviewResult({
      valid,
      invalid,
      accountMeta: {
        id: accountId,
        name: form.name.trim(),
        dateCol: form.dateCol,
        descriptionCol: form.descriptionCol,
        outCol: form.outCol,
        inCol: form.inCol,
        invertSign: form.invertSign,
        isNew: !(mode === "append" && existingAccount),
      },
    });
    setStep("review");
  }

  function confirmImport() {
    onImport(reviewResult.accountMeta, reviewResult.valid);
  }

  function resetWizard() {
    setFileInfo(null);
    setParseError(null);
    setStep("select");
    setForm({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", invertSign: false });
    setReviewResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canSubmitMapping = form.name.trim() && form.dateCol && (form.outCol || form.inCol);
  const sameColWarning = form.outCol && form.inCol && form.outCol === form.inCol;

  return (
    <div>
      <div className="view-header">
        <h1>Upload a statement</h1>
        <p>Add a new account to track, or bring in the latest transactions for one you already have.</p>
      </div>

      <div className="step-track">
        <span className={"step" + (step === "select" ? " current" : "")}>1. Choose file</span>
        <span>→</span>
        <span className={"step" + (step === "mapping" ? " current" : "")}>2. Map columns</span>
        <span>→</span>
        <span className={"step" + (step === "review" ? " current" : "")}>3. Review &amp; import</span>
      </div>

      {step === "select" && (
        <div className="panel">
          {accounts.length > 0 && (
            <div className="radio-row">
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                Add a new account
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "append"}
                  onChange={() => setMode("append")}
                />
                Add transactions to an existing account
              </label>
            </div>
          )}

          {mode === "append" && accounts.length > 0 && (
            <div className="field" style={{ maxWidth: 320 }}>
              <label>Account</label>
              <select value={targetAccountId} onChange={(e) => setTargetAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {parseError && <div className="error-banner">{parseError}</div>}

          <div className="dropzone">
            <div>
              <strong>Drop a .csv or .xlsx file here</strong>, or choose one below.
            </div>
            <label className="file-input-label">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFile}
              />
              <span className="btn btn-secondary">Choose file</span>
            </label>
          </div>
        </div>
      )}

      {step === "mapping" && fileInfo && (
        <div className="panel">
          <form onSubmit={handleMappingSubmit}>
            <div className="form-grid">
              <div className="field span-2">
                <label>What should this account be called?</label>
                <input
                  type="text"
                  value={form.name}
                  disabled={mode === "append"}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Date column</label>
                <select
                  value={form.dateCol}
                  onChange={(e) => setForm({ ...form, dateCol: e.target.value })}
                  required
                >
                  <option value="">Select a column…</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="hint">Use whichever date you track spending by — posted or transaction.</div>
              </div>
              <div className="field">
                <label>Description column</label>
                <select
                  value={form.descriptionCol}
                  onChange={(e) => setForm({ ...form, descriptionCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="hint">Payee, memo, or merchant — whatever names the transaction. Makes categorizing much easier.</div>
              </div>
              <div className="field">
                <label>Money out (expenses)</label>
                <select
                  value={form.outCol}
                  onChange={(e) => setForm({ ...form, outCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Money in (income)</label>
                <select
                  value={form.inCol}
                  onChange={(e) => setForm({ ...form, inCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {sameColWarning && (
              <div className="invert-note">
                <div className="hint">
                  Same column picked for both — that's fine for a single signed "Amount" column.
                  By default, positive values are treated as money in and negative as money out.
                </div>
                <label className="radio-option" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.invertSign}
                    onChange={(e) => setForm({ ...form, invertSign: e.target.checked })}
                  />
                  Flip it — on this account, positive values are money out (charges) and negative
                  values are money in (refunds/payments)
                </label>
              </div>
            )}

            <div className="hint" style={{ marginBottom: 10 }}>
              Preview of the first rows in {fileInfo.fileName}:
            </div>
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    {fileInfo.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fileInfo.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {fileInfo.headers.map((h) => (
                        <td key={h}>{String(row[h])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={!canSubmitMapping}>
                Check {fileInfo.rows.length} rows
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetWizard}>
                Start over
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "review" && reviewResult && (
        <div className="panel">
          <div className="summary-row">
            <StatBlock value={fileInfo.rows.length} label="Rows in file" />
            <StatBlock value={reviewResult.valid.length} label="Ready to import" />
            <StatBlock value={reviewResult.invalid.length} label="Could not be read" />
          </div>

          {reviewResult.invalid.length > 0 && (
            <>
              <div className="hint" style={{ marginBottom: 8 }}>
                These rows will be skipped if you continue:
              </div>
              <div className="invalid-list">
                {reviewResult.invalid.slice(0, 50).map((inv) => (
                  <div className="invalid-row" key={inv.rowIndex}>
                    <span>Row {inv.rowIndex + 2}</span>
                    <span className="reason">{inv.reasons.join(", ")}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="actions-row">
            <button
              className="btn btn-primary"
              onClick={confirmImport}
              disabled={reviewResult.valid.length === 0}
            >
              Import {reviewResult.valid.length} transaction{reviewResult.valid.length === 1 ? "" : "s"}
            </button>
            <button className="btn btn-secondary" onClick={() => setStep("mapping")}>
              Back to mapping
            </button>
            <button className="btn btn-ghost" onClick={resetWizard}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts view                                                       */
/* ------------------------------------------------------------------ */

function AccountCard({ account, txCount, totalIn, totalOut, sampleRaw, onDelete, onAddTransactions, onRename, onUpdateSettings }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.name);
  const [confirming, setConfirming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const net = totalIn - totalOut;
  const headers = sampleRaw ? Object.keys(sampleRaw) : [];

  function startEdit() {
    setDraftName(account.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== account.name) onRename(account.id, trimmed);
    setEditing(false);
  }

  function openSettings() {
    setSettingsForm({
      dateCol: account.dateCol || "",
      descriptionCol: account.descriptionCol || "",
      outCol: account.outCol || "",
      inCol: account.inCol || "",
      invertSign: !!account.invertSign,
    });
    setSettingsOpen(true);
  }

  function saveSettings() {
    onUpdateSettings(account.id, settingsForm);
    setSettingsOpen(false);
  }

  const sameColWarning =
    settingsForm && settingsForm.outCol && settingsForm.inCol && settingsForm.outCol === settingsForm.inCol;
  const canSaveSettings =
    settingsForm && settingsForm.dateCol && (settingsForm.outCol || settingsForm.inCol);

  return (
    <div className="account-card-wrap">
      <div className="account-card">
        <div>
          {editing ? (
            <div className="row-actions">
              <input
                type="text"
                value={draftName}
                autoFocus
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="name">
              {account.name}
              <button className="btn btn-ghost btn-sm" onClick={startEdit}>
                Rename
              </button>
            </div>
          )}
          <div className="meta">
            {txCount} transaction{txCount === 1 ? "" : "s"} · date column: {account.dateCol}
          </div>
        </div>
        <div className="figures">
          <div className={"net " + (net >= 0 ? "money-in" : "money-out")}>{formatMoney(net)}</div>
          <div className="meta">
            {formatMoney(totalIn)} in / {formatMoney(totalOut)} out
          </div>
        </div>
        <div className="row-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onAddTransactions(account.id)}>
            Add transactions
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
          >
            {settingsOpen ? "Close settings" : "Settings"}
          </button>
          {confirming ? (
            <span className="confirm-inline">
              Delete account and {txCount} transaction{txCount === 1 ? "" : "s"}?
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(account.id)}>
                Confirm
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {settingsOpen && settingsForm && (
        <div className="account-settings-panel">
          {headers.length === 0 ? (
            <div className="hint">
              This account has no transactions to reference columns from yet — add some first.
            </div>
          ) : (
            <>
              <div className="form-grid">
                <div className="field">
                  <label>Date column</label>
                  <select
                    value={settingsForm.dateCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, dateCol: e.target.value })}
                  >
                    <option value="">Select a column…</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Description column</label>
                  <select
                    value={settingsForm.descriptionCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, descriptionCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Money out column</label>
                  <select
                    value={settingsForm.outCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, outCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Money in column</label>
                  <select
                    value={settingsForm.inCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, inCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {sameColWarning && (
                <div className="invert-note">
                  <div className="hint">
                    Same column picked for both — positive/negative in that column decides the direction.
                  </div>
                  <label className="radio-option" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={settingsForm.invertSign}
                      onChange={(e) => setSettingsForm({ ...settingsForm, invertSign: e.target.checked })}
                    />
                    Flip it — positive values are money out, negative are money in
                  </label>
                </div>
              )}

              <div className="hint" style={{ marginBottom: 10 }}>
                Saving reapplies these settings to all {txCount} existing transaction{txCount === 1 ? "" : "s"}{" "}
                for this account, not just future uploads. Any transaction that no longer parses cleanly is left
                unchanged.
              </div>

              <div className="actions-row">
                <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={!canSaveSettings}>
                  Save &amp; reapply
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSettingsOpen(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AccountsView({ accounts, transactions, onDelete, onAddTransactions, onRename, onUpdateSettings, onGoUpload }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No accounts yet"
        body="Upload a statement to add the first account you'd like to track."
        ctaLabel="Upload a statement"
        onCta={() => onGoUpload(null)}
      />
    );
  }

  return (
    <div>
      <div className="view-header">
        <h1>Accounts</h1>
        <p>Every account you're tracking, and how its balance nets out so far.</p>
      </div>
      <div className="panel">
        {accounts.map((a) => {
          const txs = transactions.filter((t) => t.accountId === a.id);
          const totalIn = txs.reduce((s, t) => s + (t.amountIn || 0), 0);
          const totalOut = txs.reduce((s, t) => s + (t.amountOut || 0), 0);
          return (
            <AccountCard
              key={a.id}
              account={a}
              txCount={txs.length}
              totalIn={totalIn}
              totalOut={totalOut}
              sampleRaw={txs[0] ? txs[0].raw : null}
              onDelete={onDelete}
              onAddTransactions={onAddTransactions}
              onRename={onRename}
              onUpdateSettings={onUpdateSettings}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Categories view                                                      */
/* ------------------------------------------------------------------ */

function CategoryCard({ category, txCount, onRename, onDelete, onToggleExcluded }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);

  function startEdit() {
    setDraftName(category.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== category.name) onRename(category.id, trimmed);
    setEditing(false);
  }

  return (
    <div className="account-card">
      <div>
        {editing ? (
          <div className="row-actions">
            <input
              type="text"
              value={draftName}
              autoFocus
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={saveEdit}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="name">
            {category.name}
            <button className="btn btn-ghost btn-sm" onClick={startEdit}>
              Rename
            </button>
          </div>
        )}
        <div className="meta">
          {txCount} transaction{txCount === 1 ? "" : "s"}
        </div>
        <label className="radio-option" style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-muted)" }}>
          <input
            type="checkbox"
            checked={!!category.excluded}
            onChange={(e) => onToggleExcluded(category.id, e.target.checked)}
          />
          Exclude from totals &amp; reports (e.g. transfers between your own accounts)
        </label>
      </div>
      <div className="row-actions">
        {confirming ? (
          <span className="confirm-inline">
            Delete this category?{txCount > 0 ? ` ${txCount} transaction${txCount === 1 ? "" : "s"} will become uncategorized.` : ""}
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(category.id)}>
              Confirm
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function CategoriesView({ categories, transactions, onAdd, onRename, onDelete, onToggleExcluded }) {
  const [newName, setNewName] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setNewName("");
  }

  return (
    <div>
      <div className="view-header">
        <h1>Categories</h1>
        <p>Set up the categories you'll use to organize spending. Assign them to transactions from the Transactions tab.</p>
      </div>

      <div className="panel">
        <form onSubmit={handleAdd} style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="New category name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{
              flex: 1,
              fontFamily: "inherit",
              fontSize: 14,
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>
            Add category
          </button>
        </form>

        {categories.length === 0 ? (
          <div className="hint">No categories yet — add your first one above.</div>
        ) : (
          categories.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              txCount={transactions.filter((t) => t.categoryId === cat.id).length}
              onRename={onRename}
              onDelete={onDelete}
              onToggleExcluded={onToggleExcluded}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transactions view                                                    */
/* ------------------------------------------------------------------ */

function TransactionRow({ t, duplicateInfo, expanded, onToggleExpand, allTransactions, categories, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    date: t.date || "",
    description: t.description || "",
    amountOut: t.amountOut != null ? String(t.amountOut) : "",
    amountIn: t.amountIn != null ? String(t.amountIn) : "",
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isDup = duplicateInfo.dupIds.has(t.id);

  function startEdit() {
    setDraft({
      date: t.date || "",
      description: t.description || "",
      amountOut: t.amountOut != null ? String(t.amountOut) : "",
      amountIn: t.amountIn != null ? String(t.amountIn) : "",
    });
    setEditing(true);
  }

  function saveEdit() {
    const out = draft.amountOut.trim() === "" ? null : parseMoney(draft.amountOut);
    const inn = draft.amountIn.trim() === "" ? null : parseMoney(draft.amountIn);
    onUpdate(t.id, {
      date: draft.date || t.date,
      description: draft.description,
      amountOut: out,
      amountIn: inn,
    });
    setEditing(false);
  }

  const dupKey = duplicateInfo.keyByTxId[t.id];
  const others = dupKey
    ? duplicateInfo.groupByKey[dupKey].filter((id) => id !== t.id).map((id) => allTransactions.find((x) => x.id === id)).filter(Boolean)
    : [];

  return (
    <>
      <tr>
        <td>
          {editing ? (
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          ) : (
            formatDateDisplay(t.date)
          )}
        </td>
        <td className="desc-cell" title={t.description || ""}>
          {editing ? (
            <input
              type="text"
              style={{ width: 170 }}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="—"
            />
          ) : (
            t.description || <span className="muted-cell">—</span>
          )}
        </td>
        <td>{t.accountName}</td>
        <td>
          {editing ? (
            <input
              type="text"
              style={{ width: 90 }}
              value={draft.amountOut}
              onChange={(e) => setDraft({ ...draft, amountOut: e.target.value })}
              placeholder="—"
            />
          ) : (
            <span className={t.amountOut != null ? "money-out" : ""}>
              {t.amountOut != null ? formatMoney(t.amountOut) : "—"}
            </span>
          )}
        </td>
        <td>
          {editing ? (
            <input
              type="text"
              style={{ width: 90 }}
              value={draft.amountIn}
              onChange={(e) => setDraft({ ...draft, amountIn: e.target.value })}
              placeholder="—"
            />
          ) : (
            <span className={t.amountIn != null ? "money-in" : ""}>
              {t.amountIn != null ? formatMoney(t.amountIn) : "—"}
            </span>
          )}
        </td>
        <td>
          <select
            value={t.categoryId || ""}
            onChange={(e) => onUpdate(t.id, { categoryId: e.target.value || null })}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          {isDup && (
            <span className="badge" onClick={() => onToggleExpand(t.id)}>
              possible duplicate {expanded ? "▲" : "▼"}
            </span>
          )}
        </td>
        <td>
          {editing ? (
            <div className="row-actions">
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : confirmingDelete ? (
            <span className="confirm-inline">
              Delete?
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(t.id)}>
                Yes
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(false)}>
                No
              </button>
            </span>
          ) : (
            <div className="row-actions">
              <button className="btn btn-ghost btn-sm" onClick={startEdit}>
                Edit
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            </div>
          )}
        </td>
      </tr>
      {expanded && isDup && (
        <tr className="dup-detail-row">
          <td colSpan={8}>
            <div className="dup-detail-title">Same date and amount as:</div>
            {others.map((o) => (
              <div className="dup-detail-item" key={o.id}>
                {formatDateDisplay(o.date)} · {o.description ? o.description + " · " : ""}{o.accountName} · {formatMoney(o.amountOut != null ? o.amountOut : o.amountIn)}
                {" "}({o.amountOut != null ? "money out" : "money in"})
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function TransactionsView({ transactions, accounts, categories, duplicateInfo, onUpdate, onDelete, onGoUpload }) {
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [dupOnly, setDupOnly] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [dateSortDir, setDateSortDir] = useState("desc");

  const filtered = useMemo(() => {
    let list = transactions;
    if (filterAccount !== "all") list = list.filter((t) => t.accountId === filterAccount);
    if (filterCategory === "uncategorized") list = list.filter((t) => !t.categoryId);
    else if (filterCategory !== "all") list = list.filter((t) => t.categoryId === filterCategory);
    if (dupOnly) list = list.filter((t) => duplicateInfo.dupIds.has(t.id));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const haystack = [t.accountName, t.date, t.description, ...Object.values(t.raw || {}).map(String)]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    const dir = dateSortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => (a.date < b.date ? -dir : a.date > b.date ? dir : 0));
  }, [transactions, filterAccount, filterCategory, dupOnly, search, duplicateInfo, dateSortDir]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No transactions yet"
        body="Once you upload a statement, everything you import will show up here in one combined list."
        ctaLabel="Upload a statement"
        onCta={() => onGoUpload(null)}
      />
    );
  }

  const totalIn = filtered.reduce((s, t) => s + (t.amountIn || 0), 0);
  const totalOut = filtered.reduce((s, t) => s + (t.amountOut || 0), 0);

  return (
    <div>
      <div className="view-header">
        <h1>Transactions</h1>
        <p>Everything you've imported, combined in one place.</p>
      </div>

      <div className="summary-row">
        <StatBlock value={filtered.length} label="Transactions shown" />
        <StatBlock value={formatMoney(totalIn)} label="Money in" />
        <StatBlock value={formatMoney(totalOut)} label="Money out" />
        <StatBlock value={formatMoney(totalIn - totalOut)} label="Net" />
      </div>

      <div className="filter-bar">
        <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="checkbox-filter">
          <input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} />
          Possible duplicates only ({duplicateInfo.dupIds.size})
        </label>
      </div>

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tx-table">
          <thead>
            <tr>
              <th>
                <button
                  className="th-sort-btn"
                  onClick={() => setDateSortDir(dateSortDir === "asc" ? "desc" : "asc")}
                >
                  Date {dateSortDir === "asc" ? "▲" : "▼"}
                </button>
              </th>
              <th>Description</th>
              <th>Account</th>
              <th>Money out</th>
              <th>Money in</th>
              <th>Category</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <TransactionRow
                key={t.id}
                t={t}
                duplicateInfo={duplicateInfo}
                expanded={expandedId === t.id}
                onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                allTransactions={transactions}
                categories={categories}
                onUpdate={onUpdate}
                onDelete={onDelete}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--ink-muted)" }}>
                  No transactions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reports view                                                         */
/* ------------------------------------------------------------------ */

function ReportsView({ transactions, accounts, categories, onGoCategories }) {
  const [mode, setMode] = useState("monthly");
  const [filterAccount, setFilterAccount] = useState("all");

  const periodKeyFn = mode === "weekly" ? getWeekStartISO : getMonthStartISO;
  const periodLabelFn = mode === "weekly" ? formatWeekLabel : formatMonthLabel;

  const trackedCategories = categories.filter((c) => !c.excluded);
  const excludedCategories = categories.filter((c) => c.excluded);
  const trackedIds = new Set(trackedCategories.map((c) => c.id));

  const { periods, rows, periodTotals, grandTotal, totalIn, totalOut } = useMemo(() => {
    let list = transactions;
    if (filterAccount !== "all") list = list.filter((t) => t.accountId === filterAccount);
    list = list.filter((t) => !t.categoryId || trackedIds.has(t.categoryId));

    const periodSet = new Set();
    const rowMap = { uncategorized: {} };
    const catLabel = { uncategorized: "Uncategorized" };
    trackedCategories.forEach((c) => {
      rowMap[c.id] = {};
      catLabel[c.id] = c.name;
    });

    let sumIn = 0;
    let sumOut = 0;

    list.forEach((t) => {
      if (!t.date) return;
      const key = t.categoryId || "uncategorized";
      const pKey = periodKeyFn(t.date);
      periodSet.add(pKey);
      rowMap[key][pKey] = (rowMap[key][pKey] || 0) + (t.amountIn || 0) - (t.amountOut || 0);
      sumIn += t.amountIn || 0;
      sumOut += t.amountOut || 0;
    });

    const periods = Array.from(periodSet).sort();

    const rows = Object.keys(rowMap)
      .filter((key) => Object.keys(rowMap[key]).length > 0)
      .map((key) => {
        const cells = periods.map((p) => rowMap[key][p] || 0);
        const total = cells.reduce((s, v) => s + v, 0);
        return { key, label: catLabel[key], cells, total };
      })
      .sort((a, b) => a.total - b.total);

    const periodTotals = periods.map((p, i) => rows.reduce((s, r) => s + r.cells[i], 0));
    const grandTotal = periodTotals.reduce((s, v) => s + v, 0);

    return { periods, rows, periodTotals, grandTotal, totalIn: sumIn, totalOut: sumOut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, categories, filterAccount, mode]);

  const chartCategories = useMemo(() => {
    const sorted = [...rows].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);
    if (rest.length > 0) {
      const otherCells = periods.map((_, i) => rest.reduce((s, r) => s + r.cells[i], 0));
      top.push({ key: "other", label: "Other", cells: otherCells, total: otherCells.reduce((s, v) => s + v, 0) });
    }
    return top;
  }, [rows, periods]);

  const chartData = periods.map((p, i) => {
    const entry = { period: periodLabelFn(p) };
    chartCategories.forEach((c) => {
      entry[c.label] = c.cells[i];
    });
    return entry;
  });

  if (accounts.length === 0 || transactions.length === 0) {
    return (
      <EmptyState
        title="Nothing to report yet"
        body="Once you've imported some transactions and sorted a few into categories, weekly and monthly roll-ups will show up here."
      />
    );
  }

  return (
    <div>
      <div className="view-header">
        <h1>Reports</h1>
        <p>Category totals rolled up by week or month, like a pivot table of your spending.</p>
      </div>

      <div className="filter-bar">
        <div className="toggle-group">
          <button className={"toggle-btn" + (mode === "weekly" ? " active" : "")} onClick={() => setMode("weekly")}>
            Weekly
          </button>
          <button className={"toggle-btn" + (mode === "monthly" ? " active" : "")} onClick={() => setMode("monthly")}>
            Monthly
          </button>
        </div>
        <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="summary-row">
        <StatBlock value={formatMoney(totalIn)} label="Tracked money in" />
        <StatBlock value={formatMoney(totalOut)} label="Tracked money out" />
        <StatBlock value={formatMoney(grandTotal)} label="Tracked net" />
      </div>

      <div className="panel chart-card">
        <div className="chart-wrap">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--ink-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--ink-muted)" }} tickFormatter={(v) => formatMoney(v)} width={72} />
              <Tooltip
                formatter={(value) => formatMoney(value)}
                contentStyle={{
                  fontSize: 12.5,
                  fontFamily: "'Work Sans', sans-serif",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chartCategories.map((c, i) => (
                <Bar key={c.key} dataKey={c.label} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="pivot-table">
          <thead>
            <tr>
              <th>Category</th>
              {periods.map((p) => (
                <th key={p}>{periodLabelFn(p)}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="pivot-row-label">{r.label}</td>
                {r.cells.map((v, i) => (
                  <td key={i} className={v > 0 ? "money-in" : v < 0 ? "money-out" : "muted-cell"}>
                    {v === 0 ? "—" : formatMoney(v)}
                  </td>
                ))}
                <td className={"pivot-total-col " + (r.total > 0 ? "money-in" : r.total < 0 ? "money-out" : "muted-cell")}>
                  {formatMoney(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {periodTotals.map((v, i) => (
                <td key={i} className={v > 0 ? "money-in" : v < 0 ? "money-out" : "muted-cell"}>
                  {formatMoney(v)}
                </td>
              ))}
              <td className={grandTotal > 0 ? "money-in" : grandTotal < 0 ? "money-out" : "muted-cell"}>
                {formatMoney(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {excludedCategories.length > 0 && (
        <div className="excluded-note">
          <span>
            Not counted above: {excludedCategories.map((c) => c.name).join(", ")}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onGoCategories}>
            Manage categories
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

function App() {
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [view, setView] = useState("upload");
  const [saveError, setSaveError] = useState(null);
  const [toast, setToast] = useState(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [uploadPrefill, setUploadPrefill] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadData().then((data) => {
      if (cancelled) return;
      const nextAccounts = data.accounts || [];
      setAccounts(nextAccounts);
      setTransactions(data.transactions || []);
      setCategories(data.categories || []);
      setLoaded(true);
      if (nextAccounts.length > 0) setView("transactions");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const persist = useCallback(async (nextAccounts, nextTransactions, nextCategories) => {
    setAccounts(nextAccounts);
    setTransactions(nextTransactions);
    setCategories(nextCategories);
    const ok = await saveData(nextAccounts, nextTransactions, nextCategories);
    setSaveError(ok ? null : "Your last change couldn't be saved locally — it may not persist after reload.");
  }, []);

  const duplicateInfo = useMemo(() => computeDuplicates(transactions), [transactions]);

  const goToUpload = useCallback((accountId) => {
    setUploadPrefill(accountId ? { mode: "append", accountId } : null);
    setUploadKey((k) => k + 1);
    setView("upload");
  }, []);

  const handleImport = useCallback(
    (accountMeta, valid) => {
      let nextAccounts;
      if (accountMeta.isNew) {
        nextAccounts = [
          ...accounts,
          {
            id: accountMeta.id,
            name: accountMeta.name,
            dateCol: accountMeta.dateCol,
            descriptionCol: accountMeta.descriptionCol,
            outCol: accountMeta.outCol,
            inCol: accountMeta.inCol,
            invertSign: accountMeta.invertSign,
            createdAt: new Date().toISOString(),
          },
        ];
      } else {
        nextAccounts = accounts.map((a) =>
          a.id === accountMeta.id
            ? {
                ...a,
                dateCol: accountMeta.dateCol,
                descriptionCol: accountMeta.descriptionCol,
                outCol: accountMeta.outCol,
                inCol: accountMeta.inCol,
                invertSign: accountMeta.invertSign,
              }
            : a
        );
      }
      const nextTransactions = [...transactions, ...valid];
      persist(nextAccounts, nextTransactions, categories);
      setView("transactions");
      setToast(`Imported ${valid.length} transaction${valid.length === 1 ? "" : "s"} into ${accountMeta.name}.`);
    },
    [accounts, transactions, categories, persist]
  );

  const handleDeleteAccount = useCallback(
    (accountId) => {
      const nextAccounts = accounts.filter((a) => a.id !== accountId);
      const nextTransactions = transactions.filter((t) => t.accountId !== accountId);
      persist(nextAccounts, nextTransactions, categories);
    },
    [accounts, transactions, categories, persist]
  );

  const handleRenameAccount = useCallback(
    (accountId, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const nextAccounts = accounts.map((a) => (a.id === accountId ? { ...a, name: trimmed } : a));
      const nextTransactions = transactions.map((t) =>
        t.accountId === accountId ? { ...t, accountName: trimmed } : t
      );
      persist(nextAccounts, nextTransactions, categories);
    },
    [accounts, transactions, categories, persist]
  );

  const handleUpdateAccountSettings = useCallback(
    (accountId, mapping) => {
      const nextAccounts = accounts.map((a) =>
        a.id === accountId
          ? {
              ...a,
              dateCol: mapping.dateCol,
              descriptionCol: mapping.descriptionCol,
              outCol: mapping.outCol,
              inCol: mapping.inCol,
              invertSign: mapping.invertSign,
            }
          : a
      );
      let skipped = 0;
      const nextTransactions = transactions.map((t) => {
        if (t.accountId !== accountId) return t;
        const mapped = mapRow(t.raw || {}, mapping);
        if (mapped.reasons.length > 0) {
          skipped += 1;
          return t;
        }
        return { ...t, date: mapped.date, description: mapped.description, amountOut: mapped.amountOut, amountIn: mapped.amountIn };
      });
      persist(nextAccounts, nextTransactions, categories);
      setToast(
        skipped > 0
          ? `Updated account settings. ${skipped} transaction${skipped === 1 ? "" : "s"} couldn't be remapped and were left as-is.`
          : "Updated account settings and reapplied them to existing transactions."
      );
    },
    [accounts, transactions, categories, persist]
  );

  const handleUpdateTransaction = useCallback(
    (id, updates) => {
      const nextTransactions = transactions.map((t) => (t.id === id ? { ...t, ...updates } : t));
      persist(accounts, nextTransactions, categories);
    },
    [accounts, transactions, categories, persist]
  );

  const handleDeleteTransaction = useCallback(
    (id) => {
      const nextTransactions = transactions.filter((t) => t.id !== id);
      persist(accounts, nextTransactions, categories);
    },
    [accounts, transactions, categories, persist]
  );

  const handleAddCategory = useCallback(
    (name) => {
      const nextCategories = [...categories, { id: uid(), name, excluded: false }];
      persist(accounts, transactions, nextCategories);
    },
    [accounts, transactions, categories, persist]
  );

  const handleRenameCategory = useCallback(
    (categoryId, newName) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, name: newName } : c));
      persist(accounts, transactions, nextCategories);
    },
    [accounts, transactions, categories, persist]
  );

  const handleToggleCategoryExcluded = useCallback(
    (categoryId, excluded) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, excluded } : c));
      persist(accounts, transactions, nextCategories);
    },
    [accounts, transactions, categories, persist]
  );

  const handleDeleteCategory = useCallback(
    (categoryId) => {
      const nextCategories = categories.filter((c) => c.id !== categoryId);
      const nextTransactions = transactions.map((t) =>
        t.categoryId === categoryId ? { ...t, categoryId: null } : t
      );
      persist(accounts, nextTransactions, nextCategories);
    },
    [accounts, transactions, categories, persist]
  );

  if (!loaded) {
    return (
      <div className="ledger-root">
        <style>{STYLES}</style>
        <div className="loading-screen">Loading your ledger…</div>
      </div>
    );
  }

  const totalNet = transactions.reduce((s, t) => s + (t.amountIn || 0) - (t.amountOut || 0), 0);

  return (
    <div className="ledger-root">
      <style>{STYLES}</style>
      <div className="app-shell">
        <div className="sidebar">
          <div className="sidebar-brand">
            <span className="sidebar-brand-mark" />
            Ledger
          </div>
          <div className="sidebar-nav">
            <button
              className={"nav-btn" + (view === "transactions" ? " active" : "")}
              onClick={() => setView("transactions")}
            >
              Transactions
            </button>
            <button
              className={"nav-btn" + (view === "reports" ? " active" : "")}
              onClick={() => setView("reports")}
            >
              Reports
            </button>
            <button
              className={"nav-btn" + (view === "accounts" ? " active" : "")}
              onClick={() => setView("accounts")}
            >
              Accounts
            </button>
            <button
              className={"nav-btn" + (view === "categories" ? " active" : "")}
              onClick={() => setView("categories")}
            >
              Categories
            </button>
            <button
              className={"nav-btn" + (view === "upload" ? " active" : "")}
              onClick={() => goToUpload(null)}
            >
              Upload
            </button>
          </div>
          <div className="sidebar-stats">
            <div className="stat-row">
              <span>Accounts</span>
              <span>{accounts.length}</span>
            </div>
            <div className="stat-row">
              <span>Transactions</span>
              <span>{transactions.length}</span>
            </div>
            <div className="stat-row stat-net">
              <span>Net</span>
              <span>{formatMoney(totalNet)}</span>
            </div>
          </div>
        </div>

        <div className="main">
          {saveError && <div className="error-banner">{saveError}</div>}

          {view === "upload" && (
            <UploadView key={uploadKey} accounts={accounts} prefill={uploadPrefill} onImport={handleImport} />
          )}
          {view === "transactions" && (
            <TransactionsView
              transactions={transactions}
              accounts={accounts}
              categories={categories}
              duplicateInfo={duplicateInfo}
              onUpdate={handleUpdateTransaction}
              onDelete={handleDeleteTransaction}
              onGoUpload={goToUpload}
            />
          )}
          {view === "reports" && (
            <ReportsView
              transactions={transactions}
              accounts={accounts}
              categories={categories}
              onGoCategories={() => setView("categories")}
            />
          )}
          {view === "accounts" && (
            <AccountsView
              accounts={accounts}
              transactions={transactions}
              onDelete={handleDeleteAccount}
              onRename={handleRenameAccount}
              onUpdateSettings={handleUpdateAccountSettings}
              onAddTransactions={goToUpload}
              onGoUpload={goToUpload}
            />
          )}
          {view === "categories" && (
            <CategoriesView
              categories={categories}
              transactions={transactions}
              onAdd={handleAddCategory}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
              onToggleExcluded={handleToggleCategoryExcluded}
            />
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;