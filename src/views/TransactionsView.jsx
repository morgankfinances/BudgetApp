import React, { useEffect, useMemo, useState } from "react";
import { EmptyState, StatBlock } from "../components/common.jsx";
import { buildCategorySuggestions, isUnconfirmedSuggestion } from "../lib/analysis.js";
import { formatMonthLabel, getMonthStartISO } from "../lib/periods.js";
import { formatDateDisplay, formatMoney, parseMoney } from "../lib/utils.js";
import { SplitEditor } from "../components/SplitEditor.jsx";
import { hasSplits, isUncategorized } from "../lib/splits.js";
import { CommentThread } from "../components/CommentThread.jsx";

/* ------------------------------------------------------------------ */
/* Transactions view                                                    */
/* ------------------------------------------------------------------ */

// How many rows show at once; "Show more" adds this many again.
export const ROW_LIMIT = 200;

export function TransactionRow({ t, duplicateInfo, expanded, onToggleExpand, allTransactions, categories, onUpdate, onDelete, suggestedCategoryId, onUnlinkTransfer, onSetSplits, comments = null }) {
  const [editing, setEditing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const commentCount = Array.isArray(t.comments) ? t.comments.length : 0;
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
            {commentCount > 0 && <span className="tx-compact-comments">💬 {commentCount} · </span>}
            {hasSplits(t) ? (
              <span>Split · {t.splits.length} categories</span>
            ) : categoryName && isUnconfirmedSuggestion(t) ? (
              <span className="tx-compact-suggested">Suggested: {categoryName}</span>
            ) : categoryName ? (
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
            if (hasSplits(t)) {
              const name = (id) => (categories.find((c) => c.id === id) || {}).name || "Uncategorized";
              return (
                <div className="split-summary">
                  <span>
                    Split: {t.splits.map((sp) => `${name(sp.categoryId)} ${formatMoney(sp.amount)}`).join(", ")}
                  </span>
                  {onSetSplits && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setSplitting(!splitting)} aria-expanded={splitting}>
                      Edit split
                    </button>
                  )}
                </div>
              );
            }
            // Filled in automatically and not yet confirmed; counts already.
            const isApplied = isUnconfirmedSuggestion(t);
            // Suggested but not filled in (automatic suggestions turned off).
            const isSuggestion = !t.categoryId && suggestedCategoryId;
            return (
              <div className="category-cell">
                <select aria-label={`Category for ${t.description || "transaction"}`}
                  className={isApplied || isSuggestion ? "category-select suggested" : "category-select"}
                  value={t.categoryId || (isSuggestion ? suggestedCategoryId : "")}
                  onChange={(e) => onUpdate(t.id, { categoryId: e.target.value || null })}
                  title={
                    isApplied
                      ? "Filled in from how you've categorized this before. Confirm it, or pick a different category."
                      : isSuggestion
                        ? "Suggested based on how you've categorized this before — pick a category to confirm or change it"
                        : undefined
                  }
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {isApplied && (
                  <button
                    type="button"
                    className="suggested-confirm-btn"
                    aria-label={`Confirm suggested category for ${t.description || "transaction"}`}
                    onClick={() => onUpdate(t.id, { categoryId: t.categoryId })}
                  >
                    ✓ Confirm
                  </button>
                )}
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
          {t.transferWith && (() => {
            const partner = (allTransactions || []).find((o) => o.id === t.transferWith);
            return (
              <div className="dup-cell">
                <span className="transfer-tag" title="Money moved between your own accounts: not counted as spending or income.">
                  ↔ Transfer {t.amountOut != null ? "to" : "from"} {partner ? partner.accountName : "another account"}
                </span>
                {onUnlinkTransfer && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onUnlinkTransfer(t.id)}
                    aria-label={`Unpair this transfer: ${t.description || "transaction"}`}
                  >
                    Unpair
                  </button>
                )}
              </div>
            );
          })()}
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
              {comments && (
                <button
                  className="btn btn-ghost btn-sm comment-btn"
                  onClick={() => setShowComments(!showComments)}
                  aria-expanded={showComments}
                  aria-label={`${commentCount ? `${commentCount} comment${commentCount === 1 ? "" : "s"}` : "Comment"} on ${t.description || "this transaction"}`}
                >
                  💬{commentCount ? ` ${commentCount}` : ""}
                </button>
              )}
              {onSetSplits && !t.transferWith && !hasSplits(t) && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSplitting(!splitting)}
                  aria-expanded={splitting}
                  aria-label={`Split ${t.description || "this transaction"} among categories`}
                >
                  Split
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            </div>
          )}
        </td>
      </tr>
      {splitting && onSetSplits && (
        <tr className="split-row">
          <td colSpan={8}>
            <SplitEditor
              t={t}
              categories={categories}
              onSave={(splits) => {
                onSetSplits(t.id, splits);
                setSplitting(false);
              }}
              onCancel={() => setSplitting(false)}
            />
          </td>
        </tr>
      )}
      {showComments && comments && (
        <tr className="split-row">
          <td colSpan={8}>
            <CommentThread
              t={t}
              currentUserId={comments.currentUserId}
              members={comments.members}
              onAdd={comments.onAdd}
              onDelete={comments.onDelete}
              onClose={() => setShowComments(false)}
            />
          </td>
        </tr>
      )}
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


