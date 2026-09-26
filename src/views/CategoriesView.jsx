import React, { useState } from "react";
import { computeItemFundBalance } from "../lib/budget.js";
import { formatMoney, findNameClash } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Categories view                                                      */
/* ------------------------------------------------------------------ */

export function CategoryCard({ category, categories, txCount, transactions, onRename, onDelete, onToggleExcluded, onToggleIsIncome, onMerge }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeConfirming, setMergeConfirming] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const otherCategories = categories.filter((c) => c.id !== category.id);

  function startEdit() {
    setDraftName(category.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    const clash = findNameClash(categories, trimmed, category.id);
    if (clash) {
      setRenameError(`There's already a category called "${clash.name}".`);
      return;
    }
    if (trimmed && trimmed !== category.name) onRename(category.id, trimmed);
    setRenameError(null);
    setEditing(false);
  }

  function startMerge() {
    setMergeTargetId(otherCategories[0]?.id || "");
    setMergeConfirming(false);
    setMerging(true);
  }

  function handleConfirmMerge() {
    if (!mergeTargetId) return;
    onMerge(category.id, mergeTargetId);
  }

  const mergeTarget = otherCategories.find((c) => c.id === mergeTargetId);

  return (
    <div className="account-card category-card">
      <div className="category-card-info">
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
          
              {renameError && (
                <p className="hint" role="alert" style={{ color: "var(--danger)", margin: "4px 0 0" }}>
                  {renameError}
                </p>
              )}
          </div>
        ) : (
          <div className="name">
            {category.name}
            <button className="btn btn-ghost btn-sm" onClick={startEdit}>
              Rename
            </button>
            <button
              type="button"
              className="mobile-expand-toggle"
              style={{ marginLeft: "auto" }}
              onClick={() => setMobileExpanded((v) => !v)}
              aria-label={mobileExpanded ? "Show less" : "Show more"}
            >
              {mobileExpanded ? "▲" : "▼"}
            </button>
          </div>
        )}
        <div className="meta">
          {txCount} transaction{txCount === 1 ? "" : "s"}
        </div>
        <div className={"category-extra" + (mobileExpanded ? " mobile-expanded" : "")}>
          <label className="radio-option" style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-muted)" }}>
            <input
              type="checkbox"
              checked={!!category.excluded}
              onChange={(e) => onToggleExcluded(category.id, e.target.checked)}
            />
            Exclude from totals &amp; reports (e.g. transfers between your own accounts)
          </label>
          <label className="radio-option" style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-muted)" }}>
            <input
              type="checkbox"
              checked={!!category.isIncome}
              onChange={(e) => onToggleIsIncome(category.id, e.target.checked)}
            />
            This is income (paycheck, etc.) — never counts as unassigned spending
          </label>
        </div>
      </div>
      <div className={"row-actions category-actions" + (mobileExpanded ? " mobile-expanded" : "")}>
        {merging ? (
          mergeConfirming ? (
            <span className="confirm-inline">
              Move {txCount} transaction{txCount === 1 ? "" : "s"} into "{mergeTarget?.name}" and delete "
              {category.name}"?
              <button className="btn btn-danger btn-sm" onClick={handleConfirmMerge}>
                Confirm
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMergeConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <span className="row-actions">
              <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                {otherCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setMergeConfirming(true)}
                disabled={!mergeTargetId}
              >
                Merge
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMerging(false)}>
                Cancel
              </button>
            </span>
          )
        ) : confirming ? (
          <span className="confirm-inline">
            Delete this category?{txCount > 0 ? ` ${txCount} transaction${txCount === 1 ? "" : "s"} will become uncategorized.` : ""}
            {category.budgetType === "accumulate" &&
              (() => {
                const balance = computeItemFundBalance(category, new Set([category.id]), transactions || []);
                return Math.abs(balance) > 0.01 ? (
                  <strong style={{ color: "var(--expense)" }}>
                    {" "}
                    This fund currently shows {formatMoney(balance)} — deleting it won't move that money
                    anywhere, it'll just stop being tracked.
                  </strong>
                ) : null;
              })()}
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(category.id)}>
              Confirm
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={startMerge} disabled={otherCategories.length === 0}>
              Merge into…
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}


export function CategoriesView({ categories, transactions, onAdd, onRename, onDelete, onToggleExcluded, onToggleIsIncome, onMerge }) {
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState(null);

  function handleAdd(e) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const clash = findNameClash(categories, trimmed);
    if (clash) {
      setAddError(`There's already a category called "${clash.name}".`);
      return;
    }
    onAdd(trimmed);
    setNewName("");
    setAddError(null);
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
            onChange={(e) => {
              setNewName(e.target.value);
              setAddError(null);
            }}
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
        {addError && (
          <p className="hint" role="alert" style={{ color: "var(--danger)", marginTop: -8, marginBottom: 14 }}>
            {addError}
          </p>
        )}

        {categories.length === 0 ? (
          <div className="hint">No categories yet — add your first one above.</div>
        ) : (
          categories.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              categories={categories}
              txCount={transactions.filter((t) => t.categoryId === cat.id).length}
              transactions={transactions}
              onRename={onRename}
              onDelete={onDelete}
              onToggleExcluded={onToggleExcluded}
              onToggleIsIncome={onToggleIsIncome}
              onMerge={onMerge}
            />
          ))
        )}
      </div>
    </div>
  );
}
