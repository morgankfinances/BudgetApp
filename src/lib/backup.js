import Papa from "papaparse";
import { parseDateISO, parseMoney, todayISO, uid } from "./utils.js";


/* ------------------------------------------------------------------ */
/* Full backup: export everything to one CSV, and rebuild from one     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* CSV formula-injection protection                                     */
/*                                                                      */
/* Spreadsheet programs run a cell as a formula if it starts with =, +, */
/* -, or @ (or a tab or carriage return), and a crafted formula can do  */
/* real harm when someone opens a backup. Transaction descriptions come */
/* from bank files and other household members, so every exported text */
/* cell that starts that way gets an apostrophe in front, which makes   */
/* spreadsheets show it as plain text. Restoring a backup removes       */
/* exactly that one apostrophe again, so data round-trips unchanged.    */
/* ------------------------------------------------------------------ */

// Starts with a formula character, possibly after apostrophes we added.
export const FORMULA_START = /^'*[=+\-@\t\r]/;

// Plain numbers (e.g. "-50", "1,100.00") are safe and stay numbers.
export const PLAIN_NUMBER = /^[-+]?[\d,]*\.?\d+$/;


export function protectCsvCell(value) {
  if (typeof value !== "string") return value; // real numbers, blanks
  if (PLAIN_NUMBER.test(value)) return value;
  return FORMULA_START.test(value) ? "'" + value : value;
}


export function unprotectCsvCell(value) {
  if (typeof value !== "string") return value;
  return /^'+[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}


export function protectCsvRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) out[key] = protectCsvCell(row[key]);
    return out;
  });
}


export function unprotectCsvRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) out[key] = unprotectCsvCell(row[key]);
    return out;
  });
}


// Hands the browser a CSV file to save.
export function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const BACKUP_COLUMNS = [
  "Account",
  "Date",
  "Description",
  "Money Out",
  "Money In",
  "Category",
  "Category Excluded",
  "Category Income",
  "Uploaded At",
  "Upload Batch",
  "Not A Duplicate",
  "Counts Toward Period",
];


// Builds the ledger backup file's contents.
export function buildBackupCSV(accounts, transactions, categories) {
  const categoryById = {};
  categories.forEach((c) => {
    categoryById[c.id] = c;
  });

  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const rows = sorted.map((t) => {
    const cat = t.categoryId ? categoryById[t.categoryId] : null;
    return {
      Account: t.accountName || "",
      Date: t.date || "",
      Description: t.description || "",
      "Money Out": t.amountOut != null ? t.amountOut : "",
      "Money In": t.amountIn != null ? t.amountIn : "",
      Category: cat ? cat.name : "",
      "Category Excluded": cat ? (cat.excluded ? "Yes" : "No") : "",
      "Category Income": cat ? (cat.isIncome ? "Yes" : "No") : "",
      "Uploaded At": t.uploadedAt || "",
      "Upload Batch": t.uploadBatchId || "",
      "Not A Duplicate": t.notDuplicate ? "Yes" : "No",
      "Counts Toward Period": t.budgetPeriodOverride || "",
    };
  });

  return Papa.unparse(protectCsvRows(rows), { columns: BACKUP_COLUMNS });
}

// Downloads the ledger backup file.
export function exportBackupCSV(accounts, transactions, categories) {
  downloadCSV(buildBackupCSV(accounts, transactions, categories), `ledger-backup-${todayISO()}.csv`);
}


