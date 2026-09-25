// src/AuthGate.jsx
// Wraps <App /> and only renders it once someone is signed in.
//
// Two ways in:
//   - A magic link emailed to you. This is also the ONLY way to create
//     an account, so every account has proven it owns its email before
//     a password can ever exist on it.
//   - Email + password, for anyone who has set one (Settings -> Password).
//
// Passwords never touch this app's own tables or storage. They go
// straight to Supabase Auth, which stores only a salted bcrypt hash.
//
// Import "./storageAdapter.js" separately (once, at app startup) before
// this renders App, so window.storage is ready when App loads data.

import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient.js";

const MIN_PASSWORD_LENGTH = 12;

// The password-reset email links back here with ?reset=1 added. That's
// a marker we control, so it works the same regardless of how Supabase
// formats the rest of the link. It only decides which form to SHOW:
// Supabase's servers are what actually decide whether a password change
// is allowed, so faking this in the address bar grants nothing.
function urlHasResetMarker() {
  try {
    return new URLSearchParams(window.location.search).get("reset") === "1";
  } catch (e) {
    return false;
  }
}

function clearResetMarker() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch (e) {
    /* ignore */
  }
}

// The sign-in screen renders before the theme is loaded, so every color
// has a fallback matching the default theme.
const muted = "var(--ink-muted, #62685E)";
const danger = "var(--danger, #A6392B)";
const success = "var(--income, #3F7D5C)";

const pageStyle = {
  display: "flex",
  minHeight: "100vh",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "sans-serif",
  background: "var(--bg, #F5F6F1)",
  color: "var(--ink, #1E241F)",
};
const cardStyle = { width: "min(340px, 92vw)", boxSizing: "border-box" };
const inputStyle = {
  width: "100%",
  padding: 10,
  marginTop: 10,
  boxSizing: "border-box",
  fontSize: 14,
  border: "1px solid var(--border, #DAD9CC)",
  borderRadius: 5,
  background: "var(--panel, #FFFFFF)",
  color: "var(--ink, #1E241F)",
};
const primaryButtonStyle = {
  width: "100%",
  padding: 10,
  marginTop: 12,
  fontSize: 14,
  border: "none",
  borderRadius: 5,
  background: "var(--accent, #C2661E)",
  color: "#fff",
  cursor: "pointer",
};
const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent, #C2661E)",
  cursor: "pointer",
  fontSize: 13,
  textDecoration: "underline",
};

function SetNewPasswordForm({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters. A few random words strung together works well.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Sign this account out everywhere else, in case whoever prompted
    // the reset still has a session somewhere.
    await supabase.auth.signOut({ scope: "others" });
    setBusy(false);
    onDone();
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h2 style={{ marginBottom: 4 }}>Choose a new password</h2>
        <p style={{ fontSize: 13, color: muted }}>At least {MIN_PASSWORD_LENGTH} characters.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            autoComplete="new-password"
            required
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            autoComplete="new-password"
            required
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={busy} style={primaryButtonStyle}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
        {error && <p style={{ color: danger, fontSize: 13 }}>{error}</p>}
      </div>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [recovering, setRecovering] = useState(urlHasResetMarker);
  const [mode, setMode] = useState("password"); // "password" | "link" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false); // magic link or reset email sent
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  function switchMode(next) {
    setMode(next);
    setError(null);
    setSent(false);
    setPassword("");
  }

  async function handleSendLink(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handlePasswordSignIn(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      // Same message whether the email has no account, has no password
      // yet, or the password is wrong. Anything more specific would tell
      // a stranger which emails have accounts here.
      setError(
        /invalid login credentials/i.test(error.message)
          ? "Email or password is incorrect. If you haven't set a password yet, sign in with an email link instead."
          : error.message
      );
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/?reset=1`,
    });
    setBusy(false);
    // Deliberately the same confirmation whether or not the email has an
    // account. Only rate-limit errors are shown.
    if (error && /rate limit|too many/i.test(error.message)) setError(error.message);
    else setSent(true);
  }

  if (session === undefined) {
    return <div style={{ ...pageStyle, color: muted }}>Loading…</div>;
  }

  if (session && recovering) {
    return (
      <SetNewPasswordForm
        onDone={() => {
          clearResetMarker();
          setRecovering(false);
        }}
      />
    );
  }

  if (!session) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h2 style={{ marginBottom: 4 }}>Sign in to Coinrose</h2>

          {mode === "password" && (
            <>
              <form onSubmit={handlePasswordSignIn}>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={inputStyle}
                />
                <button type="submit" disabled={busy} style={primaryButtonStyle}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </form>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                <button type="button" style={linkButtonStyle} onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
                <button type="button" style={linkButtonStyle} onClick={() => switchMode("link")}>
                  Email me a sign-in link
                </button>
              </div>
              <p style={{ fontSize: 12.5, color: muted, marginTop: 16 }}>
                New here? Choose "Email me a sign-in link" to create your account. You can add a password
                afterward in Settings.
              </p>
            </>
          )}

          {mode === "link" &&
            (sent ? (
              <p style={{ fontSize: 14, color: success }}>
                Check <strong>{email}</strong> for a sign-in link, then come back to this tab.
              </p>
            ) : (
              <form onSubmit={handleSendLink}>
                <p style={{ fontSize: 13, color: muted }}>
                  We'll email you a one-time link. This is also how new accounts are created.
                </p>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
                <button type="submit" disabled={busy} style={primaryButtonStyle}>
                  {busy ? "Sending…" : "Send sign-in link"}
                </button>
              </form>
            ))}

          {mode === "forgot" &&
            (sent ? (
              <p style={{ fontSize: 14, color: success }}>
                If an account with a password exists for <strong>{email}</strong>, a reset link is on its way.
              </p>
            ) : (
              <form onSubmit={handleForgot}>
                <p style={{ fontSize: 13, color: muted }}>
                  Enter your email and we'll send a link to choose a new password.
                </p>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
                <button type="submit" disabled={busy} style={primaryButtonStyle}>
                  {busy ? "Sending…" : "Send reset link"}
                </button>
              </form>
            ))}

          {mode !== "password" && (
            <button type="button" style={{ ...linkButtonStyle, marginTop: 14 }} onClick={() => switchMode("password")}>
              ← Back to password sign-in
            </button>
          )}

          {error && <p style={{ color: danger, fontSize: 13 }}>{error}</p>}
        </div>
      </div>
    );
  }

  return children;
}