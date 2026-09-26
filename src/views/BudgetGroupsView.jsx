import React, { useState } from "react";
import { computeItemFundBalance } from "../lib/budget.js";
import { findNameClash, formatMoney, parseMoney } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Budget groups view                                                   */
/* ------------------------------------------------------------------ */

export function BudgetGroupCard({ group, allGroups = [], allCategories, transactions, onRename, onSetBudget, onAddCategory, onRemoveCategory, onDelete }) {
  const [renameError, setRenameError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const [confirming, setConfirming] = useState(false);
  const [budgetAmountDraft, setBudgetAmountDraft] = useState(
    group.budgetAmount != null ? String(group.budgetAmount) : ""
  );
  const [budgetPeriodDraft, setBudgetPeriodDraft] = useState(group.budgetPeriod || "monthly");
  const [budgetTypeDraft, setBudgetTypeDraft] = useState(group.budgetType || "spend");
  const [accumulateTargetDraft, setAccumulateTargetDraft] = useState(
    group.accumulateTarget != null ? String(group.accumulateTarget) : ""
  );
  const [startDateDraft, setStartDateDraft] = useState(
    group.createdAt ? group.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [addCategoryId, setAddCategoryId] = useState("");

  const memberCategories = allCategories.filter((c) => (group.categoryIds || []).includes(c.id));
  const availableCategories = allCategories.filter((c) => !(group.categoryIds || []).includes(c.id));

  function startEdit() {
    setDraftName(group.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    const clash = findNameClash(allGroups, trimmed, group.id);
    if (clash) {
      setRenameError(`There's already a group called "${clash.name}".`);
      return;
    }
    if (trimmed && trimmed !== group.name) onRename(group.id, trimmed);
    setRenameError(null);
    setEditing(false);
  }

  function handleSaveBudget() {
    const trimmed = budgetAmountDraft.trim();
    const amount = trimmed === "" ? null : parseMoney(trimmed);
    const targetTrimmed = accumulateTargetDraft.trim();
    const target = targetTrimmed === "" ? null : parseMoney(targetTrimmed);
    onSetBudget(
      group.id,
      amount != null && amount > 0 ? amount : null,
      budgetPeriodDraft,
      budgetTypeDraft,
      target != null && target > 0 ? target : null,
      budgetTypeDraft === "accumulate" ? startDateDraft : null
    );
  }

  function handleAddCategory() {
    if (!addCategoryId) return;
    onAddCategory(group.id, addCategoryId);
    setAddCategoryId("");
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 10 }}>
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
          <div className="name" style={{ fontSize: 16 }}>
            {group.name}
            <button className="btn btn-ghost btn-sm" onClick={startEdit}>
              Rename
            </button>
          </div>
        )}
        {confirming ? (
          <span className="confirm-inline">
            Delete this group? Its categories stay — they just go back to being ungrouped.
            {group.budgetType === "accumulate" &&
              (() => {
                const balance = computeItemFundBalance(group, new Set(group.categoryIds || []), transactions || []);
                return Math.abs(balance) > 0.01 ? (
                  <strong style={{ color: "var(--expense)" }}>
                    {" "}
                    This fund currently shows {formatMoney(balance)} — deleting it won't move that money
                    anywhere, it'll just stop being tracked.
                  </strong>
                ) : null;
              })()}
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(group.id)}>
              Confirm
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
            Delete group
          </button>
        )}
      </div>

      <div className="hint" style={{ marginBottom: 8 }}>
        Categories in this group
      </div>
      {memberCategories.length === 0 ? (
        <div className="hint" style={{ marginBottom: 12 }}>
          None yet — add one below.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {memberCategories.map((c) => (
            <span className="group-chip" key={c.id}>
              {c.name}
              <button className="group-chip-remove" onClick={() => onRemoveCategory(group.id, c.id)} title="Remove from group">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {availableCategories.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <select value={addCategoryId} onChange={(e) => setAddCategoryId(e.target.value)}>
            <option value="">Add a category…</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={handleAddCategory} disabled={!addCategoryId}>
            Add
          </button>
        </div>
      )}

      <div className="budget-row" style={{ marginTop: 0 }}>
        <span className="budget-row-label">Group budget:</span>
        <input
          type="text"
          className="budget-amount-input"
          placeholder="none"
          value={budgetAmountDraft}
          onChange={(e) => setBudgetAmountDraft(e.target.value)}
        />
        <select value={budgetPeriodDraft} onChange={(e) => setBudgetPeriodDraft(e.target.value)}>
          <option value="weekly">per week</option>
          <option value="monthly">per month</option>
        </select>
        <select value={budgetTypeDraft} onChange={(e) => setBudgetTypeDraft(e.target.value)}>
          <option value="spend">Spend</option>
          <option value="accumulate">Accumulate</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={handleSaveBudget}>
          Save
        </button>
      </div>
      {budgetTypeDraft === "accumulate" && (
        <div className="budget-row" style={{ marginTop: 4 }}>
          <span className="budget-row-label" style={{ fontWeight: 400 }}>
            Target (optional):
          </span>
          <input
            type="text"
            className="budget-amount-input"
            placeholder="e.g. 3000"
            value={accumulateTargetDraft}
            onChange={(e) => setAccumulateTargetDraft(e.target.value)}
          />
        </div>
      )}
      {budgetTypeDraft === "accumulate" && (
        <div className="budget-row" style={{ marginTop: 4 }}>
          <span className="budget-row-label" style={{ fontWeight: 400 }}>
            Track since:
          </span>
          <input
            type="date"
            value={startDateDraft}
            onChange={(e) => setStartDateDraft(e.target.value)}
          />
          <span className="muted-cell" style={{ fontSize: 11.5 }}>
            Backdate this to see how you've been doing over past periods, not just from today forward.
          </span>
        </div>
      )}
    </div>
  );
}


export function BudgetGroupsView({ budgetGroups, categories, transactions, onAdd, onRename, onDelete, onSetBudget, onAddCategory, onRemoveCategory }) {
  const [addError, setAddError] = useState(null);
  const [newName, setNewName] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const clash = findNameClash(budgetGroups, trimmed);
    if (clash) {
      setAddError(`There's already a group called "${clash.name}".`);
      return;
    }
    onAdd(trimmed);
    setNewName("");
    setAddError(null);
  }

  return (
    <div>
      <div className="view-header">
        <h1>Budget Groups</h1>
        <p>
          Roll several categories up into one shared budget — like combining every "Entertainment" category
          into a single target instead of budgeting each one separately.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <form onSubmit={handleAdd} style={{ display: "flex", gap: 10 }}>
          <input
            type="text"
            placeholder="New group name…"
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
            Add group
          </button>
        </form>
        {addError && (
          <p className="hint" role="alert" style={{ color: "var(--danger)", marginTop: -8, marginBottom: 14 }}>
            {addError}
          </p>
        )}
      </div>

      {budgetGroups.length === 0 ? (
        <div className="panel">
          <div className="hint">No groups yet — add one above, like "Entertainment" or "Essential."</div>
        </div>
      ) : (
        budgetGroups.map((g) => (
          <BudgetGroupCard
            key={g.id}
            group={g}
            allCategories={categories}
            allGroups={budgetGroups}
            transactions={transactions}
            onRename={onRename}
            onSetBudget={onSetBudget}
            onAddCategory={onAddCategory}
            onRemoveCategory={onRemoveCategory}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}