export function buildFromBackupRows(rows) {
  rows = unprotectCsvRows(rows); // undo export-time formula protection
  const accountsByName = {};
  const categoriesByName = {};
  const transactions = [];
  const invalid = [];

  rows.forEach((row, idx) => {
    const accountName = String(row["Account"] != null ? row["Account"] : "").trim();
    const date = parseDateISO(row["Date"]);
    const description = String(row["Description"] != null ? row["Description"] : "").trim();
    const categoryName = String(row["Category"] != null ? row["Category"] : "").trim();
    const categoryExcludedRaw = String(row["Category Excluded"] != null ? row["Category Excluded"] : "")
      .trim()
      .toLowerCase();
    const categoryIncomeRaw = String(row["Category Income"] != null ? row["Category Income"] : "")
      .trim()
      .toLowerCase();

    const reasons = [];
    if (!accountName) reasons.push("missing account name");
    if (!date) reasons.push("unrecognized date");

    let amountOut = null;
    let amountIn = null;
    const outRaw = row["Money Out"];
    const inRaw = row["Money In"];
    if (outRaw !== "" && outRaw != null) {
      const parsed = parseMoney(outRaw);
      if (parsed === null) reasons.push("unrecognized money-out value");
      else if (parsed !== 0) amountOut = Math.abs(parsed);
    }
    if (inRaw !== "" && inRaw != null) {
      const parsed = parseMoney(inRaw);
      if (parsed === null) reasons.push("unrecognized money-in value");
      else if (parsed !== 0) amountIn = parsed;
    }
    if (amountOut == null && amountIn == null && reasons.length === 0) {
      reasons.push("no amount in either column");
    }

    if (reasons.length > 0) {
      invalid.push({ rowIndex: idx, raw: row, reasons });
      return;
    }

    if (!accountsByName[accountName]) {
      accountsByName[accountName] = {
        id: uid(),
        name: accountName,
        dateCol: "",
        descriptionCol: "",
        outCol: "",
        inCol: "",
        invertSign: false,
        createdAt: new Date().toISOString(),
      };
    }
    const account = accountsByName[accountName];

    let categoryId = null;
    if (categoryName) {
      if (!categoriesByName[categoryName]) {
        categoriesByName[categoryName] = {
          id: uid(),
          name: categoryName,
          excluded: categoryExcludedRaw === "yes",
          isIncome: categoryIncomeRaw === "yes",
        };
      }
      categoryId = categoriesByName[categoryName].id;
    }

    transactions.push({
      id: uid(),
      accountId: account.id,
      accountName: account.name,
      date,
      description,
      amountOut,
      amountIn,
      categoryId,
      raw: null, // restored from a backup, not a bank file: there's no original bank row
      uploadedAt: row["Uploaded At"] || undefined,
      uploadBatchId: row["Upload Batch"] || undefined,
      notDuplicate: String(row["Not A Duplicate"] || "").trim().toLowerCase() === "yes",
      budgetPeriodOverride: row["Counts Toward Period"] || undefined,
    });
  });

  return {
    accounts: Object.values(accountsByName),
    categories: Object.values(categoriesByName),
    transactions,
    invalid,
  };
}


/* ------------------------------------------------------------------ */
/* Budget backup: export budget setup to one CSV, and apply one back   */
/* ------------------------------------------------------------------ */

export const BUDGET_BACKUP_COLUMNS = [
  "Row Type",
  "Item Type",
  "Name",
  "Budget Amount",
  "Budget Period",
  "Budget Type",
  "Accumulate Target",
  "Group",
  "Members",
  "Period",
  "Amount",
];


