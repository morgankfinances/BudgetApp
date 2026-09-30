// src/components/SplitEditor.jsx
// Divides one transaction among several categories. Shows what's assigned
// and what's left as you go; saving needs it to add up exactly. Quick
// splits divide evenly (halves, thirds, quarters) or by percentage.

import React, { useState } from "react";
import { formatMoney } from "../lib/utils.js";
import { checkSplit, cleanSplitLines, evenSplit, hasSplits, percentsToAmounts, transactionTotal } from "../lib/splits.js";

const blankLine = (categoryId = "") => ({ categoryId, amount: "", percent: "" });
// Amounts the editor fills in itself always show cents ("18.20", not "18.2").
const money2 = (n) => (Number(n) || 0).toFixed(2);

export function SplitEditor({ t, categories, onSave, onCancel }) {
  const total = transactionTotal(t);
  const [mode, setMode] = useState("amount"); // "amount" | "percent"
  const [lines, setLines] = useState(() =>
    hasSplits(t)
      ? t.splits.map((s) => ({ categoryId: s.categoryId || "", amount: money2(s.amount), percent: "" }))
      : [blankLine(t.categoryId || ""), blankLine()]
  );

  // In percentage mode, amounts come from the percentages.
  const amounts =
    mode === "percent" ? percentsToAmounts(total, lines.map((l) => l.percent)) : lines.map((l) => Number(l.amount) || 0);
  const priced = lines.map((l, i) => ({ categoryId: l.categoryId, amount: amounts[i] }));
  const status = checkSplit(total, priced);
  const percentUsed = lines.reduce((sum, l) => sum + (Number(l.percent) || 0), 0);

  const update = (i, patch) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const splitEvenly = (parts) => {
    const even = evenSplit(total, parts);
    setMode("amount");
    setLines(Array.from({ length: parts }, (_, i) => ({ ...(lines[i] || blankLine()), amount: money2(even[i]), percent: "" })));
  };
  const restHere = (i) => {
    if (mode === "percent") update(i, { percent: String(Math.round(((Number(lines[i].percent) || 0) + 100 - percentUsed) * 100) / 100) });
    else update(i, { amount: money2((Number(lines[i].amount) || 0) + status.remaining) });
  };
  const switchMode = (next) => {
    if (next === mode) return;
    if (next === "percent") {
      setLines(lines.map((l) => ({ ...l, percent: total ? String(Math.round(((Number(l.amount) || 0) / total) * 10000) / 100) : "" })));
    } else {
      setLines(lines.map((l, i) => ({ ...l, amount: amounts[i] ? money2(amounts[i]) : "" })));
    }
    setMode(next);
  };

  return (
    <div className="split-editor" role="group" aria-label={`Split ${t.description || "transaction"} among categories`}>
      <div className="split-editor-head">
        <span>
          <strong>Split {formatMoney(total)}</strong> among categories
        </span>
        <span className="split-quick">
          <span className="hint">Quick split:</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => splitEvenly(2)}>
            ½ each
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => splitEvenly(3)}>
            ⅓ each
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => splitEvenly(4)}>
            ¼ each
          </button>
          <label className="checkbox-filter">
            <input type="checkbox" checked={mode === "percent"} onChange={(e) => switchMode(e.target.checked ? "percent" : "amount")} />
            By percentage
          </label>
        </span>
      </div>

      {lines.map((line, i) => (
        <div className="split-line" key={i}>
          <select
            aria-label={`Category for part ${i + 1}`}
            value={line.categoryId}
            onChange={(e) => update(i, { categoryId: e.target.value })}
          >
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {mode === "percent" ? (
            <span className="split-amount">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                aria-label={`Percent for part ${i + 1}`}
                value={line.percent}
                onChange={(e) => update(i, { percent: e.target.value })}
              />
              % <span className="hint">= {formatMoney(amounts[i])}</span>
            </span>
          ) : (
            <span className="split-amount">
              $
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                aria-label={`Amount for part ${i + 1}`}
                value={line.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
              />
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => restHere(i)} disabled={status.remaining <= 0 && mode === "amount"}>
            Put the rest here
          </button>
          {lines.length > 2 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Remove part ${i + 1}`}
              onClick={() => setLines(lines.filter((_, k) => k !== i))}
            >
              ×
            </button>
          )}
        </div>
      ))}

      <div className="split-editor-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines([...lines, blankLine()])}>
          + Add a line
        </button>
        <span className={status.remaining === 0 ? "split-status split-status-ok" : "split-status"} aria-live="polite">
          {status.remaining === 0
            ? `Fully assigned: ${formatMoney(status.assigned)}`
            : status.remaining > 0
              ? `Assigned ${formatMoney(status.assigned)} of ${formatMoney(total)} · ${formatMoney(status.remaining)} unassigned`
              : `Assigned ${formatMoney(status.assigned)}: ${formatMoney(-status.remaining)} more than the transaction`}
        </span>
      </div>

      <div className="actions-row">
        <button type="button" className="btn btn-primary btn-sm" disabled={!status.ok} onClick={() => onSave(cleanSplitLines(priced))}>
          Save split
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        {hasSplits(t) && (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onSave(null)}>
            Remove split
          </button>
        )}
      </div>
      {!status.ok && (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          To save, give every line a category and an amount, with nothing left unassigned.
        </p>
      )}
    </div>
  );
}
