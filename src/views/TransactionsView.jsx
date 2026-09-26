import React, { useMemo, useState } from "react";
import { EmptyState, StatBlock } from "../components/common.jsx";
import { buildCategorySuggestions } from "../lib/analysis.js";
import { formatMonthLabel, getMonthStartISO } from "../lib/periods.js";
import { formatDateDisplay, formatMoney, parseMoney } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Transactions view                                                    */
/* ------------------------------------------------------------------ */

export function TransactionRow({ t, duplicateInfo, expanded, onToggleExpand, allTransactions, categories, onUpdate, onDelete, suggestedCategoryId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    date: t.date || "",
    description: t.description || "",
    amountOut: t.amountOut != null ? String(t.amountOut) : "",
    amountIn: t.amountIn != null ? String(t.amountIn) : "",
    budgetPeriodOverride: t.budgetPeriodOverride || "",
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const isDup = duplicateInfo.dupIds.has(t.id);
  const categoryName = t.categoryId ? categories.find((c) => c.id === t.categoryId)?.name || "Unknown" : null;
  const suggestedName = suggestedCategoryId ? categories.find((c) => c.id === suggestedCategoryId)?.name || null : null;
  const primaryAmount = t.amountOut != null ? -t.amountOut : t.amountIn != null ? t.amountIn : null;

  function startEdit() {
    setDraft({
      date: t.date || "",
      description: t.description || "",
      amountOut: t.amountOut != null ? String(t.amountOut) : "",
      amountIn: t.amountIn != null ? String(t.amountIn) : "",
      budgetPeriodOverride: t.budgetPeriodOverride || "",
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
      budgetPeriodOverride: draft.budgetPeriodOverride || null,
    });
    setEditing(false);
  }

  const dupKey = duplicateInfo.keyByTxId[t.id];
  const others = dupKey
    ? duplicateInfo.groupByKey[dupKey].filter((id) => id !== t.id).map((id) => allTransactions.find((x) => x.id === id)).filter(Boolean)
    : [];

  return (
    <>
      <tr className="tx-row-compact" onClick={() => setMobileExpanded((e) => !e)}>
        <td colSpan={8}>
          <div className="tx-compact-line">
            <span className="tx-compact-date">{formatDateDisplay(t.date)}</span>
            <span className="tx-compact-desc">{t.description || "—"}</span>
            <span className={"tx-compact-amount " + (primaryAmount == null ? "" : primaryAmount < 0 ? "money-out" : "money-in")}>
              {primaryAmount == null ? "—" : formatMoney(primaryAmount)}
            </span>
            <button
              type="button"
              className="mobile-expand-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setMobileExpanded((v) => !v);
              }}
              aria-label={mobileExpanded ? "Show less" : "Show more"}
            >
              {mobileExpanded ? "▲" : "▼"}
            </button>
          </div>
          <div className="tx-compact-subline">
            {categoryName ? (
              categoryName
            ) : suggestedName ? (
              <span className="tx-compact-suggested">Suggested: {suggestedName}</span>
            ) : (
              <span className="muted-cell">Uncategorized</span>
            )}
            {" · "}
            {t.accountName}
            {isDup && <span className="badge" style={{ marginLeft: 6 }}>possible duplicate</span>}
          </div>
        </td>
      </tr>
      <tr className={"tx-row-full" + (mobileExpanded ? " mobile-expanded" : "")}>
        <td data-label="Date">
          {editing ? (
            <>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
              <div style={{ marginTop: 6 }}>
                <label className="muted-cell" style={{ fontSize: 11, display: "block", marginBottom: 2 }}>
                  Counts toward budget period:
                </label>
                <input
                  type="date"
                  style={{ width: 130 }}
                  value={draft.budgetPeriodOverride}
                  onChange={(e) => setDraft({ ...draft, budgetPeriodOverride: e.target.value })}
                />
                {draft.budgetPeriodOverride && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 4 }}
                    onClick={() => setDraft({ ...draft, budgetPeriodOverride: "" })}
                  >
                    Clear
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {formatDateDisplay(t.date)}
              {t.budgetPeriodOverride && (
                <div className="muted-cell" style={{ fontSize: 11 }}>
                  counts toward {formatMonthLabel(getMonthStartISO(t.budgetPeriodOverride))}
                </div>
              )}
            </>
          )}
        </td>
        <td className="desc-cell" data-label="Description" title={t.description || ""}>
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
        <td data-label="Account">{t.accountName}</td>
        <td data-label="Money out">
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
        <td data-label="Money in">
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
        <td data-label="Category">
          {(() => {
            const isSuggestion = !t.categoryId && suggestedCategoryId;
            return (
              <div className="category-cell">
                <select
                  className={isSuggestion ? "category-select suggested" : "category-select"}
                  value={t.categoryId || (isSuggestion ? suggestedCategoryId : "")}
                  onChange={(e) => onUpdate(t.id, { categoryId: e.target.value || null })}
                  title={isSuggestion ? "Suggested based on how you've categorized this before — pick a category to confirm or change it" : undefined}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {isSuggestion && (
                  <button
                    type="button"
                    className="suggested-confirm-btn"
                    title="Accept this suggested category"
                    onClick={() => onUpdate(t.id, { categoryId: suggestedCategoryId })}
                  >
                    ✓ Suggested
                  </button>
                )}
              </div>
            );
          })()}
        </td>
        <td className="no-label-cell">
          {isDup && (
            <div className="dup-cell">
              <span className="badge" onClick={() => onToggleExpand(t.id)}>
                possible duplicate {expanded ? "▲" : "▼"}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(t.id, { notDuplicate: true })}>
                Not a duplicate
              </button>
            </div>
          )}
        </td>
        <td className="no-label-cell">
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


