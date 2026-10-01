// src/components/BalanceChart.jsx
// Estimated balance over time, one account at a time (or all tracked
// accounts combined), so each line has its own scale and stays readable.
// Drawn as steps, since a balance changes in jumps when transactions land,
// not gradually in between. A sentence beside it gives the same numbers in
// words (screen readers get the sentence; the chart itself is decorative).

import React, { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { balanceHistory, combinedHistory, hasStartingBalance, summarizeHistory } from "../lib/balances.js";
import { formatDateDisplay, formatMoney } from "../lib/utils.js";

const COMBINED = "__all__";
const toTime = (iso) => new Date(`${iso}T00:00:00Z`).getTime();
const shortDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const compactMoney = (n) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(abs)}`;
};

export function BalanceChart({ accounts, transactions, height = 240 }) {
  const tracked = accounts.filter(hasStartingBalance);
  const [choice, setChoice] = useState(() => (tracked[0] ? tracked[0].id : COMBINED));
  const selected = tracked.find((a) => a.id === choice) || null;
  const showingCombined = choice === COMBINED || !selected;
  const owed = !showingCombined && !!selected.startingBalance.owed;

  const points = useMemo(
    () => (showingCombined ? combinedHistory(accounts, transactions) : balanceHistory(selected, transactions)),
    [showingCombined, selected, accounts, transactions]
  );
  const summary = summarizeHistory(points);
  if (!tracked.length || !summary) return null;

  const data = points.map((p) => ({ t: toTime(p.date), value: p.value }));
  const what = showingCombined ? "In accounts minus owed" : owed ? "Amount owed" : "Balance";
  const direction = summary.change === 0 ? "no change" : `${summary.change > 0 ? "up" : "down"} ${formatMoney(Math.abs(summary.change))}`;

  return (
    <div className="balance-chart">
      <div className="balance-chart-head">
        <label htmlFor="balance-chart-account">Show</label>
        <select id="balance-chart-account" value={showingCombined ? COMBINED : choice} onChange={(e) => setChoice(e.target.value)}>
          {tracked.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {tracked.length > 1 && <option value={COMBINED}>All tracked accounts combined</option>}
        </select>
      </div>
      <p className="balance-chart-summary" aria-live="polite">
        {what}: {formatMoney(summary.start.value)} on {formatDateDisplay(summary.start.date)}, now {formatMoney(summary.end.value)} as
        of {formatDateDisplay(summary.end.date)} ({direction}). Lowest {formatMoney(summary.low.value)} on{" "}
        {formatDateDisplay(summary.low.date)}; highest {formatMoney(summary.high.value)} on {formatDateDisplay(summary.high.date)}.
        {owed ? " For a card or loan, lower is better." : ""}
      </p>
      <div style={{ width: "100%", height }} aria-hidden="true">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} accessibilityLayer={false}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={shortDate}
              tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
              stroke="var(--border)"
              minTickGap={24}
            />
            <YAxis tickFormatter={compactMoney} tick={{ fill: "var(--ink-muted)", fontSize: 12 }} stroke="var(--border)" width={56} />
            <Tooltip
              formatter={(v) => [formatMoney(v), what]}
              labelFormatter={(ms) => formatDateDisplay(new Date(ms).toISOString().slice(0, 10))}
              contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink)" }}
            />
            <Line type="stepAfter" dataKey="value" stroke={owed ? "var(--expense)" : "var(--accent-button)"} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
