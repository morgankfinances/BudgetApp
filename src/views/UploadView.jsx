import React, { useRef, useState } from "react";
import { StatBlock } from "../components/common.jsx";
import { buildTransactions, readFileAsRows } from "../lib/importing.js";
import { guessHeader, uid } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Upload wizard                                                       */
/* ------------------------------------------------------------------ */

const NEW_ACCOUNT = "__new__";

// Words too common in account names to identify one ("Chase Credit Card").
const GENERIC_ACCOUNT_WORDS = new Set([
  "account", "accounts", "bank", "banking", "card", "cards", "credit", "debit", "checking", "savings", "saving",
  "joint", "personal", "business", "rewards", "reward", "visa", "mastercard", "amex", "discover", "statement",
  "transactions", "export", "download", "federal", "union", "trust", "national", "financial", "reserve", "money",
  "market", "high", "yield",
]);

// Picks the account a file clearly belongs to, or null. A match needs to be
// unambiguous: exactly one account named in the file name, or exactly one
// account whose saved columns all appear in the file.
export function matchAccountToFile(accounts, headers, fileName) {
  // By name: the file name contains one of the account name's distinctive
  // words ("Griffon" in "griffon-reserve-aug.csv"), ignoring generic ones
  // that many account names share.
  const words = (text) => String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const base = words(fileName.replace(/\.(csv|xlsx|xls)$/i, "")).join(" ");
  const byName = accounts.filter((a) =>
    words(a.name).some((w) => w.length >= 4 && !GENERIC_ACCOUNT_WORDS.has(w) && base.includes(w))
  );
  if (byName.length === 1) return { id: byName[0].id, reason: "name" };
  const byColumns = accounts.filter((a) => {
    const cols = [a.dateCol, a.descriptionCol, a.outCol, a.inCol].filter(Boolean);
    return cols.length >= 2 && cols.every((c) => headers.includes(c));
  });
  if (byColumns.length === 1) return { id: byColumns[0].id, reason: "columns" };
  return null;
}

