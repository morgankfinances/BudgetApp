import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DualScrollPanel, EmptyState, StatBlock } from "../components/common.jsx";
import { CHART_PALETTE } from "../constants.js";
import { loadReportPeriodConfig, periodFnsForConfig, saveReportPeriodConfig } from "../lib/periods.js";
import { formatMoney } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Reports view                                                         */
/* ------------------------------------------------------------------ */

export function ReportsTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  const sorted = [...payload].sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0));
  return (
    <div
      style={{
        fontSize: 12.5,
        fontFamily: "'Work Sans', sans-serif",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--panel)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        padding: "8px 10px",
        minWidth: 160,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {sorted.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 14, color: p.color }}>
          <span>{p.name}</span>
          <span>{formatMoney(p.value)}</span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 14,
          marginTop: 4,
          paddingTop: 4,
          borderTop: "1px solid var(--border)",
          fontWeight: 700,
          color: total >= 0 ? "var(--income)" : "var(--expense)",
        }}
      >
        <span>Net</span>
        <span>{formatMoney(total)}</span>
      </div>
    </div>
  );
}


export function ReportsDonutTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const signed = p.payload && p.payload.signed != null ? p.payload.signed : p.value;
  return (
    <div
      style={{
        fontSize: 12,
        fontFamily: "'Work Sans', sans-serif",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--panel)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        padding: "6px 10px",
      }}
    >
      <div style={{ fontWeight: 600 }}>{p.name}</div>
      <div style={{ color: signed >= 0 ? "var(--income)" : "var(--expense)" }}>{formatMoney(signed)}</div>
    </div>
  );
}


export function ReportsDonutGrid({ periods, periodLabelFn, rows, categoryColor, periodTotals }) {
  // Each donut ranks and truncates independently, using that period's
  // OWN values — not a globally-fixed top 6 — so "Other" always
  // reflects what was actually small that period, and a category that's
  // usually small but spiked once still gets its own wedge on the
  // period it mattered.
  const periodData = periods.map((p, i) => {
    const active = rows
      .map((r) => ({ name: r.label, value: r.cells[i] }))
      .filter((d) => d.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const top = active.slice(0, 6);
    const rest = active.slice(6);
    const wedges = top.map((d) => ({ name: d.name, value: Math.abs(d.value), signed: d.value, isOther: false }));
    if (rest.length > 0) {
      const otherSum = rest.reduce((s, d) => s + d.value, 0);
      if (otherSum !== 0) wedges.push({ name: "Other", value: Math.abs(otherSum), signed: otherSum, isOther: true });
    }
    return wedges;
  });

  // Legend reflects every category that actually appeared as its own
  // wedge in at least one period — not a fixed 6, since what's shown
  // individually now varies period to period.
  const legendNames = [];
  periodData.forEach((wedges) =>
    wedges.forEach((w) => {
      if (!w.isOther && !legendNames.includes(w.name)) legendNames.push(w.name);
    })
  );
  const hasOther = periodData.some((wedges) => wedges.some((w) => w.isOther));

  return (
    <div className="panel chart-card">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, justifyContent: periods.length <= 3 ? "center" : "flex-start" }}>
        {periods.map((p, i) => {
          const data = periodData[i];
          const net = periodTotals[i];
          return (
            <div key={p} style={{ textAlign: "center", width: 148 }}>
              <div style={{ position: "relative", height: 148 }}>
                {data.length === 0 ? (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--ink-muted)",
                      fontSize: 12,
                    }}
                  >
                    No activity
                  </div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={data}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="58%"
                        outerRadius="92%"
                        paddingAngle={data.length > 1 ? 2 : 0}
                      >
                        {data.map((d, di) => (
                          <Cell
                            key={di}
                            fill={d.isOther ? "var(--chart-other)" : categoryColor[d.name] || "var(--chart-other)"}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<ReportsDonutTooltip />} wrapperStyle={{ zIndex: 100 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                {data.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: net >= 0 ? "var(--income)" : "var(--expense)",
                      }}
                    >
                      {formatMoney(net)}
                    </div>
                  </div>
                )}
              </div>
              <div className="muted-cell" style={{ fontSize: 12, marginTop: 2 }}>
                {periodLabelFn(p)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted-cell" style={{ fontSize: 11.5, textAlign: "center", marginTop: 16 }}>
        Each donut shows that period's own biggest movers — a category shown alone in one period may be folded
        into "Other" in another, or vice versa, depending on how big it was that period. Hover a wedge to see
        whether it was money in or out.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "center",
          marginTop: 12,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        {legendNames.map((name) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: categoryColor[name] || "var(--chart-other)",
                display: "inline-block",
              }}
            />
            {name}
          </div>
        ))}
        {hasOther && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--chart-other)",
                display: "inline-block",
              }}
            />
            Other
          </div>
        )}
      </div>
    </div>
  );
}