// Builds the budget backup file's contents.
export function buildBudgetCSV(categories, budgetGroups, plannedIncome) {
  const rows = [];

  rows.push({
    "Row Type": "Settings",
    "Item Type": "",
    Name: "Planned Monthly Income",
    "Budget Amount": "",
    "Budget Period": "",
    "Budget Type": "",
    "Accumulate Target": "",
    Group: "",
    Members: "",
    Period: "",
    Amount: plannedIncome != null ? plannedIncome : "",
  });

  const groupNameByCategoryId = {};
  budgetGroups.forEach((g) => {
    (g.categoryIds || []).forEach((id) => {
      groupNameByCategoryId[id] = g.name;
    });
  });

  categories.forEach((c) => {
    rows.push({
      "Row Type": "Category",
      "Item Type": "Category",
      Name: c.name,
      "Budget Amount": c.budgetAmount != null ? c.budgetAmount : "",
      "Budget Period": c.budgetAmount != null ? c.budgetPeriod || "monthly" : "",
      "Budget Type": c.budgetAmount != null ? (c.budgetType === "accumulate" ? "Accumulate" : "Spend") : "",
      "Accumulate Target": c.accumulateTarget != null ? c.accumulateTarget : "",
      Group: groupNameByCategoryId[c.id] || "",
      Members: "",
      Period: "",
      Amount: "",
    });
  });

  budgetGroups.forEach((g) => {
    const memberNames = (g.categoryIds || [])
      .map((id) => categories.find((c) => c.id === id)?.name)
      .filter(Boolean);
    rows.push({
      "Row Type": "Group",
      "Item Type": "Group",
      Name: g.name,
      "Budget Amount": g.budgetAmount != null ? g.budgetAmount : "",
      "Budget Period": g.budgetAmount != null ? g.budgetPeriod || "monthly" : "",
      "Budget Type": g.budgetAmount != null ? (g.budgetType === "accumulate" ? "Accumulate" : "Spend") : "",
      "Accumulate Target": g.accumulateTarget != null ? g.accumulateTarget : "",
      Group: "",
      Members: memberNames.join("|"),
      Period: "",
      Amount: "",
    });
  });

  const pushOverrides = (item, itemType) => {
    Object.entries(item.accumulateActuals || {}).forEach(([period, amount]) => {
      rows.push({
        "Row Type": "Override",
        "Item Type": itemType,
        Name: item.name,
        "Budget Amount": "",
        "Budget Period": "",
        "Budget Type": "",
        "Accumulate Target": "",
        Group: "",
        Members: "",
        Period: period,
        Amount: amount,
      });
    });
    (item.fundAdjustments || []).forEach((adj) => {
      rows.push({
        "Row Type": "FundAdjustment",
        "Item Type": itemType,
        Name: item.name,
        "Budget Amount": "",
        "Budget Period": "",
        "Budget Type": "",
        "Accumulate Target": "",
        Group: "",
        Members: "",
        Period: adj.date,
        Amount: adj.amount,
      });
    });
  };
  categories.forEach((c) => pushOverrides(c, "Category"));
  budgetGroups.forEach((g) => pushOverrides(g, "Group"));

  return Papa.unparse(protectCsvRows(rows), { columns: BUDGET_BACKUP_COLUMNS });
}

// Downloads the budget backup file.
export function exportBudgetCSV(categories, budgetGroups, plannedIncome) {
  downloadCSV(buildBudgetCSV(categories, budgetGroups, plannedIncome), `budget-backup-${todayISO()}.csv`);
}


