// src/AuthGate.jsx
// Wraps <App /> and only renders it once someone is signed in. Uses
// passwordless "magic link" sign-in — no password fields or reset flows to
// build. Import "./storageAdapter.js" separately (once, at app startup)
// before this renders App, so window.storage is ready by the time App
// tries to load data.

import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient.js";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSendLink(e) {
    e.preventDefault();
    setError(null);
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (session === undefined) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#666" }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
        <div style={{ width: "min(320px, 92vw)", boxSizing: "border-box" }}>
          <h2 style={{ marginBottom: 4 }}>Sign in to Ledger</h2>
          {sent ? (
            <p style={{ color: "#444", fontSize: 14 }}>
              Check <strong>{email}</strong> for a sign-in link, then come back to this tab.
            </p>
          ) : (
            <form onSubmit={handleSendLink}>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 10, marginBottom: 10, boxSizing: "border-box", fontSize: 14 }}
              />
              <button type="submit" disabled={sending} style={{ width: "100%", padding: 10, fontSize: 14 }}>
                {sending ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}
          {error && <p style={{ color: "#b3261e", fontSize: 13 }}>{error}</p>}
        </div>
      </div>
    );
  }

  return children;
}