// src/views/InsightsView.jsx
// Patterns Coinrose noticed: quick insights, recurring bills and
// subscriptions, and recurring income. Nothing on this page changes any
// transactions; "Not recurring" only hides an item from these lists.

import React, { useState } from "react";
import { formatDateDisplay, formatMoney } from "../lib/utils.js";

function RecurringTable({ items, categories, today, onHide, caption }) {
  const nameOf = (id) => (categories.find((c) => c.id === id) || {}).name || "Uncategorized";
  return (
    <div className="panel insights-table-wrap" tabIndex={0} role="region" aria-label={`${caption} (scrolls sideways on small screens)`}>
      <table className="insights-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">How often</th>
            <th scope="col">Usually</th>
            <th scope="col">Per month</th>
            <th scope="col">Next expected</th>
            <th scope="col">Category</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.name}
                {r.priceChange && r.priceChange.to > r.priceChange.from && (
                  <span className="insight-badge insight-badge-watch">Price went up</span>
                )}
                <span className="hint" style={{ display: "block" }}>
                  {r.accountName} · seen {r.count} times
                </span>
              </th>
              <td>{r.cadenceLabel}</td>
              <td>
                {r.fixed ? "" : "about "}
                {formatMoney(r.typicalAmount)}
                <span className="hint" style={{ display: "block" }}>
                  {r.fixed ? "Same each time" : "Amount varies"}
                </span>
              </td>
              <td>{formatMoney(r.monthlyCost)}</td>
              <td>{r.nextDate >= today ? formatDateDisplay(r.nextDate) : `Was expected ${formatDateDisplay(r.nextDate)}`}</td>
              <td>{r.isSplit ? "Split" : nameOf(r.categoryId)}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onHide(r.key)}
                  aria-label={`Not recurring: hide ${r.name} from these lists`}
                >
                  Not recurring
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsView({ insights, recurring, hiddenRecurring = [], categories, today, onHideRecurring, onShowRecurring }) {
  const [showHidden, setShowHidden] = useState(false);
  const hidden = new Set(hiddenRecurring);
  // Soonest first, like a timeline (anything overdue comes first).
  const byNextDate = (a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name);
  const bills = recurring.filter((r) => r.direction === "out" && !hidden.has(r.key)).sort(byNextDate);
  const income = recurring.filter((r) => r.direction === "in" && !hidden.has(r.key)).sort(byNextDate);
  const hiddenItems = recurring.filter((r) => hidden.has(r.key));
  const monthlyBills = bills.reduce((s, r) => s + r.monthlyCost, 0);

  return (
    <div>
      <div className="view-header">
        <h1>Insights</h1>
        <p>Patterns Coinrose noticed in your transactions. Nothing here changes your data.</p>
      </div>

      <h2 className="insights-heading">At a glance</h2>
      {insights.length ? (
        <ul className="insights-grid">
          {insights.map((i) => (
            <li key={i.id} className={`insight-card insight-${i.tone}`}>
              <h3>{i.title}</h3>
              <p>{i.body}</p>
              {i.details && i.details.items.length > 0 && (
                <details className="insight-details">
                  <summary>{i.details.label}</summary>
                  <ul>
                    {i.details.items.map((d) => (
                      <li key={d.key}>
                        <span>
                          {d.name}
                          {d.date && <span className="hint insight-details-date">{formatDateDisplay(d.date)}</span>}
                        </span>
                        <span className="insight-details-amount">
                          {d.approximate ? "about " : ""}
                          {formatMoney(d.amount)}
                          {d.suffix ? ` ${d.suffix}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Insights appear once there's about a month of transactions to compare.</p>
      )}

      <h2 className="insights-heading">Recurring bills and subscriptions</h2>
      {bills.length ? (
        <>
          <p className="hint insights-intro">
            {bills.length} found, about <strong>{formatMoney(monthlyBills)} a month</strong> in total. Recurring means at
            least three charges on a steady schedule (two for quarterly or yearly ones).
          </p>
          <RecurringTable items={bills} categories={categories} today={today} onHide={onHideRecurring} caption="Recurring bills and subscriptions" />
        </>
      ) : (
        <p className="hint">
          None found yet. Coinrose needs at least three charges on a steady schedule to spot one, so check back after a
          few statements.
        </p>
      )}

      {income.length > 0 && (
        <>
          <h2 className="insights-heading">Recurring income</h2>
          <RecurringTable items={income} categories={categories} today={today} onHide={onHideRecurring} caption="Recurring income" />
        </>
      )}

      {hiddenItems.length > 0 && (
        <div className="skipped-panel" style={{ marginTop: 40 }}>
          <button
            type="button"
            className="skipped-toggle"
            aria-expanded={showHidden}
            aria-controls="hidden-recurring"
            onClick={() => setShowHidden(!showHidden)}
          >
            {showHidden ? "▾" : "▸"} Marked not recurring ({hiddenItems.length})
          </button>
          {showHidden && (
            <ul className="skipped-list" id="hidden-recurring">
              {hiddenItems.map((r) => (
                <li key={r.key} className="skipped-item">
                  <span>
                    {r.name} · {r.cadenceLabel.toLowerCase()} · {formatMoney(r.typicalAmount)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onShowRecurring(r.key)}
                    aria-label={`Show ${r.name} again`}
                  >
                    Show again
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