export function buildBudgetFromRows(rows, currentCategories, currentBudgetGroups) {
  rows = unprotectCsvRows(rows); // undo export-time formula protection
  let plannedIncome = null;
  const categoryUpdates = {};
  const groupDefs = {};
  const categoryOverrides = {};
  const groupOverrides = {};
  const categoryFundAdjustments = {};
  const groupFundAdjustments = {};
  const invalid = [];

  const normPeriod = (v) => (String(v || "").trim().toLowerCase() === "weekly" ? "weekly" : "monthly");
  const normType = (v) => (String(v || "").trim().toLowerCase() === "accumulate" ? "accumulate" : "spend");

  rows.forEach((row, idx) => {
    const rowType = String(row["Row Type"] || "").trim();
    if (!rowType) return;

    if (rowType === "Settings") {
      const amt = parseMoney(row["Amount"]);
      if (amt != null) plannedIncome = amt;
    } else if (rowType === "Category") {
      const name = String(row["Name"] || "").trim();
      if (!name) {
        invalid.push({ rowIndex: idx, reasons: ["missing category name"] });
        return;
      }
      const rawAmount = row["Budget Amount"];
      categoryUpdates[name] = {
        budgetAmount: rawAmount !== "" && rawAmount != null ? parseMoney(rawAmount) : null,
        budgetPeriod: normPeriod(row["Budget Period"]),
        budgetType: normType(row["Budget Type"]),
        accumulateTarget: row["Accumulate Target"] !== "" && row["Accumulate Target"] != null ? parseMoney(row["Accumulate Target"]) : null,
      };
    } else if (rowType === "Group") {
      const name = String(row["Name"] || "").trim();
      if (!name) {
        invalid.push({ rowIndex: idx, reasons: ["missing group name"] });
        return;
      }
      const rawAmount = row["Budget Amount"];
      const members = String(row["Members"] || "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      groupDefs[name] = {
        budgetAmount: rawAmount !== "" && rawAmount != null ? parseMoney(rawAmount) : null,
        budgetPeriod: normPeriod(row["Budget Period"]),
        budgetType: normType(row["Budget Type"]),
        accumulateTarget: row["Accumulate Target"] !== "" && row["Accumulate Target"] != null ? parseMoney(row["Accumulate Target"]) : null,
        memberNames: members,
      };
    } else if (rowType === "Override") {
      const itemType = String(row["Item Type"] || "").trim();
      const name = String(row["Name"] || "").trim();
      let period = String(row["Period"] || "").trim();
      // A bare "YYYY-MM" (no day) looks equivalent to "YYYY-MM-01" to a
      // person, but as a stored key it isn't — the rest of the app always
      // keys monthly periods by the 1st, so an ungenerous typo like this
      // would silently create a second, invisible-looking "duplicate"
      // period alongside the real one instead of matching it.
      if (/^\d{4}-\d{2}$/.test(period)) period = `${period}-01`;
      const amt = parseMoney(row["Amount"]);
      if (name && period && amt != null) {
        const bucket = itemType === "Group" ? groupOverrides : categoryOverrides;
        if (!bucket[name]) bucket[name] = {};
        bucket[name][period] = amt;
      } else {
        invalid.push({ rowIndex: idx, reasons: ["incomplete override row"] });
      }
    } else if (rowType === "FundAdjustment") {
      const itemType = String(row["Item Type"] || "").trim();
      const name = String(row["Name"] || "").trim();
      const date = String(row["Period"] || "").trim();
      const amt = parseMoney(row["Amount"]);
      if (name && date && amt != null) {
        const bucket = itemType === "Group" ? groupFundAdjustments : categoryFundAdjustments;
        if (!bucket[name]) bucket[name] = [];
        bucket[name].push({ date, amount: amt });
      } else {
        invalid.push({ rowIndex: idx, reasons: ["incomplete fund adjustment row"] });
      }
    } else {
      invalid.push({ rowIndex: idx, reasons: [`unrecognized row type "${rowType}"`] });
    }
  });

  const existingCategoryNames = new Set(currentCategories.map((c) => c.name));
  const updatedExistingCategories = currentCategories.map((c) => {
    const upd = categoryUpdates[c.name];
    if (!upd) return c;
    return {
      ...c,
      budgetAmount: upd.budgetAmount,
      budgetPeriod: upd.budgetPeriod,
      budgetType: upd.budgetType,
      accumulateTarget: upd.accumulateTarget,
      accumulateActuals: categoryOverrides[c.name] || c.accumulateActuals || {},
      fundAdjustments: categoryFundAdjustments[c.name] || c.fundAdjustments || [],
    };
  });
  const newCategoryEntries = Object.keys(categoryUpdates)
    .filter((name) => !existingCategoryNames.has(name))
    .map((name) => {
      const upd = categoryUpdates[name];
      return {
        id: uid(),
        name,
        excluded: false,
        budgetAmount: upd.budgetAmount,
        budgetPeriod: upd.budgetPeriod,
        budgetType: upd.budgetType,
        accumulateTarget: upd.accumulateTarget,
        accumulateActuals: categoryOverrides[name] || {},
        fundAdjustments: categoryFundAdjustments[name] || [],
        createdAt: new Date().toISOString(),
      };
    });
  const nextCategories = [...updatedExistingCategories, ...newCategoryEntries];

  const nameToId = {};
  nextCategories.forEach((c) => {
    nameToId[c.name] = c.id;
  });

  const existingGroupNames = new Set(currentBudgetGroups.map((g) => g.name));
  const updatedExistingGroups = currentBudgetGroups.map((g) => {
    const def = groupDefs[g.name];
    if (!def) return g;
    return {
      ...g,
      budgetAmount: def.budgetAmount,
      budgetPeriod: def.budgetPeriod,
      budgetType: def.budgetType,
      accumulateTarget: def.accumulateTarget,
      categoryIds: def.memberNames.map((n) => nameToId[n]).filter(Boolean),
      accumulateActuals: groupOverrides[g.name] || g.accumulateActuals || {},
      fundAdjustments: groupFundAdjustments[g.name] || g.fundAdjustments || [],
    };
  });
  const newGroupEntries = Object.keys(groupDefs)
    .filter((name) => !existingGroupNames.has(name))
    .map((name) => {
      const def = groupDefs[name];
      return {
        id: uid(),
        name,
        budgetAmount: def.budgetAmount,
        budgetPeriod: def.budgetPeriod,
        budgetType: def.budgetType,
        accumulateTarget: def.accumulateTarget,
        categoryIds: def.memberNames.map((n) => nameToId[n]).filter(Boolean),
        accumulateActuals: groupOverrides[name] || {},
        fundAdjustments: groupFundAdjustments[name] || [],
        createdAt: new Date().toISOString(),
      };
    });
  const nextBudgetGroups = [...updatedExistingGroups, ...newGroupEntries];

  return {
    plannedIncome,
    categories: nextCategories,
    budgetGroups: nextBudgetGroups,
    invalid,
    categoryCount: Object.keys(categoryUpdates).length,
    groupCount: Object.keys(groupDefs).length,
  };
}

