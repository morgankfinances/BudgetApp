import React, { useState } from "react";
import { EmptyState } from "../components/common.jsx";
import { formatDateDisplay, formatMoney, todayISO } from "../lib/utils.js";
import { estimateBalance, totalBalances } from "../lib/balances.js";
import { StatBlock } from "../components/common.jsx";
import { BalanceChart } from "../components/BalanceChart.jsx";

/* ------------------------------------------------------------------ */
/* Accounts view                                                       */
/* ------------------------------------------------------------------ */

export function AccountCard({ account, txCount, totalIn, totalOut, sampleRaw, onDelete, onAddTransactions, onRename, onUpdateSettings, estimate = null, onSetStartingBalance }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.name);
  const [confirming, setConfirming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const [balanceForm, setBalanceForm] = useState(null); // open editor: { amount, date, owed }
  const openBalance = () => {
    const b = account.startingBalance;
    setBalanceForm(b ? { amount: String(b.amount), date: b.date, owed: !!b.owed } : { amount: "", date: todayISO(), owed: false });
  };
  const balanceAmountOk = balanceForm && balanceForm.amount.trim() !== "" && Number.isFinite(Number(balanceForm.amount));
  const balanceDateOk = balanceForm && /^\d{4}-\d{2}-\d{2}$/.test(balanceForm.date);
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

      {onSetStartingBalance && (
        <div className="balance-row">
          {estimate ? (
            <>
              <div>
                <div className="balance-label">{estimate.owed ? "Estimated amount owed" : "Estimated balance"}</div>
                <div className={"balance-value " + (estimate.owed ? "money-out" : estimate.current >= 0 ? "money-in" : "money-out")}>
                  {formatMoney(estimate.current)}
                </div>
                <div className="meta">
                  From {formatMoney(estimate.startAmount)} {estimate.owed ? "owed " : ""}on {formatDateDisplay(estimate.startDate)}, plus{" "}
                  {estimate.count} transaction{estimate.count === 1 ? "" : "s"} since
                  {estimate.latestDate ? ` (newest uploaded: ${formatDateDisplay(estimate.latestDate)})` : ""}.
                  {estimate.earlierCount > 0 &&
                    ` The balance history also works back through ${estimate.earlierCount} earlier transaction${estimate.earlierCount === 1 ? "" : "s"}.`}
                </div>
              </div>
              {!balanceForm && (
                <button className="btn btn-ghost btn-sm" onClick={openBalance} aria-label={`Change the starting balance for ${account.name}`}>
                  Change starting balance
                </button>
              )}
            </>
          ) : (
            !balanceForm && (
              <button className="btn btn-ghost btn-sm" onClick={openBalance} aria-label={`Track the balance of ${account.name}`}>
                Track this account's balance
              </button>
            )
          )}
          {balanceForm && (
            <div className="balance-editor" role="group" aria-label={`Starting balance for ${account.name}`}>
              <p className="hint" style={{ margin: 0 }}>
                Enter the balance from a statement or your bank's website, and the day it was for. Coinrose adds and
                subtracts every transaction you've uploaded after that day. It's an estimate: Coinrose isn't connected to
                your bank.
              </p>
              <div className="balance-editor-fields">
                <div className="balance-field">
                  <label htmlFor={`balance-amount-${account.id}`}>{balanceForm.owed ? "Amount owed" : "Balance"}</label>
                  <span className="balance-input">
                    <span aria-hidden="true">$</span>
                    <input
                      id={`balance-amount-${account.id}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={balanceForm.amount}
                      onChange={(e) => setBalanceForm({ ...balanceForm, amount: e.target.value })}
                    />
                  </span>
                </div>
                <label>
                  At the end of
                  <input type="date" value={balanceForm.date} onChange={(e) => setBalanceForm({ ...balanceForm, date: e.target.value })} />
                </label>
                <label className="checkbox-filter">
                  <input type="checkbox" checked={balanceForm.owed} onChange={(e) => setBalanceForm({ ...balanceForm, owed: e.target.checked })} />
                  This is a credit card or loan (the amount is what's owed)
                </label>
              </div>
              <div className="actions-row">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!balanceAmountOk || !balanceDateOk}
                  onClick={() => {
                    onSetStartingBalance(account.id, { amount: Math.round(Number(balanceForm.amount) * 100) / 100, date: balanceForm.date, owed: balanceForm.owed });
                    setBalanceForm(null);
                  }}
                >
                  Save starting balance
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setBalanceForm(null)}>
                  Cancel
                </button>
                {account.startingBalance && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      onSetStartingBalance(account.id, null);
                      setBalanceForm(null);
                    }}
                  >
                    Stop tracking
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
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
                  <select aria-label="Date column"
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
                  <select aria-label="Description column"
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
                  <select aria-label="Money out column"
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
                  <select aria-label="Money in column"
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


export function AccountsView({ accounts, transactions, onDelete, onAddTransactions, onRename, onUpdateSettings, onGoUpload, onSetStartingBalance }) {
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
      {onSetStartingBalance && (() => {
        const totals = totalBalances(accounts, transactions);
        return (
          <div className="panel balance-summary">
            {totals.tracked > 0 && (
              <div className="summary-row" style={{ marginBottom: 8 }}>
                <StatBlock value={formatMoney(totals.have)} label="In accounts (estimated)" />
                {totals.owe !== 0 && <StatBlock value={formatMoney(totals.owe)} label="Owed on cards and loans" />}
                <StatBlock value={formatMoney(totals.net)} label="Difference" />
              </div>
            )}
            {totals.tracked > 0 && (
              <>
                <h2 className="balance-chart-title">Balance over time</h2>
                <BalanceChart accounts={accounts} transactions={transactions} />
              </>
            )}
            <p className="hint" style={{ margin: 0 }}>
              <strong>Balances are estimates.</strong> Coinrose isn't connected to your bank. Each balance is worked out from
              the starting amount you entered and the transactions you've uploaded, before and after it, so it can differ from
              your real balance: for example, because of pending transactions, fees, or statements you haven't uploaded yet.
              {totals.tracked === 0 && " Use \"Track this account's balance\" on an account to start."}
            </p>
          </div>
        );
      })()}
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
              estimate={estimateBalance(a, transactions)}
              onSetStartingBalance={onSetStartingBalance}
            />
          );
        })}
      </div>
    </div>
  );
}
