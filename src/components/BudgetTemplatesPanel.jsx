// src/components/BudgetTemplatesPanel.jsx
// On Planning: import a budget (a Coinrose template, or a YNAB plan
// export), see exactly what would change, then apply it; or download your
// budget as a template to share. Templates hold budgets only: no
// transactions or spending history.

import React, { useRef, useState } from "react";
import { downloadCSV } from "../lib/backup.js";
import { buildBudgetTemplate, buildExampleTemplate, planBudgetImport, readBudgetFile } from "../lib/budgetTemplates.js";

const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function BudgetTemplatesPanel({ categories, budgetGroups, plannedIncome, onApply }) {
  const [fileText, setFileText] = useState(null);
  const [basis, setBasis] = useState("average");
  const [createMissing, setCreateMissing] = useState(true);
  const [includeIncome, setIncludeIncome] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  let read = null;
  let preview = null;
  if (fileText != null && !error) {
    try {
      read = readBudgetFile(fileText, { basis });
      preview = planBudgetImport(read.plan, { categories, budgetGroups, plannedIncome }, { createMissing });
    } catch (e) {
      read = null;
    }
  }

  async function chooseFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError("");
    const text = await file.text();
    try {
      readBudgetFile(text, { basis });
      setFileText(text);
    } catch (err) {
      setFileText(null);
      setError(err.message);
    }
    if (inputRef.current) inputRef.current.value = "";
  }
  const reset = () => {
    setFileText(null);
    setError("");
  };
  const changes = preview ? preview.rows.filter((r) => r.status !== "same") : [];

  return (
    <div className="panel budget-templates">
      <h3 style={{ marginTop: 0 }}>Import or share a budget</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Bring in a budget from a template or from YNAB, or share yours with someone else. Templates hold budgets only: no
        transactions or spending history.
      </p>
      <div className="actions-row">
        <label className="btn btn-primary" style={{ cursor: "pointer" }}>
          Import a budget file…
          <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" onChange={chooseFile} className="visually-hidden" />
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => downloadCSV(buildBudgetTemplate({ categories, budgetGroups, plannedIncome }, { includeIncome }), "coinrose-budget-template.csv")}>
          Download my budget as a template
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => downloadCSV(buildExampleTemplate(), "coinrose-budget-example.csv")}>
          Download an example
        </button>
      </div>
      <label className="checkbox-filter" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={includeIncome} onChange={(e) => setIncludeIncome(e.target.checked)} />
        Include my planned income in my template (leave this off when sharing)
      </label>

      {error && (
        <div className="error-banner" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {read && preview && (
        <div className="duplicate-review" role="region" aria-label="Budget to import">
          {read.format === "ynab" ? (
            <>
              <p style={{ margin: "0 0 6px" }}>
                <strong>A YNAB plan export.</strong> Each category's budget is{" "}
                {basis === "average" ? `the average assigned over ${read.details.months.map(monthName).join(", ")}` : `what was assigned in ${monthName(read.details.months[0])}`}.
              </p>
              <div role="radiogroup" aria-label="Which YNAB amounts to use" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5, margin: "0 0 6px" }}>
                <label>
                  <input type="radio" name="ynab-basis" checked={basis === "average"} onChange={() => setBasis("average")} /> Average of the last 3 months
                </label>
                <label>
                  <input type="radio" name="ynab-basis" checked={basis === "latest"} onChange={() => setBasis("latest")} /> Most recent month only
                </label>
              </div>
              <p className="hint" style={{ margin: "0 0 8px" }}>
                Everything comes in as monthly Spend budgets; change savings categories to Accumulate afterward.
                {read.details.skipped.length > 0 && ` Skipped, since they aren't budgets: ${read.details.skipped.join(", ")}.`} YNAB's
                category groups aren't brought over, because in Coinrose a group shares one budget.
              </p>
            </>
          ) : (
            <p style={{ margin: "0 0 8px" }}>
              <strong>A Coinrose budget template.</strong>
              {read.details.problems.length > 0 && <span className="hint"> {read.details.problems.join(" ")}</span>}
            </p>
          )}
          <label className="checkbox-filter" style={{ margin: "0 0 8px" }}>
            <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
            Add categories that aren't in Coinrose yet
          </label>
          <p style={{ margin: "0 0 8px" }} aria-live="polite">
            {changes.length === 0
              ? "Nothing would change: your budgets already match this file."
              : [
                  preview.counts.incomeChanges && "planned income",
                  preview.counts.changed && `${preview.counts.changed} budget${preview.counts.changed === 1 ? "" : "s"} changed`,
                  preview.counts.added && `${preview.counts.added} new categor${preview.counts.added === 1 ? "y" : "ies"}`,
                  preview.counts.groupsAdded && `${preview.counts.groupsAdded} new budget group${preview.counts.groupsAdded === 1 ? "" : "s"}`,
                  preview.counts.groupsChanged && `${preview.counts.groupsChanged} budget group${preview.counts.groupsChanged === 1 ? "" : "s"} changed`,
                ]
                  .filter(Boolean)
                  .join(", ") + `. ${preview.counts.unchanged ? `${preview.counts.unchanged} already match${preview.counts.unchanged === 1 ? "es" : ""}.` : ""}`}
          </p>
          {changes.length > 0 && (
            <div className="budget-import-table-wrap" tabIndex={0} role="region" aria-label="Changes this import would make">
              <table className="budget-import-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Now</th>
                    <th scope="col">After import</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((r) => (
                    <tr key={`${r.kind}-${r.name}`} className={r.status === "skipped" ? "is-skipped" : ""}>
                      <th scope="row">
                        {r.name}
                        {r.kind !== "Category" && <span className="hint"> ({r.kind === "Group" ? "budget group" : "income"})</span>}
                      </th>
                      <td>{r.before}</td>
                      <td>{r.status === "skipped" ? "Skipped" : r.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint" style={{ margin: "8px 0" }}>
            Only budgets change: your transactions and categories' history stay as they are. You can undo this from Settings →
            Data History for 7 days.
          </p>
          <div className="actions-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={changes.filter((r) => r.status !== "skipped").length === 0}
              onClick={() => {
                onApply(preview.next);
                reset();
              }}
            >
              Apply this budget
            </button>
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <details className="budget-format">
        <summary>Template format, and importing from YNAB</summary>
        <p>
          A template is a CSV file you can make or edit in any spreadsheet. Each row is one of: <strong>Income</strong> (your
          planned monthly income, optional), a <strong>Category</strong> budget, or a <strong>Group</strong> (a budget several
          categories share).
        </p>
        <div className="budget-import-table-wrap" tabIndex={0} role="region" aria-label="Template columns">
          <table className="budget-import-table">
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">What goes in it</th>
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">Kind</th><td>Income, Category, or Group</td></tr>
              <tr><th scope="row">Name</th><td>The category or group name. Existing names are matched, ignoring capitals and emoji.</td></tr>
              <tr><th scope="row">Amount</th><td>The budget, like 600. Blank means no budget.</td></tr>
              <tr><th scope="row">Period</th><td>monthly or weekly</td></tr>
              <tr><th scope="row">Type</th><td>Spend (a limit that resets) or Accumulate (saves up over time)</td></tr>
              <tr><th scope="row">Goal</th><td>For Accumulate: the amount you're saving toward (optional)</td></tr>
              <tr><th scope="row">Group</th><td>For a Category: the budget group it belongs to (optional)</td></tr>
            </tbody>
          </table>
        </div>
        <pre className="budget-format-example">{buildExampleTemplate().split("\n").slice(0, 4).join("\n")}</pre>
        <p>
          <strong>From YNAB:</strong> in YNAB's web app, click your plan's name, choose <strong>Export Plan</strong>, and unzip
          the download. Import the plan file (not the register). Coinrose uses what you assigned each category, averaged over
          the last 3 months or from the most recent month.
        </p>
      </details>
    </div>
  );
}