export function TransactionsView({ transactions, accounts, categories, duplicateInfo, onUpdate, onDelete, onGoUpload, autoApplySuggestions = true, onConfirmSuggestions, onApplySuggestions, skippedDuplicates = [], onRestoreSkipped, onDeleteSkipped, duplicateHandling = "skip", transferPairs = [], onLinkTransfers, onDismissTransfer, onUnlinkTransfer, onSetSplits, comments = null, pageSize = ROW_LIMIT }) {
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [dupOnly, setDupOnly] = useState(false);
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showTransfers, setShowTransfers] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [dateSortDir, setDateSortDir] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterBatchId, setFilterBatchId] = useState("all");

  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(transactions, categories),
    [transactions, categories]
  );
  const unconfirmedCount = useMemo(() => transactions.filter(isUnconfirmedSuggestion).length, [transactions]);
  const pendingSuggestionCount = categorySuggestions.size;

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

  // Browsing shows one month at a time (starting with the newest month that
  // has anything). Searching, or filters for finding particular things, look
  // across all time instead, so an upload spanning two months stays together.
  const newestMonth = useMemo(
    () => transactions.reduce((m, t) => (t.date && t.date.slice(0, 7) > m ? t.date.slice(0, 7) : m), ""),
    [transactions]
  );
  const [pickedMonth, setPickedMonth] = useState(null);
  const shownMonth = pickedMonth || newestMonth;
  const findingAcrossAllTime =
    !!search.trim() || filterBatchId !== "all" || !!dateFrom || !!dateTo || dupOnly || suggestedOnly || filterCategory === "uncategorized";
  const stepMonth = (delta) => {
    const [y, m] = shownMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    setPickedMonth(next >= newestMonth ? null : next);
  };
  const monthLabel = (ym) =>
    ym ? new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const shortMonth = (delta) => {
    const [y, m] = shownMonth.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + delta, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };

  // At most this many rows at once; "Show more" adds more.
  const [rowLimit, setRowLimit] = useState(pageSize);
  useEffect(() => {
    setRowLimit(pageSize);
  }, [shownMonth, findingAcrossAllTime, filterAccount, filterCategory, search, filterBatchId, dateFrom, dateTo, pageSize]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (!findingAcrossAllTime && shownMonth) list = list.filter((t) => t.date && t.date.slice(0, 7) === shownMonth);
    if (filterAccount !== "all") list = list.filter((t) => t.accountId === filterAccount);
    if (filterCategory === "uncategorized") list = list.filter(isUncategorized);
    else if (filterCategory !== "all")
      list = list.filter((t) => t.categoryId === filterCategory || (hasSplits(t) && t.splits.some((sp) => sp.categoryId === filterCategory)));
    if (dupOnly) list = list.filter((t) => duplicateInfo.dupIds.has(t.id));
    if (suggestedOnly) list = list.filter(isUnconfirmedSuggestion);
    if (filterBatchId !== "all") list = list.filter((t) => t.uploadBatchId === filterBatchId);
    if (dateFrom) list = list.filter((t) => t.date && t.date >= dateFrom);
    if (dateTo) list = list.filter((t) => t.date && t.date <= dateTo);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const haystack = [t.accountName, t.date, t.description, ...Object.values(t.raw || {}).map(String), ...(t.comments || []).map((c) => c.text)]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    const dir = dateSortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => (a.date < b.date ? -dir : a.date > b.date ? dir : 0));
  }, [transactions, shownMonth, findingAcrossAllTime, filterAccount, filterCategory, dupOnly, suggestedOnly, filterBatchId, search, duplicateInfo, dateSortDir, dateFrom, dateTo]);

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
  const uncategorizedCount = transactions.filter(isUncategorized).length;

  return (
    <div>
      <div className="view-header">
        <h1>Transactions</h1>
        <p>Everything you've imported, combined in one place.</p>
      </div>

      {newestMonth && (
        <div className="period-stepper" role="group" aria-label="Month shown">
          {findingAcrossAllTime ? (
            <span className="hint" aria-live="polite">
              Showing matches from all time: searching and these filters look beyond one month.
            </span>
          ) : (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => stepMonth(-1)} aria-label={`Show the previous month, ${shortMonth(-1)}`}>
                ‹ {shortMonth(-1)}
              </button>
              <span className="period-stepper-current" aria-live="polite">
                {monthLabel(shownMonth)}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => stepMonth(1)} disabled={shownMonth >= newestMonth} aria-label={`Show the next month, ${shortMonth(1)}`}>
                {shortMonth(1)} ›
              </button>
              {shownMonth !== newestMonth && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPickedMonth(null)}>
                  Newest
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="summary-row">
        <StatBlock value={filtered.length} label="Transactions shown" />
        <StatBlock value={formatMoney(totalIn)} label="Money in" />
        <StatBlock value={formatMoney(totalOut)} label="Money out" />
        <StatBlock value={formatMoney(totalIn - totalOut)} label="Net" />
      </div>

      <div className="filter-bar">
        <select aria-label="Filter by account" value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by category" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {recentBatches.length > 0 && (
          <select aria-label="Filter by upload" value={filterBatchId} onChange={(e) => setFilterBatchId(e.target.value)}>
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
        {duplicateHandling !== "off" && (
          <label className="checkbox-filter">
            <input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} />
            Possible duplicates only ({duplicateInfo.dupIds.size})
          </label>
        )}
        {(unconfirmedCount > 0 || suggestedOnly) && (
          <label className="checkbox-filter">
            <input type="checkbox" checked={suggestedOnly} onChange={(e) => setSuggestedOnly(e.target.checked)} />
            Suggested, not yet confirmed ({unconfirmedCount})
          </label>
        )}
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

      {transferPairs.length > 0 && (
        <div className="suggest-banner transfer-panel" role="region" aria-label="Possible transfers">
          <div className="suggest-banner-row">
            <span>
              <strong>
                {transferPairs.length} possible transfer{transferPairs.length === 1 ? "" : "s"} between your accounts.
              </strong>{" "}
              Money moving between your own accounts isn't spending or income. Marking these as transfers keeps them from
              being counted twice.
            </span>
            <span className="skipped-item-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={showTransfers}
                aria-controls="transfer-list"
                onClick={() => setShowTransfers(!showTransfers)}
              >
                {showTransfers ? "Hide" : "Review"}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onLinkTransfers && onLinkTransfers(transferPairs)}>
                Mark all {transferPairs.length} as transfers
              </button>
            </span>
          </div>
          {showTransfers && (
            <ul className="skipped-list" id="transfer-list">
              {transferPairs.map((pair) => {
                const out = transactions.find((t) => t.id === pair.outId);
                const into = transactions.find((t) => t.id === pair.inId);
                if (!out || !into) return null;
                return (
                  <li key={`${pair.outId}-${pair.inId}`} className="skipped-item">
                    <span className="transfer-pair">
                      <span>
                        <strong>−{formatMoney(out.amountOut)}</strong> from {out.accountName}
                        <span className="hint" style={{ display: "block" }}>
                          {formatDateDisplay(out.date)} · {out.description || "(no description)"}
                        </span>
                      </span>
                      <span aria-hidden="true" className="transfer-arrow">→</span>
                      <span>
                        <strong>+{formatMoney(into.amountIn)}</strong> into {into.accountName}
                        <span className="hint" style={{ display: "block" }}>
                          {formatDateDisplay(into.date)} · {into.description || "(no description)"}
                        </span>
                      </span>
                    </span>
                    <span className="skipped-item-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onLinkTransfers && onLinkTransfers([pair])}
                        aria-label={`Mark as transfer: ${formatMoney(out.amountOut)} from ${out.accountName} to ${into.accountName}, ${formatDateDisplay(out.date)}`}
                      >
                        Mark as transfer
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => onDismissTransfer && onDismissTransfer(pair)}
                        aria-label={`Not a transfer: ${formatMoney(out.amountOut)} from ${out.accountName} to ${into.accountName}, ${formatDateDisplay(out.date)}`}
                      >
                        Not a transfer
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {skippedDuplicates.length > 0 && (
        <div className="skipped-panel">
          <button
            type="button"
            className="skipped-toggle"
            aria-expanded={showSkipped}
            aria-controls="skipped-list"
            onClick={() => setShowSkipped(!showSkipped)}
          >
            {showSkipped ? "▾" : "▸"} Skipped duplicates ({skippedDuplicates.length})
          </button>
          <span className="hint"> Set aside during imports because they matched transactions already here.</span>
          {showSkipped && (
            <div id="skipped-list">
              <div className="skipped-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => onRestoreSkipped && onRestoreSkipped()}>
                  Restore all
                </button>
                {confirmDeleteAll ? (
                  <>
                    <span className="hint">Delete all {skippedDuplicates.length} for good?</span>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setConfirmDeleteAll(false);
                        if (onDeleteSkipped) onDeleteSkipped();
                      }}
                    >
                      Yes, delete them
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteAll(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteAll(true)}>
                    Delete all
                  </button>
                )}
              </div>
              <ul className="skipped-list">
                {skippedDuplicates.map((t) => {
                  const original = transactions.find((o) => o.id === t.skippedDuplicateOf);
                  const amount = t.amountOut != null ? `−${formatMoney(t.amountOut)}` : `+${formatMoney(t.amountIn)}`;
                  return (
                    <li key={t.id} className="skipped-item">
                      <span>
                        <strong>{t.description || "(no description)"}</strong> · {formatDateDisplay(t.date)} · {amount} ·{" "}
                        {t.accountName}
                        <span className="hint" style={{ display: "block" }}>
                          {original
                            ? `Matched ${original.description} on ${formatDateDisplay(original.date)}${t.externalId && original.externalId ? " (same bank transaction ID)" : ""}.`
                            : "The transaction it matched has since been removed."}
                        </span>
                      </span>
                      <span className="skipped-item-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => onRestoreSkipped && onRestoreSkipped([t.id])}
                          aria-label={`Restore ${t.description}, ${formatDateDisplay(t.date)}`}
                        >
                          Restore
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => onDeleteSkipped && onDeleteSkipped([t.id])}
                          aria-label={`Delete ${t.description}, ${formatDateDisplay(t.date)}, for good`}
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {(unconfirmedCount > 0 || (autoApplySuggestions && pendingSuggestionCount > 0)) && (
        <div className="suggest-banner" role="status">
          {unconfirmedCount > 0 && (
            <div className="suggest-banner-row">
              <span>
                <strong>
                  {unconfirmedCount} categor{unconfirmedCount === 1 ? "y was" : "ies were"} filled in
                </strong>{" "}
                from your past choices and {unconfirmedCount === 1 ? "is" : "are"} marked Suggested. They already count
                toward budgets and reports.
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => onConfirmSuggestions && onConfirmSuggestions()}>
                Confirm all {unconfirmedCount}
              </button>
            </div>
          )}
          {autoApplySuggestions && pendingSuggestionCount > 0 && (
            <div className="suggest-banner-row">
              <span>
                <strong>
                  {pendingSuggestionCount} uncategorized transaction{pendingSuggestionCount === 1 ? " has" : "s have"} a
                  suggested category.
                </strong>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => onApplySuggestions && onApplySuggestions()}>
                Apply suggestions
              </button>
            </div>
          )}
        </div>
      )}

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
            {filtered.slice(0, rowLimit).map((t) => (
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
                onUnlinkTransfer={onUnlinkTransfer}
                onSetSplits={onSetSplits}
                comments={comments}
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
      {filtered.length > rowLimit && (
        <div className="actions-row" style={{ justifyContent: "center", marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setRowLimit(rowLimit + pageSize)}>
            Show {Math.min(pageSize, filtered.length - rowLimit)} more ({filtered.length - rowLimit} not shown yet)
          </button>
        </div>
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Post-upload categorization                                          */
/* ------------------------------------------------------------------ */

export function PostUploadCategorizeView({ transactions, batchId, accountName, categories, duplicateInfo, onUpdate, onDelete, onSkip, onConfirmSuggestions, onSetSplits, comments = null }) {
  const [expandedId, setExpandedId] = useState(null);
  const batchTransactions = useMemo(
    () => transactions.filter((t) => t.uploadBatchId === batchId),
    [transactions, batchId]
  );
  const uncategorizedCount = batchTransactions.filter(isUncategorized).length;
  const batchSuggested = batchTransactions.filter(isUnconfirmedSuggestion);
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
        {batchSuggested.length > 0 && <StatBlock value={batchSuggested.length} label="Suggested, to confirm" />}
      </div>

      <div className="actions-row" style={{ marginBottom: 16 }}>
        {batchSuggested.length > 0 && onConfirmSuggestions && (
          <button className="btn btn-primary" onClick={() => onConfirmSuggestions(batchSuggested.map((t) => t.id))}>
            Confirm all {batchSuggested.length} suggestion{batchSuggested.length === 1 ? "" : "s"}
          </button>
        )}
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
                onSetSplits={onSetSplits}
                comments={comments}
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
