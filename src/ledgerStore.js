// src/ledgerStore.js
// Everything the app needs to read and write household data in the
// relational tables (accounts, categories, budget_groups, transactions,
// household_settings).
//
// The app itself keeps working with the same data shape it always has:
// arrays of accounts, categories, budget groups, and transactions, plus a
// few settings. This file translates between that shape and database
// rows, and figures out which rows actually changed, so each save sends
// only what's different.

import { supabase } from "./supabaseClient.js";

/* ------------------------------------------------------------------ */
/* Translating between app items and database rows                     */
/* ------------------------------------------------------------------ */

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

// App fields that have their own database column. Anything else an item
// carries is kept in its "props" column, so no field is ever lost.
const ACCOUNT_FIELDS = ["id", "name"];
const CATEGORY_FIELDS = ["id", "name", "excluded", "isIncome"];
const GROUP_FIELDS = ["id", "name", "categoryIds"];
const TRANSACTION_FIELDS = [
  "id", "accountId", "accountName", "categoryId", "date", "description",
  "amountOut", "amountIn", "uploadBatchId", "uploadedAt", "raw",
];
const SETTINGS_FIELDS = ["plannedIncome", "incomeWarningDismissed", "hiddenBudgetMonths", "excludeUnassignedFromBudget"];

export function accountToRow(a, index) {
  return { id: a.id, name: a.name ?? "", sort_order: index, props: omit(a, ACCOUNT_FIELDS) };
}

export function categoryToRow(c, index) {
  return {
    id: c.id,
    name: c.name ?? "",
    excluded: !!c.excluded,
    is_income: !!c.isIncome,
    sort_order: index,
    props: omit(c, CATEGORY_FIELDS),
  };
}

export function groupToRow(g, index) {
  return {
    id: g.id,
    name: g.name ?? "",
    sort_order: index,
    category_ids: Array.isArray(g.categoryIds) ? g.categoryIds : [],
    props: omit(g, GROUP_FIELDS),
  };
}

export function transactionToRow(t) {
  return {
    id: t.id,
    account_id: t.accountId,
    category_id: t.categoryId ?? null,
    date: t.date ?? null,
    description: t.description ?? "",
    amount_out: t.amountOut ?? null,
    amount_in: t.amountIn ?? null,
    upload_batch_id: t.uploadBatchId ?? null,
    uploaded_at: t.uploadedAt ?? null,
    raw: t.raw ?? null,
    // accountName isn't stored: it always comes from the account itself.
    props: omit(t, TRANSACTION_FIELDS),
  };
}

function settingsOf(snapshot) {
  const out = {};
  for (const k of SETTINGS_FIELDS) out[k] = snapshot[k];
  return out;
}

// Postgres "numeric" values are exact decimals; the app uses plain numbers.
const toNumber = (v) => (v === null || v === undefined ? null : Number(v));