export function UploadView({ accounts, prefill, onImport }) {
  // Which account the statement goes into. It's never silently defaulted:
  // it's pre-chosen only when the person started from that account ("Add
  // transactions"), when the file clearly matches one account, or when
  // there are no accounts yet (so it must be a new one).
  const [accountChoice, setAccountChoice] = useState(
    () => (prefill && prefill.accountId) || (accounts.length === 0 ? NEW_ACCOUNT : "")
  );
  const [choiceReason, setChoiceReason] = useState(prefill && prefill.accountId ? "prefill" : null);
  const [fileInfo, setFileInfo] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [step, setStep] = useState("select");
  const [form, setForm] = useState({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", invertSign: false });
  const [reviewResult, setReviewResult] = useState(null);
  const fileInputRef = useRef(null);

  const existingAccount = accounts.find((a) => a.id === accountChoice) || null;

  // Column settings for a given choice: an existing account's saved ones
  // (where the file has them), or best guesses for a new account.
  function mappingFor(choice, headers, fileName) {
    const acct = accounts.find((a) => a.id === choice);
    if (acct) {
      const keep = (col) => (headers.includes(col) ? col : "");
      return {
        name: acct.name,
        dateCol: keep(acct.dateCol),
        descriptionCol: keep(acct.descriptionCol),
        outCol: keep(acct.outCol),
        inCol: keep(acct.inCol),
        invertSign: !!acct.invertSign,
      };
    }
    return {
      name: fileName.replace(/\.(csv|xlsx|xls)$/i, ""),
      dateCol: guessHeader(headers, ["transaction date", "posted date", "date"]),
      descriptionCol: guessHeader(headers, ["description", "memo", "payee", "merchant", "name"]),
      outCol: guessHeader(headers, ["debit", "withdrawal", "money out", "amount out"]),
      inCol: guessHeader(headers, ["credit", "deposit", "money in", "amount in"]),
      invertSign: false,
    };
  }

  function changeAccount(choice) {
    setAccountChoice(choice);
    setChoiceReason(null);
    if (fileInfo) setForm(mappingFor(choice, fileInfo.headers, fileInfo.fileName));
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    try {
      const { headers, rows } = await readFileAsRows(file);
      if (headers.length === 0) throw new Error("No columns were found in this file.");
      if (rows.length === 0) throw new Error("This file doesn't have any data rows.");
      setFileInfo({ headers, rows, fileName: file.name });

      let choice = accountChoice;
      let reason = choiceReason;
      if (!(prefill && prefill.accountId) && accounts.length > 0) {
        const match = matchAccountToFile(accounts, headers, file.name);
        choice = match ? match.id : "";
        reason = match ? match.reason : null;
      }
      setAccountChoice(choice);
      setChoiceReason(reason);
      setForm(mappingFor(choice, headers, file.name));
      setStep("mapping");
    } catch (err) {
      setParseError(err.message || "Could not read this file.");
      setFileInfo(null);
    }
  }

  function handleMappingSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.dateCol || (!form.outCol && !form.inCol)) return;
    if (!accountChoice) return;
    const accountId = existingAccount ? existingAccount.id : uid();
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
        isNew: !existingAccount,
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

  const canSubmitMapping = accountChoice && form.name.trim() && form.dateCol && (form.outCol || form.inCol);
  // The chosen account's statements usually have columns this file lacks:
  // a sign it may be the wrong account.
  const missingColumns =
    existingAccount && fileInfo
      ? [existingAccount.dateCol, existingAccount.descriptionCol, existingAccount.outCol, existingAccount.inCol]
          .filter(Boolean)
          .filter((c, i, all) => all.indexOf(c) === i && !fileInfo.headers.includes(c))
      : [];
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
          <p className="hint" style={{ marginTop: 0 }}>
            {prefill && existingAccount ? (
              <>
                Adding transactions to <strong>{existingAccount.name}</strong>. You can change the account after
                choosing the file.
              </>
            ) : accounts.length > 0 ? (
              "Choose the statement file first. Next, you'll pick which account it belongs to."
            ) : (
              "Choose a statement file to set up your first account."
            )}
          </p>
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
            <div className="upload-target">
              <label htmlFor="upload-account" className="upload-target-label">
                {existingAccount ? (
                  <>
                    Uploading to <strong>{existingAccount.name}</strong>
                  </>
                ) : accountChoice === NEW_ACCOUNT ? (
                  "Uploading to a new account"
                ) : (
                  "Which account is this statement from?"
                )}
              </label>
              <select
                id="upload-account"
                value={accountChoice}
                onChange={(e) => changeAccount(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose an account…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>+ A new account</option>
              </select>
              {choiceReason && existingAccount && (
                <div className="hint">
                  {choiceReason === "prefill"
                    ? "Chosen because you started from this account."
                    : choiceReason === "name"
                      ? "Matched by the file's name. Please check it's right."
                      : "Matched by the file's columns. Please check it's right."}
                </div>
              )}
              {missingColumns.length > 0 && (
                <div className="upload-warning" role="alert">
                  This file doesn't have the columns {existingAccount.name}'s statements have used before (
                  {missingColumns.join(", ")}). Make sure this is the right account.
                </div>
              )}
            </div>
            <div className="form-grid">
              {accountChoice === NEW_ACCOUNT && (
                <div className="field span-2">
                  <label htmlFor="upload-new-name">What should this account be called?</label>
                  <input
                    id="upload-new-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
              )}
              <div className="field">
                <label>Date column</label>
                <select aria-label="Date column"
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
                <select aria-label="Description column"
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
                <select aria-label="Money out (expenses) column"
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
                <select aria-label="Money in (income) column"
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
          <p className="upload-review-target">
            {reviewResult.accountMeta.isNew ? "Creating a new account: " : "Adding to "}
            <strong>{reviewResult.accountMeta.name}</strong>
          </p>
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
              Import {reviewResult.valid.length} transaction{reviewResult.valid.length === 1 ? "" : "s"} into{" "}
              {reviewResult.accountMeta.name}
            </button>
            <button className="btn btn-secondary" onClick={() => setStep("mapping")}>
              Change account or columns
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