export function TransactionsView({ transactions, accounts, categories, duplicateInfo, onUpdate, onDelete, onGoUpload }) {
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [dupOnly, setDupOnly] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [dateSortDir, setDateSortDir] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterBatchId, setFilterBatchId] = useState("all");

  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(transactions, categories),
    [transactions, categories]
  );

  // The last several distinct uploads, newest first — surfaced by date/
  // account/count so a person can jump straight to "what I just
  // imported" without ever seeing or needing the underlying batch id.
  const recentBatches = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      if (!t.uploadBatchId) return;
      if (!map[t.uploadBatchId]) {
        map[t.uploadBatchId] = { batchId: t.uploadBatchId, uploadedAt: t.uploadedAt, accountNames: new Set(), count: 0 };
      }
      map[t.uploadBatchId].count += 1;
      if (t.accountName) map[t.uploadBatchId].accountNames.add(t.accountName);
    });
    return Object.values(map)
      .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))
      .slice(0, 10);
  }, [transactions]);

  function formatBatchLabel(batch) {
    const dt = batch.uploadedAt ? new Date(batch.uploadedAt) : null;
    const dateStr = dt
      ? dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
      : "Unknown time";
    const accountStr = [...batch.accountNames].join(", ");
    return `${dateStr} — ${accountStr} (${batch.count})`;
  }

  const filtered = useMemo(() => {
    let list = transactions;
    if (filterAccount !== "all") list = list.filter((t) => t.accountId === filterAccount);
    if (filterCategory === "uncategorized") list = list.filter((t) => !t.categoryId);
    else if (filterCategory !== "all") list = list.filter((t) => t.categoryId === filterCategory);
    if (dupOnly) list = list.filter((t) => duplicateInfo.dupIds.has(t.id));
    if (filterBatchId !== "all") list = list.filter((t) => t.uploadBatchId === filterBatchId);
    if (dateFrom) list = list.filter((t) => t.date && t.date >= dateFrom);
    if (dateTo) list = list.filter((t) => t.date && t.date <= dateTo);
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
  }, [transactions, filterAccount, filterCategory, dupOnly, filterBatchId, search, duplicateInfo, dateSortDir, dateFrom, dateTo]);

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
  const uncategorizedCount = transactions.filter((t) => !t.categoryId).length;

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
        {recentBatches.length > 0 && (
          <select value={filterBatchId} onChange={(e) => setFilterBatchId(e.target.value)}>
            <option value="all">All transactions</option>
            {recentBatches.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {formatBatchLabel(b)}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={filterCategory === "uncategorized"}
            onChange={(e) => setFilterCategory(e.target.checked ? "uncategorized" : "all")}
          />
          Uncategorized only ({uncategorizedCount})
        </label>
        <label className="checkbox-filter">
          <input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} />
          Possible duplicates only ({duplicateInfo.dupIds.size})
        </label>
        <label className="checkbox-filter" style={{ gap: 8 }}>
          Between
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          and
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          {(dateFrom || dateTo) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear
            </button>
          )}
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
                suggestedCategoryId={categorySuggestions.get(t.id) || null}
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
/* Post-upload categorization                                          */
/* ------------------------------------------------------------------ */

export function PostUploadCategorizeView({ transactions, batchId, accountName, categories, duplicateInfo, onUpdate, onDelete, onSkip }) {
  const [expandedId, setExpandedId] = useState(null);
  const batchTransactions = useMemo(
    () => transactions.filter((t) => t.uploadBatchId === batchId),
    [transactions, batchId]
  );
  const uncategorizedCount = batchTransactions.filter((t) => !t.categoryId).length;
  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(transactions, categories),
    [transactions, categories]
  );

  if (batchTransactions.length === 0) {
    return (
      <EmptyState
        title="Nothing left to categorize here"
        body="This import doesn't have anything left to show — it may have already been categorized or removed."
        ctaLabel="Go to Transactions"
        onCta={onSkip}
      />
    );
  }

  return (
    <div>
      <div className="view-header">
        <h1>Categorize your import</h1>
        <p>
          {batchTransactions.length} transaction{batchTransactions.length === 1 ? "" : "s"} just imported into{" "}
          <strong>{accountName}</strong> — sort them into categories now, or skip and handle it later from
          Transactions. Uploading another file works fine from here too; this batch will still be waiting when
          you come back.
        </p>
      </div>

      <div className="summary-row">
        <StatBlock value={batchTransactions.length} label="Just imported" />
        <StatBlock value={uncategorizedCount} label="Still uncategorized" />
      </div>

      <div className="actions-row" style={{ marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={onSkip}>
          Skip for now
        </button>
      </div>

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tx-table">
          <thead>
            <tr>
              <th>Date</th>
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
            {batchTransactions.map((t) => (
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
                suggestedCategoryId={categorySuggestions.get(t.id) || null}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="actions-row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={onSkip}>
          Done — go to Transactions
        </button>
      </div>
    </div>
  );
}
