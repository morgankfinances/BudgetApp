// src/DisclosureGate.jsx
// Sits between AuthGate and HouseholdGate. Shows a one-time notice about
// what this app is (and isn't) before someone creates or joins a
// household — private-by-design between users, but not a regulated
// institution, no formal backups, and the operator has database-level
// access even though the app itself never exposes one user's data to
// another. Acknowledgment is remembered per-browser via localStorage, not
// tied to the account, so it's a lightweight one-time notice rather than
// a tracked legal acceptance.

import React, { useState, useEffect } from "react";

const ACK_KEY = "ledger-disclosure-ack-v1";

const CONTACT_EMAIL = "morgankfinances@gmail.com";

const boxStyle = {
  display: "flex",
  minHeight: "100vh",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "sans-serif",
  padding: 20,
  boxSizing: "border-box",
};

const cardStyle = {
  width: "min(480px, 92vw)",
  background: "#fff",
  borderRadius: 8,
  padding: 28,
  boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
  boxSizing: "border-box",
};

export default function DisclosureGate({ children }) {
  const [acknowledged, setAcknowledged] = useState(null); // null = checking

  useEffect(() => {
    let ack = false;
    try {
      ack = localStorage.getItem(ACK_KEY) === "true";
    } catch (e) {
      // If storage isn't available for some reason, don't block the app over it.
      ack = true;
    }
    setAcknowledged(ack);
  }, []);

  function handleAccept() {
    try {
      localStorage.setItem(ACK_KEY, "true");
    } catch (e) {
      /* ignore */
    }
    setAcknowledged(true);
  }

  if (acknowledged === null) {
    return <div style={{ ...boxStyle, color: "#666" }}>Loading…</div>;
  }

  if (acknowledged) {
    return children;
  }

  return (
    <div style={boxStyle}>
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 19 }}>Before you get started</h2>
        <div style={{ fontSize: 13.5, color: "#444", lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            This is a personal project, not a commercial product or a financial institution — worth keeping in
            mind as you decide how much to rely on it.
          </p>
          <ul style={{ paddingLeft: 18, margin: "0 0 14px" }}>
            <li style={{ marginBottom: 10 }}>
              <strong>Your data is private from other users.</strong> No one else using this app can see your
              accounts, transactions, or categories. Each household's data is isolated at the database level,
              not just hidden by the interface.
            </li>
            <li style={{ marginBottom: 10 }}>
              <strong>The person (Me, Morgan Keller) who runs this app can still access the underlying database.</strong> That
              isolation is enforced for anyone going through the app itself, but as the operator, there is
              administrative access to the database everything is stored in. The same way any hosted app's
              operator technically can reach the data behind it. Your data isn't reviewed or looked at, I have no interest in it, but that
              access does exist, and you should know that going in.
            </li>
            <li style={{ marginBottom: 10 }}>
              <strong>No uptime or data-loss guarantees.</strong> This runs on free-tier infrastructure with no
              formal backups. Please don't treat it as your only copy of anything important. Exporting your data
              periodically from the Backup tab is a good habit, and the app allows mass reupload via the backkup page as well.
            </li>
            <li style={{ marginBottom: 0 }}>
              <strong>Want your account and data fully deleted?</strong> Inside of "Settings" on the bottom right, 
              the "Delete Account" button will permanently delete your acccount and remove all data from the database.
              Please be aware that because it deletes all data from the database, this is irreversible. You may want to create
              a backup of all your data first.
            </li>
          </ul>
        </div>
        <button
          onClick={handleAccept}
          style={{ width: "100%", padding: 11, fontSize: 14, marginTop: 4, cursor: "pointer" }}
        >
          I understand, continue
        </button>
      </div>
    </div>
  );
}