export function ReportsView({ transactions, accounts, categories, onGoCategories }) {
  const [periodConfig, setPeriodConfig] = useState(loadReportPeriodConfig);
  const [filterAccount, setFilterAccount] = useState("all");

  function updateConfig(patch) {
    setPeriodConfig((prev) => {
      const next = { ...prev, ...patch };
      saveReportPeriodConfig(next);
      return next;
    });
  }

  const { keyFn: periodKeyFn, labelFn: periodLabelFn } = useMemo(
    () => periodFnsForConfig(periodConfig),
    [periodConfig]
  );

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
  }, [transactions, categories, filterAccount, periodKeyFn]);

  // Ranked by each category's PEAK value in any single period, not its
  // total across the whole range — a category that's only large once
  // (a one-off repair bill) still earns its own slot during that period,
  // and a category that's reliably large every period (rent) still
  // shows correctly as $0 on a period it truly was $0, instead of a
  // fixed slot going to waste while something that was actually big
  // that period gets buried in "Other". Categories hidden from the
  // charts are filtered out before ranking even happens — not just
  // hidden at render time — so a hidden category never occupies a slot
  // or gets folded into "Other" and inflating it; the chart's own totals
  // recompute around whatever's left visible.
  const hiddenSet = useMemo(() => new Set(periodConfig.hiddenCategories || []), [periodConfig.hiddenCategories]);
  const visibleRows = useMemo(() => rows.filter((r) => !hiddenSet.has(r.key)), [rows, hiddenSet]);

  const rankedCategories = useMemo(() => {
    return [...visibleRows].sort((a, b) => {
      const maxA = Math.max(0, ...a.cells.map((v) => Math.abs(v)));
      const maxB = Math.max(0, ...b.cells.map((v) => Math.abs(v)));
      return maxB - maxA;
    });
  }, [visibleRows]);

  const visiblePeriodTotals = useMemo(
    () => periods.map((_, i) => visibleRows.reduce((s, r) => s + r.cells[i], 0)),
    [periods, visibleRows]
  );

  // A stable name -> color assignment across the FULL ranked list (not
  // just the top 6 shown on the bar chart), so a category keeps the
  // same color everywhere it appears, including in a donut period where
  // it's shown individually even though it isn't in the shared top 6.
  const categoryColor = useMemo(() => {
    const map = {};
    rankedCategories.forEach((r, i) => {
      map[r.label] = CHART_PALETTE[i % CHART_PALETTE.length];
    });
    return map;
  }, [rankedCategories]);

  const chartCategories = useMemo(() => {
    const top = rankedCategories.slice(0, 6);
    const rest = rankedCategories.slice(6);
    if (rest.length > 0) {
      const otherCells = periods.map((_, i) => rest.reduce((s, r) => s + r.cells[i], 0));
      top.push({ key: "other", label: "Other", cells: otherCells, total: otherCells.reduce((s, v) => s + v, 0) });
    }
    return top;
  }, [rankedCategories, periods]);

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
        <p>Category totals rolled up on whatever schedule actually matches your pay or budgeting rhythm.</p>
      </div>

      <div className="filter-bar">
        <div className="toggle-group">
          <button
            className={"toggle-btn" + (periodConfig.mode === "weekly" ? " active" : "")}
            onClick={() => updateConfig({ mode: "weekly" })}
          >
            Weekly
          </button>
          <button
            className={"toggle-btn" + (periodConfig.mode === "monthly" ? " active" : "")}
            onClick={() => updateConfig({ mode: "monthly" })}
          >
            Monthly
          </button>
          <button
            className={"toggle-btn" + (periodConfig.mode === "interval" ? " active" : "")}
            onClick={() => updateConfig({ mode: "interval" })}
          >
            Every X days
          </button>
          <button
            className={"toggle-btn" + (periodConfig.mode === "semimonthly" ? " active" : "")}
            onClick={() => updateConfig({ mode: "semimonthly" })}
          >
            Twice a month
          </button>
        </div>
        <div className="toggle-group">
          <button
            className={"toggle-btn" + (periodConfig.chartType !== "donut" ? " active" : "")}
            onClick={() => updateConfig({ chartType: "bar" })}
          >
            Bar chart
          </button>
          <button
            className={"toggle-btn" + (periodConfig.chartType === "donut" ? " active" : "")}
            onClick={() => updateConfig({ chartType: "donut" })}
          >
            Donut chart
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

      {periodConfig.mode === "interval" && (
        <div className="excluded-note" style={{ justifyContent: "flex-start", gap: 16, marginTop: -8 }}>
          <label className="radio-option" style={{ fontSize: 13 }}>
            Every
            <input
              type="number"
              min="1"
              max="90"
              value={periodConfig.intervalDays}
              onChange={(e) => updateConfig({ intervalDays: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              style={{ width: 56 }}
            />
            days, starting from
            <input
              type="date"
              value={periodConfig.anchorDate}
              onChange={(e) => updateConfig({ anchorDate: e.target.value })}
            />
          </label>
          <span className="muted-cell" style={{ fontSize: 12 }}>
            Use a date you know was a payday — 14 days covers a biweekly schedule.
          </span>
        </div>
      )}

      {periodConfig.mode === "semimonthly" && (
        <div className="excluded-note" style={{ justifyContent: "flex-start", gap: 16, marginTop: -8 }}>
          <label className="radio-option" style={{ fontSize: 13 }}>
            Split each month on the
            <input
              type="number"
              min="1"
              max="31"
              value={periodConfig.semiMonthlyDay1}
              onChange={(e) => updateConfig({ semiMonthlyDay1: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              style={{ width: 48 }}
            />
            and
            <input
              type="number"
              min="1"
              max="31"
              value={periodConfig.semiMonthlyDay2}
              onChange={(e) => updateConfig({ semiMonthlyDay2: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              style={{ width: 48 }}
            />
          </label>
          <span className="muted-cell" style={{ fontSize: 12 }}>
            A day beyond a short month (like the 31st in February) uses that month's last day instead.
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 15 }}>Categories shown in the charts</h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            Hide a category from the bar and donut charts below without affecting anything else — the table
            still shows everything, and the category is still tracked normally in Budget and Planning. Handy
            for keeping something big and steady, like a paycheck or rent, from dominating the visual.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {rows.map((r) => {
              const hidden = hiddenSet.has(r.key);
              return (
                <button
                  key={r.key}
                  className="btn btn-sm"
                  style={
                    hidden
                      ? { border: "1px solid var(--expense)", color: "var(--expense)", background: "var(--panel)" }
                      : { border: "1px solid var(--border)", color: "var(--ink)", background: "var(--panel)" }
                  }
                  onClick={() => {
                    const current = periodConfig.hiddenCategories || [];
                    const next = hidden ? current.filter((id) => id !== r.key) : [...current, r.key];
                    updateConfig({ hiddenCategories: next });
                  }}
                >
                  {r.label} {hidden ? "(hidden) — show" : "— hide"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="summary-row">
        <StatBlock value={formatMoney(totalIn)} label="Tracked money in" />
        <StatBlock value={formatMoney(totalOut)} label="Tracked money out" />
        <StatBlock value={formatMoney(grandTotal)} label="Tracked net" />
      </div>
      {(periodConfig.hiddenCategories || []).length > 0 && (
        <p className="muted-cell" style={{ fontSize: 11.5, marginTop: -12, marginBottom: 16 }}>
          These totals always include every category — the chart below is the only thing reflecting what
          you've hidden.
        </p>
      )}

      {periodConfig.chartType === "donut" ? (
        <ReportsDonutGrid
          periods={periods}
          periodLabelFn={periodLabelFn}
          rows={visibleRows}
          categoryColor={categoryColor}
          periodTotals={visiblePeriodTotals}
        />
      ) : (
        <div className="panel chart-card">
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--ink-muted)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--ink-muted)" }} tickFormatter={(v) => formatMoney(v)} width={72} />
                <Tooltip content={<ReportsTooltip />} wrapperStyle={{ zIndex: 100 }} />
                <Legend wrapperStyle={{ fontSize: 12, zIndex: 1 }} />
                {chartCategories.map((c) => (
                  <Bar
                    key={c.key}
                    dataKey={c.label}
                    stackId="a"
                    fill={c.key === "other" ? "var(--chart-other)" : categoryColor[c.label]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <DualScrollPanel>
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
      </DualScrollPanel>

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
