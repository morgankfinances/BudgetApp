import React, { useRef, useState } from "react";
import { StatBlock } from "../components/common.jsx";
import { OFX_MAPPING, buildTransactions, readFileAsRows } from "../lib/importing.js";
import { formatDateDisplay, formatMoney, guessHeader, uid } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Upload wizard                                                       */
/* ------------------------------------------------------------------ */

const NEW_ACCOUNT = "__new__";

// How the duplicates found at review were matched, in words.
function matchedByText(skipped) {
  const byId = skipped.filter((s) => s.by === "id").length;
  if (byId === skipped.length) return "matched by the bank's transaction IDs";
  if (byId === 0) return "matched by account, date, amount, and description";
  return "matched by the bank's transaction IDs, or by account, date, amount, and description where there's no ID to compare";
}

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

export function UploadView({ accounts, prefill, onImport, sortDuplicates = null, duplicateHandling = "skip" }) {
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
  const [form, setForm] = useState({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", idCol: "", invertSign: false });
  // Which transactions found already in Coinrose to import anyway.
  const [importAnyway, setImportAnyway] = useState(() => new Set());
  const [reviewResult, setReviewResult] = useState(null);
  const fileInputRef = useRef(null);

  const existingAccount = accounts.find((a) => a.id === accountChoice) || null;

  // Column settings for a given choice: an existing account's saved ones
  // (where the file has them), or best guesses for a new account.
  function mappingFor(choice, headers, fileName, format) {
    const acct = accounts.find((a) => a.id === choice);
    if (format === "ofx") {
      return { name: acct ? acct.name : fileName.replace(/\.(ofx|qfx)$/i, ""), ...OFX_MAPPING };
    }
    if (acct) {
      const keep = (col) => (headers.includes(col) ? col : "");
      return {
        name: acct.name,
        dateCol: keep(acct.dateCol),
        descriptionCol: keep(acct.descriptionCol),
        outCol: keep(acct.outCol),
        inCol: keep(acct.inCol),
        idCol: keep(acct.idCol),
        invertSign: !!acct.invertSign,
      };
    }
    return {
      name: fileName.replace(/\.(csv|xlsx|xls)$/i, ""),
      dateCol: guessHeader(headers, ["transaction date", "posted date", "date"]),
      descriptionCol: guessHeader(headers, ["description", "memo", "payee", "merchant", "name"]),
      outCol: guessHeader(headers, ["debit", "withdrawal", "money out", "amount out"]),
      inCol: guessHeader(headers, ["credit", "deposit", "money in", "amount in"]),
      idCol: guessHeader(headers, ["transaction id", "transaction number", "reference number", "reference no", "fitid"]),
      invertSign: false,
    };
  }

  function changeAccount(choice) {
    setAccountChoice(choice);
    setChoiceReason(null);
    if (fileInfo) setForm(mappingFor(choice, fileInfo.headers, fileInfo.fileName, fileInfo.format));
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    try {
      const { headers, rows, format = null, accountHint = null } = await readFileAsRows(file);
      if (headers.length === 0) throw new Error("No columns were found in this file.");
      if (rows.length === 0) throw new Error("This file doesn't have any data rows.");
      setFileInfo({ headers, rows, fileName: file.name, format, accountHint });

      let choice = accountChoice;
      let reason = choiceReason;
      if (!(prefill && prefill.accountId) && accounts.length > 0) {
        const match = matchAccountToFile(accounts, headers, file.name);
        choice = match ? match.id : "";
        reason = match ? match.reason : null;
      }
      setAccountChoice(choice);
      setChoiceReason(reason);
      setForm(mappingFor(choice, headers, file.name, format));
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
        idCol: form.idCol || "",
        isNew: !existingAccount,
      },
      duplicates: sortDuplicates ? sortDuplicates(valid) : null,
    });
    setImportAnyway(new Set());
    setStep("review");
  }

  function confirmImport() {
    const d = reviewResult.duplicates;
    if (!d) return onImport(reviewResult.accountMeta, reviewResult.valid);
    const anyway = d.skipped.filter((s) => importAnyway.has(s.transaction.id)).map((s) => s.transaction);
    onImport(reviewResult.accountMeta, reviewResult.valid, {
      imported: [...d.imported, ...anyway],
      skipped: d.skipped.filter((s) => !importAnyway.has(s.transaction.id)),
      alreadySkipped: d.alreadySkipped,
    });
  }
  const importCount = reviewResult
    ? reviewResult.duplicates
      ? reviewResult.duplicates.imported.length + importAnyway.size
      : reviewResult.valid.length
    : 0;

  function resetWizard() {
    setFileInfo(null);
    setParseError(null);
    setStep("select");
    setForm({ name: "", dateCol: "", descriptionCol: "", outCol: "", inCol: "", idCol: "", invertSign: false });
    setReviewResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canSubmitMapping = accountChoice && form.name.trim() && form.dateCol && (form.outCol || form.inCol);
  // The chosen account's statements usually have columns this file lacks:
  // a sign it may be the wrong account.
  const missingColumns =
    existingAccount && fileInfo && fileInfo.format !== "ofx"
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
              <strong>Drop a statement file here</strong> (.csv, .xlsx, .ofx, or .qfx), or choose one below.
            </div>
            <label className="file-input-label">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.ofx,.qfx"
                onChange={handleFile}
              />
              <span className="btn btn-secondary">Choose file</span>
            </label>
          </div>
          <div className="upload-tip">
            <strong>Tip: choose OFX or QFX if your bank offers it.</strong> Banks often list these as "Quicken," "Money," or
            "OFX" downloads. They give every transaction the bank's own ID, so when statements overlap, Coinrose recognizes
            the ones you've already uploaded with certainty. A CSV with a transaction ID or reference number column works
            the same way. Without IDs, Coinrose matches duplicates by account, date, amount, and description, which is
            reliable, but can't tell two identical purchases on the same day from one uploaded twice.
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
            {fileInfo.format === "ofx" && (
              <div className="hint" style={{ marginBottom: 12 }}>
                Read from an OFX/QFX file: the columns below, including the bank's transaction IDs, were filled in for you.
                {fileInfo.accountHint && (
                  <>
                    {" "}
                    This file is for an account ending in <strong>{fileInfo.accountHint}</strong> (shown only to help you
                    choose; Coinrose doesn't save account numbers).
                  </>
                )}
              </div>
            )}
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
              <div className="field span-2">
                <label htmlFor="upload-id-col">Transaction ID (optional)</label>
                <select
                  id="upload-id-col"
                  value={form.idCol}
                  onChange={(e) => setForm({ ...form, idCol: e.target.value })}
                >
                  <option value="">None</option>
                  {fileInfo.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="hint">
                  If the file has a unique ID or reference number for each transaction, choose it: Coinrose then recognizes
                  duplicates by ID, with certainty. This is the bank's reference for a single transaction, never an
                  account number.
                </div>
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
            <StatBlock value={importCount} label="Ready to import" />
            {reviewResult.duplicates && reviewResult.duplicates.skipped.length + reviewResult.duplicates.alreadySkipped > 0 && (
              <StatBlock
                value={reviewResult.duplicates.skipped.length - importAnyway.size + reviewResult.duplicates.alreadySkipped}
                label="Already in Coinrose"
              />
            )}
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

          {reviewResult.duplicates && reviewResult.duplicates.skipped.length > 0 && (
            <div className="duplicate-review">
              <p style={{ margin: "0 0 6px" }}>
                <strong>
                  {reviewResult.duplicates.skipped.length} already in Coinrose, so{" "}
                  {reviewResult.duplicates.skipped.length === 1 ? "it" : "they"} will be skipped
                </strong>{" "}
                ({matchedByText(reviewResult.duplicates.skipped)}). Tick any that really are separate transactions to import them anyway. Skipped ones can also be restored
                later from Transactions.
              </p>
              <div className="invalid-list">
                {reviewResult.duplicates.skipped.map(({ transaction: t }) => (
                  <label className="invalid-row duplicate-row" key={t.id}>
                    <input
                      type="checkbox"
                      checked={importAnyway.has(t.id)}
                      onChange={(e) => {
                        const next = new Set(importAnyway);
                        if (e.target.checked) next.add(t.id);
                        else next.delete(t.id);
                        setImportAnyway(next);
                      }}
                      aria-label={`Import anyway: ${t.description}, ${formatDateDisplay(t.date)}, ${formatMoney(t.amountOut || t.amountIn)}`}
                    />
                    <span>{formatDateDisplay(t.date)}</span>
                    <span>{t.description}</span>
                    <span>{t.amountOut != null ? `−${formatMoney(t.amountOut)}` : `+${formatMoney(t.amountIn)}`}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {reviewResult.duplicates && reviewResult.duplicates.alreadySkipped > 0 && (
            <p className="hint">
              {reviewResult.duplicates.alreadySkipped} more {reviewResult.duplicates.alreadySkipped === 1 ? "was" : "were"}{" "}
              already skipped in an earlier import (or listed twice in this file), and won't be added again.
            </p>
          )}
          {duplicateHandling !== "skip" && (
            <p className="hint">
              Duplicates aren't skipped automatically (see Settings → Importing).
            </p>
          )}
          <div className="actions-row">
            <button
              className="btn btn-primary"
              onClick={confirmImport}
              disabled={importCount === 0}
            >
              Import {importCount} transaction{importCount === 1 ? "" : "s"} into {reviewResult.accountMeta.name}
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
