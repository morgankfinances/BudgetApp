import React, { useRef, useState } from "react";
import { StatBlock } from "../components/common.jsx";
import { BACKUP_COLUMNS, buildBudgetFromRows, buildFromBackupRows, exportBackupCSV, exportBudgetCSV } from "../lib/backup.js";
import { readFileAsRows } from "../lib/importing.js";
import { formatMoney } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Backup view                                                          */
/* ------------------------------------------------------------------ */

export function BackupView({ accounts, transactions, categories, budgetGroups, plannedIncome, onRestore, onRestoreBudget }) {
  const [fileInfo, setFileInfo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef(null);

  const [budgetPreview, setBudgetPreview] = useState(null);
  const [budgetParseError, setBudgetParseError] = useState(null);
  const [budgetApplying, setBudgetApplying] = useState(false);
  const [budgetApplied, setBudgetApplied] = useState(false);
  const budgetFileInputRef = useRef(null);

  function handleExport() {
    exportBackupCSV(accounts, transactions, categories);
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    setPreview(null);
    setConfirming(false);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (!headers.includes("Account") || !headers.includes("Date")) {
        throw new Error(
          'This doesn\'t look like a backup file — expected columns like "Account" and "Date". Use a file from this app\'s Export button, or match its column headers exactly.'
        );
      }
      setFileInfo({ headers, rows, fileName: file.name });
      setPreview(buildFromBackupRows(rows));
    } catch (err) {
      setParseError(err.message || "Could not read this file.");
      setFileInfo(null);
    }
  }

  function resetRestore() {
    setFileInfo(null);
    setPreview(null);
    setConfirming(false);
    setParseError(null);
    setRestoring(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleConfirmRestore() {
    if (!preview) return;
    setRestoring(true);
    onRestore(preview.accounts, preview.categories, preview.transactions);
  }

  function handleExportBudget() {
    exportBudgetCSV(categories, budgetGroups, plannedIncome);
  }

  async function handleBudgetFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBudgetParseError(null);
    setBudgetPreview(null);
    setBudgetApplied(false);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (!headers.includes("Row Type") || !headers.includes("Name")) {
        throw new Error(
          'This doesn\'t look like a budget backup file — expected columns like "Row Type" and "Name". Use a file from the Export button below.'
        );
      }
      setBudgetPreview(buildBudgetFromRows(rows, categories, budgetGroups));
    } catch (err) {
      setBudgetParseError(err.message || "Could not read this file.");
    }
  }

  function resetBudgetRestore() {
    setBudgetPreview(null);
    setBudgetParseError(null);
    setBudgetApplying(false);
    setBudgetApplied(false);
    if (budgetFileInputRef.current) budgetFileInputRef.current.value = "";
  }

  function handleApplyBudget() {
    if (!budgetPreview) return;
    setBudgetApplying(true);
    onRestoreBudget(budgetPreview.categories, budgetPreview.budgetGroups, budgetPreview.plannedIncome);
    setBudgetApplying(false);
    setBudgetApplied(true);
  }

  return (
    <div>
      <div className="view-header">
        <h1>Backup</h1>
        <p>Download everything as one CSV file, or rebuild the app's data from a backup file.</p>
      </div>

      <div className="excluded-note" style={{ justifyContent: "flex-start", marginBottom: 16, marginTop: 0 }}>
        <span>
          <strong>Order matters if you're restoring both:</strong> apply the ledger backup first, then the
          budget backup. Budget settings attach to categories by name — the ledger restore is what creates
          those categories in the first place, so applying the budget file before it (or without it) may
          leave some budgets with nothing to attach to.
        </span>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Export</h3>
        <p className="hint" style={{ marginBottom: 12 }}>
          Downloads every transaction across all accounts — with its account and category — as a single CSV.
          Good as a local backup, or to open and review in a spreadsheet.
        </p>
        <button className="btn btn-primary" onClick={handleExport} disabled={transactions.length === 0}>
          Download all data as CSV
        </button>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Restore</h3>
        <p className="hint" style={{ marginBottom: 12 }}>
          Rebuilds accounts, categories, and transactions from a backup file — the same column format the
          Export button above produces ({BACKUP_COLUMNS.join(", ")}). This replaces everything currently in the
          app, it doesn't merge with it.
        </p>

        {parseError && <div className="error-banner">{parseError}</div>}

        {!preview && (
          <label className="file-input-label">
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} />
            <span className="btn btn-secondary">Choose backup file</span>
          </label>
        )}

        {preview && !confirming && (
          <>
            <div className="summary-row">
              <StatBlock value={preview.accounts.length} label="Accounts found" />
              <StatBlock value={preview.categories.length} label="Categories found" />
              <StatBlock value={preview.transactions.length} label="Transactions ready" />
              <StatBlock value={preview.invalid.length} label="Rows skipped" />
            </div>

            {preview.invalid.length > 0 && (
              <>
                <div className="hint" style={{ marginBottom: 8 }}>
                  These rows will be left out:
                </div>
                <div className="invalid-list" style={{ marginBottom: 14 }}>
                  {preview.invalid.slice(0, 50).map((inv) => (
                    <div className="invalid-row" key={inv.rowIndex}>
                      <span>Row {inv.rowIndex + 2}</span>
                      <span className="reason">{inv.reasons.join(", ")}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="actions-row">
              <button
                className="btn btn-danger"
                onClick={() => setConfirming(true)}
                disabled={preview.transactions.length === 0}
              >
                Replace everything with this backup
              </button>
              <button className="btn btn-secondary" onClick={resetRestore}>
                Cancel
              </button>
            </div>
          </>
        )}

        {preview && confirming && (
          <div>
            <div className="error-banner">
              This deletes the {accounts.length} account{accounts.length === 1 ? "" : "s"} and{" "}
              {transactions.length} transaction{transactions.length === 1 ? "" : "s"} currently in the app,
              replacing them with what's in this file. If you change your mind, you can undo it for 7 days from
              Settings → Data History.
            </div>
            <div className="actions-row">
              <button className="btn btn-danger" onClick={handleConfirmRestore} disabled={restoring}>
                {restoring ? "Restoring…" : "Yes, replace everything"}
              </button>
              <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Budget data</h3>
        <p className="hint" style={{ marginBottom: 12 }}>
          A separate backup just for your budget setup — category and group budgets, Accumulate targets and
          what's actually been set aside each period, and your planned income. Handy for saving your setup
          before experimenting, or restoring it if something's lost.
        </p>
        <button
          className="btn btn-primary"
          onClick={handleExportBudget}
          disabled={categories.length === 0 && budgetGroups.length === 0 && plannedIncome == null}
        >
          Download budget setup as CSV
        </button>

        <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px dashed var(--border)" }}>
          <p className="hint" style={{ marginBottom: 12 }}>
            Applying a budget file <strong>updates or creates</strong> categories and groups by name — unlike
            the restore above, it never deletes anything not mentioned in the file.
          </p>

          {budgetParseError && <div className="error-banner">{budgetParseError}</div>}

          {!budgetPreview && (
            <label className="file-input-label">
              <input ref={budgetFileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleBudgetFile} />
              <span className="btn btn-secondary">Choose budget file</span>
            </label>
          )}

          {budgetPreview && !budgetApplied && (
            <>
              <div className="summary-row">
                <StatBlock value={budgetPreview.categoryCount} label="Categories in file" />
                <StatBlock value={budgetPreview.groupCount} label="Groups in file" />
                <StatBlock value={budgetPreview.plannedIncome != null ? formatMoney(budgetPreview.plannedIncome) : "—"} label="Planned income" />
                <StatBlock value={budgetPreview.invalid.length} label="Rows skipped" />
              </div>

              {budgetPreview.invalid.length > 0 && (
                <div className="invalid-list" style={{ marginBottom: 14 }}>
                  {budgetPreview.invalid.slice(0, 50).map((inv) => (
                    <div className="invalid-row" key={inv.rowIndex}>
                      <span>Row {inv.rowIndex + 2}</span>
                      <span className="reason">{inv.reasons.join(", ")}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="actions-row">
                <button className="btn btn-primary" onClick={handleApplyBudget} disabled={budgetApplying}>
                  {budgetApplying ? "Applying…" : "Apply budget file"}
                </button>
                <button className="btn btn-secondary" onClick={resetBudgetRestore}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {budgetApplied && (
            <div>
              <p className="hint" style={{ marginBottom: 10 }}>Applied.</p>
              <button className="btn btn-secondary" onClick={resetBudgetRestore}>
                Choose another file
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
