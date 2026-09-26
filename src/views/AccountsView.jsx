import React, { useState } from "react";
import { EmptyState } from "../components/common.jsx";
import { formatMoney } from "../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Accounts view                                                       */
/* ------------------------------------------------------------------ */

export function AccountCard({ account, txCount, totalIn, totalOut, sampleRaw, onDelete, onAddTransactions, onRename, onUpdateSettings }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.name);
  const [confirming, setConfirming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const net = totalIn - totalOut;
  const headers = sampleRaw ? Object.keys(sampleRaw) : [];

  function startEdit() {
    setDraftName(account.name);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== account.name) onRename(account.id, trimmed);
    setEditing(false);
  }

  function openSettings() {
    setSettingsForm({
      dateCol: account.dateCol || "",
      descriptionCol: account.descriptionCol || "",
      outCol: account.outCol || "",
      inCol: account.inCol || "",
      invertSign: !!account.invertSign,
    });
    setSettingsOpen(true);
  }

  function saveSettings() {
    onUpdateSettings(account.id, settingsForm);
    setSettingsOpen(false);
  }

  const sameColWarning =
    settingsForm && settingsForm.outCol && settingsForm.inCol && settingsForm.outCol === settingsForm.inCol;
  const canSaveSettings =
    settingsForm && settingsForm.dateCol && (settingsForm.outCol || settingsForm.inCol);

  return (
    <div className="account-card-wrap">
      <div className="account-card">
        <div className="account-name-block">
          {editing ? (
            <div className="row-actions">
              <input
                type="text"
                value={draftName}
                autoFocus
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="name">
              {account.name}
              <button className="btn btn-ghost btn-sm" onClick={startEdit}>
                Rename
              </button>
            </div>
          )}
          <div className="meta">
            {txCount} transaction{txCount === 1 ? "" : "s"} · date column: {account.dateCol}
          </div>
        </div>
        <div className="figures">
          <div className={"net " + (net >= 0 ? "money-in" : "money-out")}>{formatMoney(net)}</div>
          <div className="meta">
            {formatMoney(totalIn)} in / {formatMoney(totalOut)} out
          </div>
        </div>
        <div className="row-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onAddTransactions(account.id)}>
            Add transactions
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
          >
            {settingsOpen ? "Close settings" : "Settings"}
          </button>
          {confirming ? (
            <span className="confirm-inline">
              Delete account and {txCount} transaction{txCount === 1 ? "" : "s"}?
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(account.id)}>
                Confirm
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {settingsOpen && settingsForm && (
        <div className="account-settings-panel">
          {headers.length === 0 ? (
            <div className="hint">
              There are no columns to choose from. Either this account has no transactions yet, or they were restored
              from a backup rather than uploaded from a bank file. To change which columns are used, upload a statement.
            </div>
          ) : (
            <>
              <div className="hint" style={{ marginBottom: 10 }}>
                Only the columns you mapped are kept from your bank's file, so you can rearrange these but not pick new
                ones. To use a different column, upload the statement again.
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Date column</label>
                  <select
                    value={settingsForm.dateCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, dateCol: e.target.value })}
                  >
                    <option value="">Select a column…</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Description column</label>
                  <select
                    value={settingsForm.descriptionCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, descriptionCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Money out column</label>
                  <select
                    value={settingsForm.outCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, outCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Money in column</label>
                  <select
                    value={settingsForm.inCol}
                    onChange={(e) => setSettingsForm({ ...settingsForm, inCol: e.target.value })}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
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
                    Same column picked for both — positive/negative in that column decides the direction.
                  </div>
                  <label className="radio-option" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={settingsForm.invertSign}
                      onChange={(e) => setSettingsForm({ ...settingsForm, invertSign: e.target.checked })}
                    />
                    Flip it — positive values are money out, negative are money in
                  </label>
                </div>
              )}

              <div className="hint" style={{ marginBottom: 10 }}>
                Saving reapplies these settings to all {txCount} existing transaction{txCount === 1 ? "" : "s"}{" "}
                for this account, not just future uploads. Any transaction that no longer parses cleanly is left
                unchanged.
              </div>

              <div className="actions-row">
                <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={!canSaveSettings}>
                  Save &amp; reapply
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSettingsOpen(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


export function AccountsView({ accounts, transactions, onDelete, onAddTransactions, onRename, onUpdateSettings, onGoUpload }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No accounts yet"
        body="Upload a statement to add the first account you'd like to track."
        ctaLabel="Upload a statement"
        onCta={() => onGoUpload(null)}
      />
    );
  }

  return (
    <div>
      <div className="view-header">
        <h1>Accounts</h1>
        <p>Every account you're tracking, and how its balance nets out so far.</p>
      </div>
      <div className="panel">
        {accounts.map((a) => {
          const txs = transactions.filter((t) => t.accountId === a.id);
          const totalIn = txs.reduce((s, t) => s + (t.amountIn || 0), 0);
          const totalOut = txs.reduce((s, t) => s + (t.amountOut || 0), 0);
          return (
            <AccountCard
              key={a.id}
              account={a}
              txCount={txs.length}
              totalIn={totalIn}
              totalOut={totalOut}
              sampleRaw={txs[0] ? txs[0].raw : null}
              onDelete={onDelete}
              onAddTransactions={onAddTransactions}
              onRename={onRename}
              onUpdateSettings={onUpdateSettings}
            />
          );
        })}
      </div>
    </div>
  );
}
