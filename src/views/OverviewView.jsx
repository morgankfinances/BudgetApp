import React, { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { StatBlock } from "../components/common.jsx";
import { CHART_PALETTE } from "../constants.js";
import { ThemedStar } from "../householdGate.jsx";
import { buildBudgetItems, computeBudgetPeriodData, flagForBudgetItem } from "../lib/budget.js";
import { loadReportPeriodConfig, periodFnsForConfig } from "../lib/periods.js";
import { formatMoney } from "../lib/utils.js";

export function OverviewView({ transactions, categories, budgetGroups, onNavigate }) {
  const periodConfig = useMemo(() => loadReportPeriodConfig(), []);
  const { keyFn: periodKeyFn, labelFn: periodLabelFn } = useMemo(() => periodFnsForConfig(periodConfig), [periodConfig]);

  const trackedIds = useMemo(
    () => new Set(categories.filter((c) => !c.excluded).map((c) => c.id)),
    [categories]
  );

  const periodSummary = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const currentKey = periodKeyFn(todayISO);
    const rowMap = {};
    const catLabel = {};
    let sumIn = 0;
    let sumOut = 0;
    transactions.forEach((t) => {
      if (!t.date) return;
      if (t.categoryId && !trackedIds.has(t.categoryId)) return;
      if (periodKeyFn(t.date) !== currentKey) return;
      const key = t.categoryId || "uncategorized";
      if (!(key in rowMap)) {
        rowMap[key] = 0;
        catLabel[key] = t.categoryId ? categories.find((c) => c.id === key)?.name || "Unknown" : "Uncategorized";
      }
      rowMap[key] += (t.amountIn || 0) - (t.amountOut || 0);
      sumIn += t.amountIn || 0;
      sumOut += t.amountOut || 0;
    });
    const rows = Object.keys(rowMap)
      .map((k) => ({ key: k, label: catLabel[k], value: rowMap[k] }))
      .filter((r) => r.value !== 0);
    return { currentKey, sumIn, sumOut, net: sumIn - sumOut, rows };
  }, [transactions, categories, trackedIds, periodKeyFn]);

  const topSpending = useMemo(
    () =>
      periodSummary.rows
        .filter((r) => r.value < 0)
        .sort((a, b) => a.value - b.value)
        .slice(0, 5),
    [periodSummary]
  );

  const donutData = useMemo(() => {
    const spendRows = periodSummary.rows
      .filter((r) => r.value < 0)
      .sort((a, b) => a.value - b.value);
    const top = spendRows.slice(0, 5);
    const rest = spendRows.slice(5);
    const wedges = top.map((r) => ({ name: r.label, value: Math.abs(r.value) }));
    if (rest.length > 0) {
      const otherSum = rest.reduce((s, r) => s + Math.abs(r.value), 0);
      if (otherSum > 0) wedges.push({ name: "Other", value: otherSum, isOther: true });
    }
    return wedges;
  }, [periodSummary]);

  const budgetItems = useMemo(() => buildBudgetItems(categories, budgetGroups), [categories, budgetGroups]);
  const weeklyData = useMemo(() => computeBudgetPeriodData(transactions, budgetItems, "weekly"), [transactions, budgetItems]);
  const monthlyData = useMemo(() => computeBudgetPeriodData(transactions, budgetItems, "monthly"), [transactions, budgetItems]);

  const { flagged, totalBudgetCount } = useMemo(() => {
    const flagged = [];
    let totalBudgetCount = 0;
    [weeklyData, monthlyData].forEach((data) => {
      if (!data) return;
      data.budgeted.forEach((item) => {
        if (item.isUnassignedPseudo) return;
        totalBudgetCount += 1;
        const spent = data.spendMap[item.id]?.[data.currentKey] || 0;
        const flag = flagForBudgetItem(item, spent);
        if (flag !== "ok") {
          flagged.push({
            item,
            spent,
            flag,
            periodWord: item.budgetPeriod === "weekly" ? "this week" : "this month",
          });
        }
      });
    });
    flagged.sort((a, b) => (a.flag === "bad" && b.flag !== "bad" ? -1 : a.flag !== "bad" && b.flag === "bad" ? 1 : 0));
    return { flagged, totalBudgetCount };
  }, [weeklyData, monthlyData]);

  const uncategorizedCount = transactions.filter((t) => !t.categoryId).length;
  const needsAttentionCount = flagged.length + (uncategorizedCount > 0 ? 1 : 0);

  return (
    <div>
      <div className="view-header">
        <h1>Overview</h1>
        <p>
          A snapshot of {periodLabelFn(periodSummary.currentKey)} — the period length and chart style here
          follow whatever you've set in Reports.
        </p>
      </div>

      <div className="summary-row">
        <StatBlock value={formatMoney(periodSummary.sumIn)} label="Money in" />
        <StatBlock value={formatMoney(periodSummary.sumOut)} label="Money out" />
        <StatBlock value={formatMoney(periodSummary.net)} label="Net" />
      </div>

      <div className="overview-grid">
        <div className="panel">
          <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15 }}>Needs attention</h3>
          {needsAttentionCount === 0 ? (
            <p className="hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ThemedStar className="inline-star" />
              Nothing flagged right now — budgets are on track and everything's categorized.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {uncategorizedCount > 0 && (
                <button
                  className="account-card"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "none", background: "var(--subtle-bg)", borderRadius: "var(--radius)" }}
                  onClick={() => onNavigate("transactions")}
                >
                  <div>
                    <div className="name" style={{ fontSize: 13.5 }}>
                      {uncategorizedCount} uncategorized transaction{uncategorizedCount === 1 ? "" : "s"}
                    </div>
                    <div className="meta">Tap to review them</div>
                  </div>
                </button>
              )}
              {flagged.map(({ item, spent, flag, periodWord }) => (
                <button
                  key={item.id}
                  className="account-card"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "none", background: "var(--subtle-bg)", borderRadius: "var(--radius)" }}
                  onClick={() => onNavigate("budget")}
                >
                  <div>
                    <div className="name" style={{ fontSize: 13.5 }}>{item.name}</div>
                    <div className="meta">
                      {item.budgetType === "accumulate"
                        ? `Behind on saving ${periodWord}`
                        : flag === "bad"
                        ? `Over budget ${periodWord}`
                        : `Nearing its limit ${periodWord}`}
                    </div>
                  </div>
                  <div className="figures">
                    <div className={"net " + (flag === "bad" ? "money-out" : "")} style={{ fontSize: 14 }}>
                      {formatMoney(spent)} / {formatMoney(item.budgetAmount)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {totalBudgetCount > 0 && (
            <p className="muted-cell" style={{ fontSize: 12, marginTop: 12 }}>
              {totalBudgetCount - flagged.length} of {totalBudgetCount} budgets on track.{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("budget")}>
                See all
              </button>
            </p>
          )}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15 }}>Top spending this period</h3>
          {topSpending.length === 0 ? (
            <p className="hint">No spending recorded yet for {periodLabelFn(periodSummary.currentKey)}.</p>
          ) : (
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 8 }}>
              <div style={{ width: 120, height: 120, flexShrink: 0 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={donutData.length > 1 ? 2 : 0}>
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.isOther ? "var(--chart-other)" : CHART_PALETTE[i % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatMoney(value)}
                      contentStyle={{
                        fontSize: 12,
                        fontFamily: "'Work Sans', sans-serif",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: "var(--panel)",
                      }}
                      itemStyle={{ color: "var(--ink)" }}
                      labelStyle={{ color: "var(--ink)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {topSpending.map((r, i) => (
                  <div key={r.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "4px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_PALETTE[i % CHART_PALETTE.length], flexShrink: 0, display: "inline-block" }} />
                      {r.label}
                    </span>
                    <span className="money-out" style={{ flexShrink: 0 }}>{formatMoney(Math.abs(r.value))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => onNavigate("reports")}>
            See full Reports
          </button>
        </div>
      </div>
    </div>
  );
}
