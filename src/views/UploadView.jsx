import React, { useRef, useState } from "react";
import { StatBlock } from "../components/common.jsx";
import { buildTransactions, readFileAsRows } from "../lib/importing.js";
import { guessHeader, uid } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Upload wizard                                                       */
/* ------------------------------------------------------------------ */

export function UploadView({ accounts, prefill, onImport }) {
  const [mode, setMode] = useState(() => {
    if (prefill && prefill.mode === "append") return "append";
    // Existing account is the common case after initial setup — default
    // to it whenever there's something to append to, rather than making
    // "create a new account" the default every time.
    return accounts.length > 0 ? "append" : "new";
  });
  const [targetAccountId, setTargetAccountId] = useState(
    (prefill && prefill.accountId) || (accounts[0] && accounts[0].id) || ""
  );
  const [fileInfo, setFileInfo] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [step, setStep] = useState("select");
  const [form, setForm] = useState({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", invertSign: false });
  const [reviewResult, setReviewResult] = useState(null);
  const fileInputRef = useRef(null);

  const existingAccount = mode === "append" ? accounts.find((a) => a.id === targetAccountId) : null;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (headers.length === 0) throw new Error("No columns were found in this file.");
      if (rows.length === 0) throw new Error("This file doesn't have any data rows.");
      setFileInfo({ headers, rows, fileName: file.name });

      const guessedName = file.name.replace(/\.(csv|xlsx|xls)$/i, "");
      if (mode === "append" && existingAccount) {
        setForm({
          name: existingAccount.name,
          dateCol: headers.includes(existingAccount.dateCol) ? existingAccount.dateCol : "",
          descriptionCol: headers.includes(existingAccount.descriptionCol) ? existingAccount.descriptionCol : "",
          outCol: headers.includes(existingAccount.outCol) ? existingAccount.outCol : "",
          inCol: headers.includes(existingAccount.inCol) ? existingAccount.inCol : "",
          invertSign: !!existingAccount.invertSign,
        });
      } else {
        setForm({
          name: guessedName,
          dateCol: guessHeader(headers, ["transaction date", "posted date", "date"]),
          descriptionCol: guessHeader(headers, ["description", "memo", "payee", "merchant", "name"]),
          outCol: guessHeader(headers, ["debit", "withdrawal", "money out", "amount out"]),
          inCol: guessHeader(headers, ["credit", "deposit", "money in", "amount in"]),
          invertSign: false,
        });
      }
      setStep("mapping");
    } catch (err) {
      setParseError(err.message || "Could not read this file.");
      setFileInfo(null);
    }
  }

  function handleMappingSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.dateCol || (!form.outCol && !form.inCol)) return;
    const accountId = mode === "append" && existingAccount ? existingAccount.id : uid();
    const { valid, invalid } = buildTransactions(fileInfo.rows, form, accountId, form.name.trim(), uid());
    setReviewResult({
      valid,
      invalid,
      accountMeta: {
        id: accountId,
        name: form.name.trim(),
        dateCol: form.dateCol,
        descriptionCol: form.descriptionCol,
        outCol: form.outCol,
        inCol: form.inCol,
        invertSign: form.invertSign,
        isNew: !(mode === "append" && existingAccount),
      },
    });
    setStep("review");
  }

  function confirmImport() {
    onImport(reviewResult.accountMeta, reviewResult.valid);
  }

  function resetWizard() {
    setFileInfo(null);
    setParseError(null);
    setStep("select");
    setForm({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", invertSign: false });
    setReviewResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canSubmitMapping = form.name.trim() && form.dateCol && (form.outCol || form.inCol);
  const sameColWarning = form.outCol && form.inCol && form.outCol === form.inCol;

  return (
    <div>
      <div className="view-header">
        <h1>Upload a statement</h1>
        <p>Add a new account to track, or bring in the latest transactions for one you already have.</p>
      </div>

      <div className="step-track">
        <span className={"step" + (step === "select" ? " current" : "")}>1. Choose file</span>
        <span>→</span>
        <span className={"step" + (step === "mapping" ? " current" : "")}>2. Map columns</span>
        <span>→</span>
        <span className={"step" + (step === "review" ? " current" : "")}>3. Review &amp; import</span>
      </div>

      {step === "select" && (
        <div className="panel">
          {accounts.length > 0 && (
            <div className="radio-row">
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "append"}
                  onChange={() => setMode("append")}
                />
                Add transactions to an existing account
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                This is a new account
              </label>
            </div>
          )}

          {mode === "append" && accounts.length > 0 && (
            <div className="field" style={{ maxWidth: 320 }}>
              <label>Account</label>
              <select value={targetAccountId} onChange={(e) => setTargetAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {parseError && <div className="error-banner">{parseError}</div>}

          <div className="dropzone">
            <div>
              <strong>Drop a .csv or .xlsx file here</strong>, or choose one below.
            </div>
            <label className="file-input-label">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFile}
              />
              <span className="btn btn-secondary">Choose file</span>
            </label>
          </div>
        </div>
      )}

      {step === "mapping" && fileInfo && (
        <div className="panel">
          <form onSubmit={handleMappingSubmit}>
            <div className="form-grid">
              <div className="field span-2">
                <label>What should this account be called?</label>
                <input
                  type="text"
                  value={form.name}
                  disabled={mode === "append"}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Date column</label>
                <select
                  value={form.dateCol}
                  onChange={(e) => setForm({ ...form, dateCol: e.target.value })}
                  required
                >
                  <option value="">Select a column…</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="hint">Use whichever date you track spending by — posted or transaction.</div>
              </div>
              <div className="field">
                <label>Description column</label>
                <select
                  value={form.descriptionCol}
                  onChange={(e) => setForm({ ...form, descriptionCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="hint">Payee, memo, or merchant — whatever names the transaction. Makes categorizing much easier.</div>
              </div>
              <div className="field">
                <label>Money out (expenses)</label>
                <select
                  value={form.outCol}
                  onChange={(e) => setForm({ ...form, outCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Money in (income)</label>
                <select
                  value={form.inCol}
                  onChange={(e) => setForm({ ...form, inCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {sameColWarning && (
              <div className="invert-note">
                <div className="hint">
                  Same column picked for both — that's fine for a single signed "Amount" column.
                  By default, positive values are treated as money in and negative as money out.
                </div>
                <label className="radio-option" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.invertSign}
                    onChange={(e) => setForm({ ...form, invertSign: e.target.checked })}
                  />
                  Flip it — on this account, positive values are money out (charges) and negative
                  values are money in (refunds/payments)
                </label>
              </div>
            )}

            <div className="hint" style={{ marginBottom: 10 }}>
              Preview of the first rows in {fileInfo.fileName}:
            </div>
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    {fileInfo.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fileInfo.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {fileInfo.headers.map((h) => (
                        <td key={h}>{String(row[h])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={!canSubmitMapping}>
                Check {fileInfo.rows.length} rows
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetWizard}>
                Start over
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "review" && reviewResult && (
        <div className="panel">
          <div className="summary-row">
            <StatBlock value={fileInfo.rows.length} label="Rows in file" />
            <StatBlock value={reviewResult.valid.length} label="Ready to import" />
            <StatBlock value={reviewResult.invalid.length} label="Could not be read" />
          </div>

          {reviewResult.invalid.length > 0 && (
            <>
              <div className="hint" style={{ marginBottom: 8 }}>
                These rows will be skipped if you continue:
              </div>
              <div className="invalid-list">
                {reviewResult.invalid.slice(0, 50).map((inv) => (
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
              className="btn btn-primary"
              onClick={confirmImport}
              disabled={reviewResult.valid.length === 0}
            >
              Import {reviewResult.valid.length} transaction{reviewResult.valid.length === 1 ? "" : "s"}
            </button>
            <button className="btn btn-secondary" onClick={() => setStep("mapping")}>
              Back to mapping
            </button>
            <button className="btn btn-ghost" onClick={resetWizard}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
