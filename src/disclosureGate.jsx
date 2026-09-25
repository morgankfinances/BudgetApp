// src/disclosureGate.jsx
// Sits between authGate.jsx and householdGate.jsx. Shows a one-time notice
// about what this app is (and isn't) before someone creates or joins a
// household: private between users, but not a regulated institution, no
// formal backups, and the operator has database-level access even though
// the app itself never exposes one user's data to another. The
// acknowledgment is remembered per-browser via localStorage, not tied to
// the account, so it's a lightweight one-time notice rather than a
// tracked legal acceptance.
//
// Uses the same page layout as the sign-in screen (logo, wordmark, card),
// shared from authGate.jsx so the two screens always match.

import React, { useState, useEffect, useRef } from "react";
import { AuthShell } from "./authGate.jsx";

const ACK_KEY = "ledger-disclosure-ack-v1";

const CONTACT_EMAIL = "morgankfinances@gmail.com";

function readAcknowledged() {
  try {
    return localStorage.getItem(ACK_KEY) === "true";
  } catch (e) {
    // If storage isn't available for some reason, don't block the app over it.
    return true;
  }
}

// The Settings panel (householdGate.jsx) opens the notice again by sending
// this signal. A signal instead of an import keeps the two files from
// importing each other in a loop.
const SHOW_EVENT = "coinrose:show-disclosure";

// Styles for the "view it again" overlay: covers the whole app (above the
// Settings button and panel) and scrolls on its own.
const OVERLAY_STYLES = `
.disclosure-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  overflow-y: auto;
  background: var(--bg, #F5F6F1);
}
`;

export default function DisclosureGate({ children }) {
  const [acknowledged, setAcknowledged] = useState(readAcknowledged);
  const [reviewing, setReviewing] = useState(false);
  const previousTitle = useRef(null);

  useEffect(() => {
    if (!acknowledged) document.title = "Before You Get Started | Coinrose";
  }, [acknowledged]);

  // Open the notice when Settings asks for it.
  useEffect(() => {
    function open() {
      previousTitle.current = document.title;
      setReviewing(true);
    }
    window.addEventListener(SHOW_EVENT, open);
    return () => window.removeEventListener(SHOW_EVENT, open);
  }, []);

  // While it's open: its own tab title, and Escape closes it.
  useEffect(() => {
    if (!reviewing) return;
    document.title = "About This App | Coinrose";
    function onKey(e) {
      if (e.key === "Escape") closeReview();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewing]);

  function closeReview() {
    setReviewing(false);
    // Put back the title of the page underneath.
    if (previousTitle.current) document.title = previousTitle.current;
  }

  function handleAccept() {
    try {
      localStorage.setItem(ACK_KEY, "true");
    } catch (e) {
      /* ignore */
    }
    setAcknowledged(true);
  }

  if (!acknowledged) {
    return <DisclosureNotice heading="Before you get started" buttonLabel="I understand, continue" onButton={handleAccept} />;
  }

  return (
    <>
      {children}
      {reviewing && (
        <div className="disclosure-overlay" role="dialog" aria-modal="true" aria-label="About this app">
          <style>{OVERLAY_STYLES}</style>
          <DisclosureNotice heading="About this app" buttonLabel="Close" onButton={closeReview} />
        </div>
      )}
    </>
  );
}

// The notice itself, shared by the first-time screen and the "view it
// again" overlay opened from Settings.
function DisclosureNotice({ heading, buttonLabel, onButton }) {
  return (
    <AuthShell tagline={null} wide>
      <div className="auth-card">
        <h2>{heading}</h2>
        <div className="auth-body" style={{ marginTop: 12 }}>
          <p>
            This is a personal project, not a commercial product or a financial institution — worth keeping in
            mind as you decide how much to rely on it.
          </p>
          <ul className="auth-list">
            <li>
              <strong>Your data is private from other users.</strong> No one else using this app can see your
              accounts, transactions, or categories. Each household's data is isolated at the database level,
              not just hidden by the interface.
            </li>
            <li>
              <strong>The person (Me, Morgan Keller) who runs this app can still access the underlying database.</strong>{" "}
              That isolation is enforced for anyone going through the app itself, but as the operator, there is
              administrative access to the database everything is stored in. The same way any hosted app's
              operator technically can reach the data behind it. Your data isn't reviewed or looked at, I have no
              interest in it, but that access does exist, and you should know that going in.
            </li>
            <li>
              <strong>No uptime or data-loss guarantees.</strong> This runs on free-tier infrastructure with no
              formal backups. Please don't treat it as your only copy of anything important. Exporting your data
              periodically from the Backup tab is a good habit, and the app allows mass reupload via the backup
              page as well.
            </li>
            <li>
              <strong>Want your data deleted?</strong> In "Settings" on the bottom right, "Delete my account"
              permanently deletes your login. If you're the only member of your household, it also deletes the
              household and all of its data; if others share it, their data stays with them. This is
              irreversible, so you may want to create a backup of all your data first. Questions? Email me at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </li>
          </ul>
        </div>
        <button type="button" className="auth-primary" onClick={onButton}>
          {buttonLabel}
        </button>
      </div>
    </AuthShell>
  );
}
