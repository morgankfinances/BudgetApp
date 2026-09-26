import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/common.jsx";
import { budgetPerformance, buildBudgetItems, computeBudgetPeriodData, computeFundBalance, getUnassignedCategoryIds } from "../lib/budget.js";
import { formatMonthLabel, formatWeekLabel, getMonthStartISO } from "../lib/periods.js";
import { formatMoney, parseMoney } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Budget view                                                          */
/* ------------------------------------------------------------------ */

export function BudgetProgressCard({ item, spent, cumulativeSaved, periodKey, transactions, onSetActual, onAdjustFund }) {
  const budget = item.budgetAmount;
  const isUnassigned = !!item.isUnassignedPseudo;
  const ratio = budget > 0 ? spent / budget : 0;
  const isAccumulate = item.budgetType === "accumulate";
  const barColor = isAccumulate
    ? ratio >= 1
      ? "var(--income)"
      : ratio >= 0.8
      ? "var(--warn-border)"
      : "var(--expense)"
    : ratio >= 1
    ? "var(--expense)"
    : ratio >= 0.8
    ? "var(--warn-border)"
    : "var(--income)";
  const remaining = budget - spent;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(spent));

  function startEdit() {
    setDraft(String(spent));
    setEditing(true);
  }

  function saveEdit() {
    const amount = parseMoney(draft.trim());
    if (amount != null) onSetActual(item.id, periodKey, amount);
    setEditing(false);
  }

  if (isUnassigned) {
    return (
      <div className="budget-card" style={{ borderColor: spent > 0 ? "var(--expense)" : "var(--border)" }}>
        <div className="budget-card-head">
          <span className="budget-card-name">
            {item.name}
            <span className="budget-group-tag" style={{ borderColor: "var(--expense)", color: "var(--expense)" }}>
              unassigned
            </span>
          </span>
          <span className="budget-card-period">{item.budgetPeriod === "weekly" ? "this week" : "this month"}</span>
        </div>
        <div className="budget-card-figures">
          <span className={spent > 0 ? "money-out" : ""} style={{ fontSize: 18, fontWeight: 700 }}>
            {formatMoney(spent)}
          </span>
          <br />
          <span className="muted-cell">
            {spent > 0
              ? "spent in categories with no budget — not covered by any plan"
              : "nothing untracked this period"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="budget-card">
      <div className="budget-card-head">
        <span className="budget-card-name">
          {item.name}
          {item.isGroup && <span className="budget-group-tag">group</span>}
          {isAccumulate && (
            <span className="budget-group-tag" style={{ borderColor: "var(--income)", color: "var(--income)" }}>
              saving
            </span>
          )}
        </span>
        <span className="budget-card-period">{item.budgetPeriod === "weekly" ? "this week" : "this month"}</span>
      </div>
      <div className="budget-bar-track">
        <div className="budget-bar-fill" style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%`, background: barColor }} />
      </div>
      <div className="budget-card-figures">
        {editing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <input
              type="text"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              style={{ width: 80, fontFamily: "inherit", fontSize: 13, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 4 }}
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
          <>
            <span className={!isAccumulate && ratio >= 1 ? "money-out" : ""}>{formatMoney(spent)}</span>
            <span className="muted-cell"> {isAccumulate ? "set aside of" : "of"} {formatMoney(budget)}{isAccumulate ? " planned" : ""}</span>
            {isAccumulate && (
              <button className="btn btn-ghost btn-sm" onClick={startEdit} style={{ marginLeft: 6, padding: "1px 6px" }}>
                Adjust
              </button>
            )}
            <br />
            {isAccumulate ? (
              remaining > 0 ? (
                <span className="money-out">{formatMoney(remaining)} short this period</span>
              ) : (
                <span className="money-in">On track{remaining < 0 ? ` (+${formatMoney(Math.abs(remaining))})` : ""}</span>
              )
            ) : remaining >= 0 ? (
              <span className="money-in">{formatMoney(remaining)} left</span>
            ) : (
              <span className="money-out">{formatMoney(Math.abs(remaining))} over</span>
            )}
          </>
        )}
      </div>
      {isAccumulate && (
        <FundBalanceSection item={item} cumulativeSaved={cumulativeSaved} transactions={transactions} onAdjustFund={onAdjustFund} />
      )}
    </div>
  );
}


export function FundBalanceSection({ item, cumulativeSaved, transactions, onAdjustFund }) {
  const { balance, contributed, withdrawn, adjusted } = computeFundBalance(item, cumulativeSaved, transactions);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(balance.toFixed(2));
  const isOverdrawn = balance < 0;
  const target = item.accumulateTarget;
  const targetRatio = target > 0 ? Math.max(0, Math.min(balance / target, 1)) : null;

  function startEdit() {
    setDraft(balance.toFixed(2));
    setEditing(true);
  }

  function saveEdit() {
    const newBalance = parseMoney(draft.trim());
    if (newBalance != null && Math.abs(newBalance - balance) > 0.001) {
      onAdjustFund(item.id, newBalance - balance);
    }
    setEditing(false);
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="muted-cell" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em" }}>
          Fund balance
        </span>
        {!editing && (
          <button className="btn btn-ghost btn-sm" onClick={startEdit} style={{ padding: "1px 6px" }}>
            Adjust
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: 100,
              fontFamily: "inherit",
              fontSize: 15,
              padding: "4px 6px",
              border: "1px solid var(--border)",
              borderRadius: 4,
            }}
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
        <div style={{ fontSize: 20, fontWeight: 700, color: isOverdrawn ? "var(--expense)" : "var(--income)" }}>
          {isOverdrawn ? "\u2212" : ""}
          {formatMoney(Math.abs(balance))}
          {isOverdrawn && <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 6 }}>overdrawn</span>}
        </div>
      )}

      {!editing && (withdrawn !== 0 || adjusted !== 0) && (
        <div className="muted-cell" style={{ fontSize: 11 }}>
          {formatMoney(contributed)} contributed
          {withdrawn > 0 && <> {"\u2212"} {formatMoney(withdrawn)} spent</>}
          {withdrawn < 0 && <> + {formatMoney(Math.abs(withdrawn))} added</>}
          {adjusted !== 0 && (
            <>
              {" "}
              {adjusted > 0 ? "+" : "\u2212"} {formatMoney(Math.abs(adjusted))} adjusted
            </>
          )}
        </div>
      )}

      {target > 0 ? (
        <>
          <div className="budget-bar-track" style={{ height: 6, marginTop: 6 }}>
            <div
              className="budget-bar-fill"
              style={{ width: `${(targetRatio || 0) * 100}%`, background: isOverdrawn ? "var(--expense)" : "var(--accent)" }}
            />
          </div>
          <div className="muted-cell" style={{ fontSize: 12 }}>
            {Math.round((targetRatio || 0) * 100)}% of {formatMoney(target)} goal
          </div>
        </>
      ) : (
        <div className="muted-cell" style={{ fontSize: 12, marginTop: 4 }}>
          No target set
        </div>
      )}
    </div>
  );
}


export function BudgetHistoryTable({ budgeted, periods, spendMap, periodLabelFn }) {
  return (
    <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
      <table className="pivot-table">
        <thead>
          <tr>
            <th>Category</th>
            {periods.map((p) => (
              <th key={p}>{periodLabelFn(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {budgeted.map((c) => (
            <tr key={c.id}>
              <td className="pivot-row-label">
                <div>
                  {c.name}
                  {c.isGroup && <span className="budget-group-tag">group</span>}
                </div>
                <div className="pivot-row-budget">
                  {c.isUnassignedPseudo ? "No budget" : `Budget: ${formatMoney(c.budgetAmount)}`}
                </div>
              </td>
              {periods.map((p) => {
                const spent = spendMap[c.id]?.[p] || 0;
                const perf = budgetPerformance(c, spent);
                const cls = perf >= 0 ? "money-in" : "money-out";
                return (
                  <td key={p} className={cls}>
                    <div style={{ fontWeight: 600 }}>
                      {perf >= 0 ? "+" : "\u2212"}
                      {formatMoney(Math.abs(perf))}
                    </div>
                    <div className="muted-cell" style={{ fontSize: 11 }}>
                      {formatMoney(spent)} {c.budgetType === "accumulate" ? "saved" : "spent"}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pivot-row-label" style={{ fontWeight: 700 }}>
              Total
            </td>
            {periods.map((p) => {
              const totalSpent = budgeted.reduce((s, b) => s + (spendMap[b.id]?.[p] || 0), 0);
              const totalBudget = budgeted.reduce((s, b) => s + (b.budgetAmount || 0), 0);
              const perf = budgeted.reduce((s, b) => s + budgetPerformance(b, spendMap[b.id]?.[p] || 0), 0);
              const cls = perf >= 0 ? "money-in" : "money-out";
              return (
                <td key={p} className={cls}>
                  <div style={{ fontWeight: 700 }}>
                    {formatMoney(totalSpent)} / {formatMoney(totalBudget)}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>
                    {perf >= 0 ? "+" : "\u2212"}
                    {formatMoney(Math.abs(perf))}
                  </div>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}


export function BudgetPerformanceChart({ title, periods, budgeted, spendMap, periodLabelFn }) {
  const data = periods.map((p) => {
    const delta = budgeted.reduce((s, b) => s + budgetPerformance(b, spendMap[b.id]?.[p] || 0), 0);
    return { period: periodLabelFn(p), delta };
  });

  return (
    <div className="panel chart-card">
      <div className="hint" style={{ marginBottom: 4 }}>
        {title} — how much was saved (green, above the line) or overspent (red, below it) that period,
        combined across every budgeted category and group on this cadence
      </div>
      <div className="chart-wrap" style={{ height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--ink-muted)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--ink-muted)" }} tickFormatter={(v) => formatMoney(v)} width={72} />
            <ReferenceLine y={0} stroke="var(--ink-muted)" />
            <Tooltip
              formatter={(value) => formatMoney(value)}
              wrapperStyle={{ zIndex: 100 }}
              contentStyle={{
                fontSize: 12.5,
                fontFamily: "'Work Sans', sans-serif",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--panel)",
                boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
              }}
              itemStyle={{ color: "var(--ink)" }}
              labelStyle={{ color: "var(--ink)" }}
            />
            <Bar dataKey="delta">
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.delta >= 0 ? "var(--income)" : "var(--expense)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


export function BudgetView({
  transactions,
  categories,
  budgetGroups,
  hiddenBudgetMonths,
  excludeUnassignedFromBudget,
  onSetActual,
  onAdjustFund,
  onToggleHiddenMonth,
  onGoCategories,
}) {
  const budgetItems = useMemo(() => buildBudgetItems(categories, budgetGroups), [categories, budgetGroups]);
  const unassignedCategoryIds = useMemo(
    () => getUnassignedCategoryIds(categories, budgetGroups),
    [categories, budgetGroups]
  );

  function withUnassignedPseudo(items, periodType) {
    if (excludeUnassignedFromBudget || unassignedCategoryIds.size === 0) return items;
    return [
      ...items,
      {
        id: "unassigned-expenses",
        name: "Unassigned Expenses",
        budgetAmount: 0,
        budgetPeriod: periodType,
        budgetType: "spend",
        accumulateTarget: null,
        accumulateActuals: {},
        createdAt: null,
        categoryIds: unassignedCategoryIds,
        isGroup: false,
        isUnassignedPseudo: true,
      },
    ];
  }

  const weeklyBudgetItems = useMemo(
    () => withUnassignedPseudo(budgetItems, "weekly"),
    [budgetItems, unassignedCategoryIds, excludeUnassignedFromBudget]
  );
  const monthlyBudgetItems = useMemo(
    () => withUnassignedPseudo(budgetItems, "monthly"),
    [budgetItems, unassignedCategoryIds, excludeUnassignedFromBudget]
  );

  const weeklyData = useMemo(
    () => computeBudgetPeriodData(transactions, weeklyBudgetItems, "weekly"),
    [transactions, weeklyBudgetItems]
  );
  const monthlyData = useMemo(
    () => computeBudgetPeriodData(transactions, monthlyBudgetItems, "monthly"),
    [transactions, monthlyBudgetItems]
  );

  const hasBudgets = (weeklyData && weeklyData.budgeted.length > 0) || (monthlyData && monthlyData.budgeted.length > 0);

  if (!hasBudgets) {
    return (
      <EmptyState
        title="No budgets set yet"
        body="Set a weekly or monthly budget on any category from the Categories tab (or roll several into a Budget Group first), and your progress will show up here."
        ctaLabel="Go to Categories"
        onCta={onGoCategories}
      />
    );
  }

  function cumulativeFor(data, itemId) {
    if (!data) return 0;
    const cells = data.spendMap[itemId] || {};
    return Object.values(cells).reduce((s, v) => s + v, 0);
  }

  const hiddenSet = new Set(hiddenBudgetMonths || []);

  // Only the chart and history table look at this — the "this week/this
  // month" progress cards above them are about the live current period,
  // which doesn't make sense to hide.
  function visiblePeriods(data) {
    if (!data) return [];
    return data.periods.filter((p) => !hiddenSet.has(getMonthStartISO(p)));
  }
  const weeklyVisiblePeriods = visiblePeriods(weeklyData);
  const monthlyVisiblePeriods = visiblePeriods(monthlyData);

  const allMonthsPresent = useMemo(() => {
    const months = new Set();
    (weeklyData?.periods || []).forEach((p) => months.add(getMonthStartISO(p)));
    (monthlyData?.periods || []).forEach((p) => months.add(p));
    return Array.from(months).sort();
  }, [weeklyData, monthlyData]);

  return (
    <div>
      <div className="view-header">
        <h1>Budget</h1>
        <p>
          How you're tracking against what you've budgeted, by category or group. "Spent" here means money out
          minus money in — for Accumulate items, it means what's been set aside.
        </p>
      </div>

      {weeklyData && (
        <>
          <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 16 }}>This week</h3>
          <div className="budget-card-grid">
            {weeklyData.budgeted.map((item) => (
              <BudgetProgressCard
                key={item.id}
                item={item}
                spent={weeklyData.spendMap[item.id]?.[weeklyData.currentKey] || 0}
                cumulativeSaved={cumulativeFor(weeklyData, item.id)}
                periodKey={weeklyData.currentKey}
                transactions={transactions}
                onSetActual={onSetActual}
                onAdjustFund={onAdjustFund}
              />
            ))}
          </div>
        </>
      )}

      {monthlyData && (
        <>
          <h3 style={{ marginBottom: 10, fontSize: 16 }}>This month</h3>
          <div className="budget-card-grid">
            {monthlyData.budgeted.map((item) => (
              <BudgetProgressCard
                key={item.id}
                item={item}
                spent={monthlyData.spendMap[item.id]?.[monthlyData.currentKey] || 0}
                cumulativeSaved={cumulativeFor(monthlyData, item.id)}
                periodKey={monthlyData.currentKey}
                transactions={transactions}
                onSetActual={onSetActual}
                onAdjustFund={onAdjustFund}
              />
            ))}
          </div>
        </>
      )}

      {allMonthsPresent.length > 0 && (
        <>
          <h3 style={{ marginBottom: 10, fontSize: 16 }}>Excluded months</h3>
          <div className="panel" style={{ marginBottom: 22 }}>
            <p className="hint" style={{ marginBottom: 10 }}>
              Hide a month from the chart and history below — handy for a starting month that's only partially
              imported and throws everything else off.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {allMonthsPresent.map((m) => {
                const hidden = hiddenSet.has(m);
                return (
                  <button
                    key={m}
                    className="btn btn-sm"
                    style={
                      hidden
                        ? { border: "1px solid var(--expense)", color: "var(--expense)", background: "var(--panel)" }
                        : { border: "1px solid var(--border)", color: "var(--ink)", background: "var(--panel)" }
                    }
                    onClick={() => onToggleHiddenMonth(m)}
                  >
                    {formatMonthLabel(m)} {hidden ? "(hidden) — show" : "— hide"}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {weeklyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginBottom: 10, fontSize: 16 }}>Weekly performance</h3>
          <BudgetPerformanceChart
            title="Weekly"
            periods={weeklyVisiblePeriods}
            budgeted={weeklyData.budgeted}
            spendMap={weeklyData.spendMap}
            periodLabelFn={formatWeekLabel}
          />
        </>
      )}

      {monthlyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Monthly performance</h3>
          <BudgetPerformanceChart
            title="Monthly"
            periods={monthlyVisiblePeriods}
            budgeted={monthlyData.budgeted}
            spendMap={monthlyData.spendMap}
            periodLabelFn={formatMonthLabel}
          />
        </>
      )}

      {weeklyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Weekly history</h3>
          <BudgetHistoryTable
            budgeted={weeklyData.budgeted}
            periods={weeklyVisiblePeriods}
            spendMap={weeklyData.spendMap}
            periodLabelFn={formatWeekLabel}
          />
        </>
      )}

      {monthlyVisiblePeriods.length > 1 && (
        <>
          <h3 style={{ marginTop: 22, marginBottom: 10, fontSize: 16 }}>Monthly history</h3>
          <BudgetHistoryTable
            budgeted={monthlyData.budgeted}
            periods={monthlyVisiblePeriods}
            spendMap={monthlyData.spendMap}
            periodLabelFn={formatMonthLabel}
          />
        </>
      )}
    </div>
  );
}