/* ------------------------------------------------------------------ */
/* Complete backups                                                     */
/* ------------------------------------------------------------------ */
// One file with everything Coinrose stores: accounts (with column settings
// and starting balances), every transaction (with bank IDs, splits,
// transfer pairs, comments, and suggested or skipped marks), categories,
// budget groups, and the household's settings. The CSV backups above are
// spreadsheet-friendly copies, but they can't hold all of that.

export const FULL_BACKUP_FORMAT = "coinrose-backup";
export const FULL_BACKUP_VERSION = 1;

// The settings a complete backup carries (the same ones saved for the
// household).
const SETTINGS_KEYS = [
  "plannedIncome",
  "incomeWarningDismissed",
  "hiddenBudgetMonths",
  "excludeUnassignedFromBudget",
  "autoApplySuggestions",
  "duplicateHandling",
  "hiddenRecurring",
];

export function buildFullBackup(ledger, exportedAt = new Date().toISOString()) {
  const settings = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, ledger[k] === undefined ? null : ledger[k]]));
  return {
    format: FULL_BACKUP_FORMAT,
    version: FULL_BACKUP_VERSION,
    exportedAt,
    data: {
      accounts: ledger.accounts || [],
      categories: ledger.categories || [],
      budgetGroups: ledger.budgetGroups || [],
      // The account name comes from the account itself, so it isn't repeated.
      transactions: (ledger.transactions || []).map(({ accountName, ...t }) => t), // eslint-disable-line no-unused-vars
      settings,
    },
  };
}

export function downloadJSON(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportFullBackup(ledger, today) {
  downloadJSON(buildFullBackup(ledger), `coinrose-backup-${today}.json`);
}

// Reads a complete backup file's text. Returns { ledger, summary }, where
// ledger is ready to restore (the same shape the app loads), or throws an
// Error with a message meant for the person restoring.
export function readFullBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("This file isn't a Coinrose complete backup (it couldn't be read as one).");
  }
  if (!parsed || parsed.format !== FULL_BACKUP_FORMAT) {
    throw new Error("This file isn't a Coinrose complete backup.");
  }
  if (typeof parsed.version !== "number" || parsed.version > FULL_BACKUP_VERSION) {
    throw new Error("This backup was made by a newer version of Coinrose. Refresh the page to get the latest version, then try again.");
  }
  const data = parsed.data || {};
  const list = (x) => (Array.isArray(x) ? x.filter((item) => item && typeof item === "object" && typeof item.id === "string") : []);
  const accounts = list(data.accounts);
  const accountName = new Map(accounts.map((a) => [a.id, a.name || ""]));
  const transactions = list(data.transactions)
    .filter((t) => typeof t.accountId === "string")
    .map((t) => ({ ...t, accountName: accountName.get(t.accountId) || "" }));
  const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
  const ledger = {
    accounts,
    categories: list(data.categories),
    budgetGroups: list(data.budgetGroups),
    transactions,
    ...Object.fromEntries(SETTINGS_KEYS.filter((k) => settings[k] !== undefined && settings[k] !== null).map((k) => [k, settings[k]])),
  };
  const count = (pred) => transactions.filter(pred).length;
  return {
    ledger,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : null,
    summary: {
      accounts: accounts.length,
      transactions: count((t) => !t.skippedDuplicateOf),
      categories: ledger.categories.length,
      budgetGroups: ledger.budgetGroups.length,
      splits: count((t) => Array.isArray(t.splits) && t.splits.length > 0),
      transferPairs: count((t) => t.transferWith) / 2,
      comments: transactions.reduce((s, t) => s + (Array.isArray(t.comments) ? t.comments.length : 0), 0),
      skippedDuplicates: count((t) => t.skippedDuplicateOf),
      trackedBalances: accounts.filter((a) => a.startingBalance).length,
    },
  };
}
