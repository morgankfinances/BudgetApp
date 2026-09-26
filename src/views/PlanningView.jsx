import React, { useMemo, useState } from "react";
import { StatBlock } from "../components/common.jsx";
import { buildBudgetItems, getUnassignedCategoryIds } from "../lib/budget.js";
import { getMonthStartISO, monthlyEquivalent } from "../lib/periods.js";
import { formatMoney, parseMoney } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Planning view                                                        */
/* ------------------------------------------------------------------ */

export function PlanningCategoryRow({ category, groupName, onSetBudget }) {
  const [budgetAmountDraft, setBudgetAmountDraft] = useState(
    category.budgetAmount != null ? String(category.budgetAmount) : ""
  );
  const [budgetPeriodDraft, setBudgetPeriodDraft] = useState(category.budgetPeriod || "monthly");
  const [budgetTypeDraft, setBudgetTypeDraft] = useState(category.budgetType || "spend");
  const [accumulateTargetDraft, setAccumulateTargetDraft] = useState(
    category.accumulateTarget != null ? String(category.accumulateTarget) : ""
  );
  const [startDateDraft, setStartDateDraft] = useState(
    category.createdAt ? category.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );

  function handleSave() {
    const trimmed = budgetAmountDraft.trim();
    const amount = trimmed === "" ? null : parseMoney(trimmed);
    const targetTrimmed = accumulateTargetDraft.trim();
    const target = targetTrimmed === "" ? null : parseMoney(targetTrimmed);
    onSetBudget(
      category.id,
      amount != null && amount > 0 ? amount : null,
      budgetPeriodDraft,
      budgetTypeDraft,
      target != null && target > 0 ? target : null,
      budgetTypeDraft === "accumulate" ? startDateDraft : null
    );
  }

  if (groupName) {
    return (
      <div className="account-card">
        <div>
          <div className="name">{category.name}</div>
          <div className="meta">Budgeted as part of the "{groupName}" group — manage it from Budget Groups.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="account-card">
      <div>
        <div className="name">{category.name}</div>
        <div className="budget-row" style={{ marginTop: 6 }}>
          <span className="budget-row-label">Budget:</span>
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
          <button className="btn btn-ghost btn-sm" onClick={handleSave}>
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
            <input type="date" value={startDateDraft} onChange={(e) => setStartDateDraft(e.target.value)} />
            <span className="muted-cell" style={{ fontSize: 11.5 }}>
              Backdate this to see how you've been doing over past periods, not just from today forward.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


export function PlanningView({
  transactions,
  categories,
  budgetGroups,
  plannedIncome,
  incomeWarningDismissed,
  excludeUnassignedFromBudget,
  onSetPlannedIncome,
  onDismissIncomeWarning,
  onSetCategoryBudget,
  onToggleExcludeUnassigned,
}) {
  const [draft, setDraft] = useState(plannedIncome != null ? String(plannedIncome) : "");
  const [editing, setEditing] = useState(plannedIncome == null);

  const budgetItems = useMemo(() => buildBudgetItems(categories, budgetGroups), [categories, budgetGroups]);
  const budgeted = budgetItems.filter((b) => b.budgetAmount != null && b.budgetAmount > 0);
  const totalAssigned = budgeted.reduce((s, b) => s + monthlyEquivalent(b.budgetAmount, b.budgetPeriod), 0);
  const unassigned = (plannedIncome || 0) - totalAssigned;

  const groupNameByCategoryId = useMemo(() => {
    const map = {};
    budgetGroups.forEach((g) => (g.categoryIds || []).forEach((id) => (map[id] = g.name)));
    return map;
  }, [budgetGroups]);

  const unassignedIdSet = useMemo(
    () => getUnassignedCategoryIds(categories, budgetGroups),
    [categories, budgetGroups]
  );
  const incomeCategories = categories.filter((c) => c.isIncome);
  const unassignedCategories = categories.filter((c) => unassignedIdSet.has(c.id));
  const budgetedCategories = categories.filter(
    (c) => !c.isIncome && !unassignedIdSet.has(c.id) && !groupNameByCategoryId[c.id]
  );
  const groupedCategories = categories.filter(
    (c) => !c.isIncome && !unassignedIdSet.has(c.id) && groupNameByCategoryId[c.id]
  );

  const unassignedSpendThisMonth = useMemo(() => {
    const ids = new Set(unassignedCategories.map((c) => c.id));
    const thisMonth = getMonthStartISO(new Date().toISOString().slice(0, 10));
    let total = 0;
    transactions.forEach((t) => {
      if (!t.categoryId || !ids.has(t.categoryId) || !t.date) return;
      if (getMonthStartISO(t.date) !== thisMonth) return;
      total += (t.amountOut || 0) - (t.amountIn || 0);
    });
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, categories, groupNameByCategoryId]);

  const monthlyActualIncome = useMemo(() => {
    const excludedIds = new Set(categories.filter((c) => c.excluded).map((c) => c.id));
    const incomeIds = new Set(categories.filter((c) => c.isIncome).map((c) => c.id));
    // Once at least one category is flagged as Income, use only those —
    // more precise than counting every stray refund as "income." Until
    // then, fall back to the old broad behavior so nothing changes for
    // anyone who hasn't used the new flag yet.
    const restrictToIncomeFlag = incomeIds.size > 0;
    const byMonth = {};
    transactions.forEach((t) => {
      if (!t.date) return;
      if (t.categoryId && excludedIds.has(t.categoryId)) return;
      if (restrictToIncomeFlag && !(t.categoryId && incomeIds.has(t.categoryId))) return;
      const mKey = getMonthStartISO(t.date);
      byMonth[mKey] = (byMonth[mKey] || 0) + (t.amountIn || 0);
    });
    return byMonth;
  }, [transactions, categories]);

  // The earliest month with ANY transaction data is often partial too —
  // e.g. an account added mid-month — not just the current, still-in-
  // progress month. Both get excluded so the average is only ever built
  // from genuinely complete calendar months.
  const earliestDataMonthKey = useMemo(() => {
    let earliest = null;
    transactions.forEach((t) => {
      if (!t.date) return;
      if (earliest === null || t.date < earliest) earliest = t.date;
    });
    return earliest ? getMonthStartISO(earliest) : null;
  }, [transactions]);

  const currentMonthKey = getMonthStartISO(new Date().toISOString().slice(0, 10));
  const completeMonths = Object.keys(monthlyActualIncome)
    .filter((k) => k < currentMonthKey && k !== earliestDataMonthKey)
    .sort();
  const recentMonths = completeMonths.slice(-6);
  const avgActualIncome =
    recentMonths.length > 0
      ? recentMonths.reduce((s, k) => s + monthlyActualIncome[k], 0) / recentMonths.length
      : null;
  const incomeDriftPct =
    avgActualIncome != null && plannedIncome > 0 ? ((avgActualIncome - plannedIncome) / plannedIncome) * 100 : null;
  const showIncomeDriftWarning =
    !incomeWarningDismissed && recentMonths.length >= 2 && incomeDriftPct != null && Math.abs(incomeDriftPct) >= 10;

  function handleSave() {
    const amount = draft.trim() === "" ? null : parseMoney(draft.trim());
    onSetPlannedIncome(amount != null && amount > 0 ? amount : null);
    setEditing(false);
  }

  return (
    <div>
      <div className="view-header">
        <h1>Planning</h1>
        <p>Set your planned monthly income, then see how much of it is already assigned across your budgets.</p>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Planned monthly income</h3>
        {editing ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="e.g. 4000"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                fontFamily: "inherit",
                fontSize: 14,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                width: 160,
              }}
            />
            <button className="btn btn-primary" onClick={handleSave}>
              Save
            </button>
            {plannedIncome != null && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setDraft(String(plannedIncome));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "'Fraunces', serif", fontSize: 22 }}>{formatMoney(plannedIncome)}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(String(plannedIncome));
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {plannedIncome != null && (
        <>
          <div className="summary-row">
            <StatBlock value={formatMoney(plannedIncome)} label="Planned income" />
            <StatBlock value={formatMoney(totalAssigned)} label="Assigned to budgets" />
            <StatBlock value={formatMoney(unassigned)} label={unassigned >= 0 ? "Unassigned" : "Over-assigned"} />
          </div>

          {unassigned < 0 && (
            <div className="error-banner">
              You've assigned {formatMoney(Math.abs(unassigned))} more than your planned income covers.
            </div>
          )}

          {showIncomeDriftWarning && (
            <div className="error-banner">
              <div>
                Your actual income has averaged {formatMoney(avgActualIncome)}/month over the last{" "}
                {recentMonths.length} month{recentMonths.length === 1 ? "" : "s"} — {Math.abs(Math.round(incomeDriftPct))}%{" "}
                {incomeDriftPct > 0 ? "above" : "below"} your planned {formatMoney(plannedIncome)}. Worth updating
                your plan.
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => onDismissIncomeWarning(true)}
              >
                Dismiss this warning
              </button>
            </div>
          )}

          {incomeWarningDismissed && recentMonths.length >= 2 && incomeDriftPct != null && Math.abs(incomeDriftPct) >= 10 && (
            <div className="hint" style={{ marginBottom: 12 }}>
              Income drift warning dismissed for now.{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => onDismissIncomeWarning(false)}>
                Show it again
              </button>
            </div>
          )}

          <h3 style={{ marginTop: 6, marginBottom: 4, fontSize: 16 }}>Currently Unassigned</h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            These categories have no budget and aren't in a group, so nothing about their spending is being
            tracked.{" "}
            {unassignedCategories.length > 0 && (
              <>
                So far this month: <strong>{formatMoney(unassignedSpendThisMonth)}</strong> across{" "}
                {unassignedCategories.length} categor{unassignedCategories.length === 1 ? "y" : "ies"}.
              </>
            )}
          </p>

          <div className="excluded-note" style={{ marginBottom: 16 }}>
            <label className="radio-option" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={excludeUnassignedFromBudget}
                onChange={(e) => onToggleExcludeUnassigned(e.target.checked)}
              />
              Exclude unassigned spending from the Budget tab
            </label>
          </div>
          {excludeUnassignedFromBudget && (
            <div className="error-banner" style={{ marginBottom: 16 }}>
              With this on, real spending in these categories won't show up anywhere in your Budget totals or
              charts — it's easy to lose track of money going out with nothing keeping an eye on it. Only turn
              this off if you're confident you don't need the reminder.
            </div>
          )}

          {categories.length === 0 ? (
            <div className="panel">
              <div className="hint">No categories yet — add some from the Categories tab first.</div>
            </div>
          ) : (
            <>
              {unassignedCategories.length === 0 ? (
                <div className="panel">
                  <div className="hint">
                    Nothing unassigned — every category is either budgeted or in a group.
                  </div>
                </div>
              ) : (
                <div className="panel">
                  {unassignedCategories.map((c) => (
                    <PlanningCategoryRow key={c.id} category={c} groupName={null} onSetBudget={onSetCategoryBudget} />
                  ))}
                </div>
              )}

              <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Budgeted</h3>
              {budgetedCategories.length === 0 ? (
                <div className="panel">
                  <div className="hint">None yet — set a budget on a category above.</div>
                </div>
              ) : (
                <div className="panel">
                  {budgetedCategories.map((c) => (
                    <PlanningCategoryRow key={c.id} category={c} groupName={null} onSetBudget={onSetCategoryBudget} />
                  ))}
                </div>
              )}

              {groupedCategories.length > 0 && (
                <>
                  <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Part of a group</h3>
                  <div className="panel">
                    {groupedCategories.map((c) => (
                      <PlanningCategoryRow
                        key={c.id}
                        category={c}
                        groupName={groupNameByCategoryId[c.id]}
                        onSetBudget={onSetCategoryBudget}
                      />
                    ))}
                  </div>
                </>
              )}

              {incomeCategories.length > 0 && (
                <>
                  <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Income</h3>
                  <p className="hint" style={{ marginBottom: 12 }}>
                    Flagged as income, not spending — these are never counted as unassigned, and drive the
                    "actual income" figure above. Toggle this from the Categories tab.
                  </p>
                  <div className="panel">
                    {incomeCategories.map((c) => (
                      <div key={c.id} className="account-card">
                        <div>
                          <div className="name">{c.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