function rowsToLedger({ accounts, categories, groups, links, transactions, settings }) {
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const groupCategories = new Map();
  for (const l of links) {
    if (!groupCategories.has(l.group_id)) groupCategories.set(l.group_id, []);
    groupCategories.get(l.group_id).push(l.category_id);
  }
  return {
    accounts: accounts.map((a) => ({ ...a.props, id: a.id, name: a.name })),
    categories: categories.map((c) => ({
      ...c.props,
      id: c.id,
      name: c.name,
      excluded: c.excluded,
      isIncome: c.is_income,
    })),
    budgetGroups: groups.map((g) => ({
      ...g.props,
      id: g.id,
      name: g.name,
      categoryIds: groupCategories.get(g.id) || [],
    })),
    transactions: transactions.map((t) => {
      const tx = {
        ...t.props,
        id: t.id,
        accountId: t.account_id,
        accountName: accountName.get(t.account_id) ?? "",
        categoryId: t.category_id,
        date: t.date,
        description: t.description,
        amountOut: toNumber(t.amount_out),
        amountIn: toNumber(t.amount_in),
        raw: t.raw,
      };
      if (t.upload_batch_id !== null) tx.uploadBatchId = t.upload_batch_id;
      if (t.uploaded_at !== null) tx.uploadedAt = t.uploaded_at;
      return tx;
    }),
    ...(settings ? settings.props : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

// Supabase returns at most 1,000 rows per request by default, so large
// tables are fetched a page at a time until everything has arrived.
const PAGE_SIZE = 1000;

async function fetchAll(table, columns, orderBy) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(columns);
    for (const col of orderBy) query = query.order(col, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE_SIZE) return all;
  }
}

// Returns { data, settingsSaved, version }:
//   data           the household's ledger, in the app's usual shape
//   settingsSaved  false for a household that has never saved anything
//   version        the household's change counter at load time
// Security rules limit every query to the signed-in person's household.
export async function loadLedger() {
  const [accounts, categories, groups, links, transactions, settingsRes, versionRes] = await Promise.all([
    fetchAll("accounts", "id, name, sort_order, props", ["sort_order", "id"]),
    fetchAll("categories", "id, name, excluded, is_income, sort_order, props", ["sort_order", "id"]),
    fetchAll("budget_groups", "id, name, sort_order, props", ["sort_order", "id"]),
    fetchAll("budget_group_categories", "group_id, category_id, position", ["group_id", "position"]),
    fetchAll(
      "transactions",
      "id, account_id, category_id, date, description, amount_out, amount_in, upload_batch_id, uploaded_at, raw, props",
      ["date", "id"]
    ),
    supabase.from("household_settings").select("props").maybeSingle(),
    supabase.from("households").select("data_version").maybeSingle(),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (versionRes.error) throw versionRes.error;
  const settings = settingsRes.data;
  return {
    data: rowsToLedger({ accounts, categories, groups, links, transactions, settings }),
    settingsSaved: !!settings,
    version: versionRes.data ? versionRes.data.data_version : null,
  };
}

// Just the change counter: a cheap way to ask "has anything changed?"
export async function fetchLedgerVersion() {
  const { data, error } = await supabase.from("households").select("data_version").maybeSingle();
  if (error) throw error;
  return data ? data.data_version : null;
}

/* ------------------------------------------------------------------ */
/* Working out what changed                                             */
/* ------------------------------------------------------------------ */

// Compare two rows by content. The JSON round trip drops "undefined"
// fields, and the comparison ignores key order.
function sameContent(a, b) {
  return deepEqualJson(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}

function deepEqualJson(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqualJson(a[k], b[k]));
}

// Compares what was last saved ("base") with what the app has now
// ("next") and returns only the differences, in the shape the database's
// apply_ledger_changes function expects. Items the app hasn't touched are
// the very same objects in both, which makes checking them nearly free.
export function computeLedgerChanges(base, next) {
  const upserts = {};
  const deletes = {};

  function diff(table, baseItems, nextItems, toRow) {
    const baseById = new Map();
    (baseItems || []).forEach((item, index) => baseById.set(item.id, { item, index }));
    const changed = [];
    (nextItems || []).forEach((item, index) => {
      const before = baseById.get(item.id);
      if (before && before.item === item && before.index === index) return; // untouched
      const row = toRow(item, index);
      if (before && sameContent(toRow(before.item, before.index), row)) return;
      changed.push(row);
    });
    const nextIds = new Set((nextItems || []).map((i) => i.id));
    const removed = [...baseById.keys()].filter((id) => !nextIds.has(id));
    if (changed.length) upserts[table] = changed;
    if (removed.length) deletes[table] = removed;
  }

  diff("accounts", base.accounts, next.accounts, accountToRow);
  diff("categories", base.categories, next.categories, categoryToRow);
  diff("budget_groups", base.budgetGroups, next.budgetGroups, groupToRow);
  diff("transactions", base.transactions, next.transactions, transactionToRow);

  const changes = {};
  if (Object.keys(upserts).length) changes.upserts = upserts;
  if (Object.keys(deletes).length) changes.deletes = deletes;
  if (!base.settingsSaved || !sameContent(settingsOf(base), settingsOf(next))) {
    changes.settings = { props: settingsOf(next) };
  }
  return changes;
}

export function hasChanges(changes) {
  return Object.keys(changes).length > 0;
}

/* ------------------------------------------------------------------ */
/* Saving                                                               */
/* ------------------------------------------------------------------ */

// Sends the changes; returns the household's new change counter.
// Everything in one call succeeds or fails together.
export async function saveLedgerChanges(changes) {
  const { data, error } = await supabase.rpc("apply_ledger_changes", { p_changes: changes });
  if (error) throw error;
  return data;
}
