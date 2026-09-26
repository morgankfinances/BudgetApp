// src/authGate.jsx
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

import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { supabase } from "./supabaseClient.js";
import { applySavedTheme, ThemedLogo, DecoRing, LoadingIndicator } from "./householdGate.jsx";

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

// Same fonts, colors, card, field, and button styles as the main app,
// scoped under .auth-root. Every color has a fallback matching the
// default theme, in case the theme hasn't been applied yet.
const AUTH_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600;700&display=swap');

.auth-root {
  position: relative;
  overflow: hidden;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  box-sizing: border-box;
  background: var(--bg, #F5F6F1);
  color: var(--ink, #1E241F);
  font-family: 'Work Sans', -apple-system, sans-serif;
}
.auth-root * { box-sizing: border-box; }
.auth-column { width: min(380px, 100%); position: relative; z-index: 1; }

/* Faint gold ring behind the card: decoration only. Sized by the
   window's height, slightly taller than the screen, so it circles the
   sign-in content instead of sitting behind it. To make it bigger or
   smaller, change the middle number (125vh = 125% of the window's
   height). */
.auth-deco-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: clamp(850px, 125vh, 1530px);
  height: auto;
  transform: translate(-50%, -50%);
  opacity: 0.12;
  pointer-events: none;
  z-index: 0;
}
:root[data-theme^="dark-"] .auth-deco-ring { opacity: 0.18; }
/* On phones the card already fills the width, so the ring runs wider
   than the screen and shows as arcs at the edges. */
@media (max-width: 600px) {
  .auth-deco-ring { width: 225vw; }
}
.auth-column.wide { width: min(520px, 100%); }

.auth-body { font-size: 14px; line-height: 1.6; color: var(--ink-muted, #62685E); }
.auth-body p { margin: 0 0 14px; }
.auth-list { padding-left: 18px; margin: 0 0 20px; }
.auth-list li { margin-bottom: 12px; }
.auth-list li:last-child { margin-bottom: 0; }
.auth-list strong { color: var(--ink, #1E241F); font-weight: 600; }
.auth-body a { color: var(--accent, #C2661E); font-weight: 600; }

.auth-brand {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.auth-logo {
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.auth-tagline {
  text-align: center;
  color: var(--ink-muted, #62685E);
  font-size: 14px;
  margin: 6px 0 22px;
}

.auth-card {
  background: var(--panel, #FFFFFF);
  border: 1px solid var(--border, #DAD9CC);
  border-radius: 10px;
  padding: 26px 24px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.06);
}
.auth-card h2 {
  color: var(--heading, #1E241F);
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 21px;
  letter-spacing: -0.01em;
  margin: 0 0 4px;
}
.auth-sub { color: var(--ink-muted, #62685E); font-size: 13.5px; margin: 0 0 18px; line-height: 1.45; }

.auth-tabs {
  display: flex;
  border: 1px solid var(--border, #DAD9CC);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 20px;
}
.auth-tab {
  flex: 1;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  border: none;
  background: var(--panel, #FFFFFF);
  color: var(--ink-muted, #62685E);
  cursor: pointer;
}
.auth-tab + .auth-tab { border-left: 1px solid var(--border, #DAD9CC); }
.auth-tab.active { background: var(--accent, #C2661E); color: #fff; }

.auth-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.auth-field-top { display: flex; justify-content: space-between; align-items: baseline; }
.auth-field label { font-size: 13px; font-weight: 600; color: var(--ink, #1E241F); }
.auth-field input {
  font-family: inherit;
  font-size: 14.5px;
  padding: 10px 12px;
  border: 1px solid var(--border, #DAD9CC);
  border-radius: 6px;
  background: var(--panel, #FFFFFF);
  color: var(--ink, #1E241F);
  width: 100%;
}
.auth-field input:focus { outline: 2px solid var(--accent, #C2661E); outline-offset: 1px; }
.auth-hint { font-size: 12px; color: var(--ink-muted, #62685E); }

.auth-primary {
  width: 100%;
  margin-top: 6px;
  padding: 11px 14px;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  background: var(--accent, #C2661E);
  color: #fff;
  cursor: pointer;
  transition: background 0.12s ease, opacity 0.12s ease;
}
.auth-primary:hover:not(:disabled) { background: var(--accent-hover, #9C4F15); }
.auth-primary:disabled { opacity: 0.55; cursor: not-allowed; }
/* The dark theme's accent is a light blue, where white text is hard to
   read. Dark text on it has strong contrast instead. */
:root[data-theme="dark-midnight"] .auth-primary,
:root[data-theme="dark-midnight"] .auth-tab.active { color: #10131B; }

.auth-link {
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent, #C2661E);
  cursor: pointer;
}
.auth-link:hover { text-decoration: underline; }
.auth-back { display: block; margin-top: 18px; }

.auth-message {
  font-size: 13.5px;
  line-height: 1.5;
  padding: 12px 14px;
  border-radius: 6px;
  margin: 0;
}
.auth-message.success {
  background: var(--accent-tint, #F7E9DC);
  color: var(--ink, #1E241F);
  border: 1px solid var(--border, #DAD9CC);
}
.auth-message.error {
  background: var(--danger-tint-bg, #FBEAE6);
  color: var(--danger, #A6392B);
  border: 1px solid var(--danger-tint-border, #E3A190);
  margin-top: 14px;
}

.auth-captcha { margin-top: 14px; display: flex; justify-content: center; }
.auth-captcha:empty { display: none; }

.auth-footnote {
  text-align: center;
  font-size: 12.5px;
  color: var(--ink-muted, #62685E);
  margin: 18px 4px 0;
  line-height: 1.5;
}
`;

// The page layout shared by the sign-in screens and disclosureGate.jsx:
// logo, wordmark, optional tagline, then whatever card goes below.
export function AuthShell({ children, tagline = "Your household's money, organized together.", wide = false }) {
  return (
    <div className="auth-root">
      <style>{AUTH_STYLES}</style>
      <DecoRing className="auth-deco-ring" />
      <div className={"auth-column" + (wide ? " wide" : "")}>
        <div className="auth-brand">
          <ThemedLogo className="auth-logo" />
          Coinrose
        </div>
        {tagline ? <p className="auth-tagline">{tagline}</p> : <div style={{ height: 22 }} />}
        {children}
      </div>
    </div>
  );
}

function ErrorMessage({ text }) {
  return text ? (
    <p className="auth-message error" role="alert">
      {text}
    </p>
  ) : null;
}

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
    <AuthShell>
      <div className="auth-card">
        <h2>Choose a new password</h2>
        <p className="auth-sub">Use at least {MIN_PASSWORD_LENGTH} characters. A few random words strung together works well.</p>
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="auth-new-password">New password</label>
            <input
              id="auth-new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="auth-confirm-password">Confirm new password</label>
            <input
              id="auth-confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button type="submit" className="auth-primary" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
        <ErrorMessage text={error} />
      </div>
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ */
/* Bot protection (Cloudflare Turnstile)                               */
/*                                                                      */
/* With CAPTCHA protection on in Supabase, every sign-in, sign-in-link, */
/* and password-reset request must carry a Turnstile token. The widget  */
/* only shows itself when Cloudflare wants a person to prove they're    */
/* human; most people never see it. Tokens work once, so the widget     */
/* resets after every attempt. Without a site key set (for example,     */
/* running locally), it's skipped entirely.                             */
/* ------------------------------------------------------------------ */
const TURNSTILE_SITE_KEY = import.meta.env?.VITE_TURNSTILE_SITE_KEY || "";

let turnstileScript = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileScript) {
    turnstileScript = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        turnstileScript = null;
        reject(new Error("Couldn't load the security check"));
      };
      document.head.appendChild(el);
    });
  }
  return turnstileScript;
}

function TurnstileWidget({ onToken, resetKey }) {
  const box = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current) return;
        widgetId.current = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: "interaction-only",
          theme: (document.documentElement.getAttribute("data-theme") || "").startsWith("dark") ? "dark" : "light",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  // After each attempt, get a fresh token (each one works only once).
  useEffect(() => {
    if (resetKey > 0 && widgetId.current !== null && window.turnstile) {
      onToken(null);
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey]);

  return TURNSTILE_SITE_KEY ? <div ref={box} className="auth-captcha" /> : null;
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
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  // Returns the extra options a sign-in request needs, or null (with an
  // error shown) if the security check hasn't finished yet.
  function captchaOptionsOrWait() {
    if (!TURNSTILE_SITE_KEY) return {};
    if (!captchaToken) {
      setError("One moment: a quick security check is still finishing. Please try again.");
      return null;
    }
    return { captchaToken };
  }
  function freshCaptcha() {
    setCaptchaResetKey((k) => k + 1);
  }

  // Apply the saved theme before the first frame is drawn, so only the
  // matching version of each themed image ever appears.
  useLayoutEffect(() => {
    applySavedTheme();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Tab title for the screens this file shows. Once someone is signed in
  // (and not mid-password-reset), the app sets its own titles, so this
  // leaves the title alone.
  useEffect(() => {
    if (session && !recovering) return;
    let page = null; // still checking the session
    if (session && recovering) page = "Choose a New Password";
    else if (session === null) page = mode === "forgot" ? "Reset Password" : "Sign In";
    document.title = page ? `${page} | Coinrose` : "Coinrose";
  }, [session, recovering, mode]);

  function switchMode(next) {
    setMode(next);
    setError(null);
    setSent(false);
    setPassword("");
  }

  async function handleSendLink(e) {
    e.preventDefault();
    setError(null);
    const captcha = captchaOptionsOrWait();
    if (!captcha) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin, ...captcha },
    });
    setBusy(false);
    freshCaptcha();
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handlePasswordSignIn(e) {
    e.preventDefault();
    setError(null);
    const captcha = captchaOptionsOrWait();
    if (!captcha) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password, options: captcha });
    setBusy(false);
    freshCaptcha();
    if (error) {
      // Same message whether the email has no account, has no password
      // yet, or the password is wrong. Anything more specific would tell
      // a stranger which emails have accounts here.
      setError(
        /invalid login credentials/i.test(error.message)
          ? "Email or password is incorrect. If you haven't set a password yet, use an email link instead."
          : error.message
      );
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError(null);
    const captcha = captchaOptionsOrWait();
    if (!captcha) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/?reset=1`,
      ...captcha,
    });
    setBusy(false);
    freshCaptcha();
    // Deliberately the same confirmation whether or not the email has an
    // account. Only rate-limit and security-check errors are shown (a
    // failed check means nothing was sent, so saying "sent" would mislead).
    if (error && /rate limit|too many|captcha/i.test(error.message)) setError(error.message);
    else setSent(true);
  }

  if (session === undefined) {
    return (
      <div className="auth-root">
        <style>{AUTH_STYLES}</style>
        <LoadingIndicator />
      </div>
    );
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

  if (session) return children;

  const emailField = (
    <div className="auth-field">
      <label htmlFor="auth-email">Email</label>
      <input
        id="auth-email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </div>
  );

  return (
    <AuthShell>
      <div className="auth-card">
        {mode === "forgot" ? (
          <>
            <h2>Reset your password</h2>
            {sent ? (
              <p className="auth-message success">
                If an account with a password exists for <strong>{email}</strong>, a reset link is on its way.
              </p>
            ) : (
              <>
                <p className="auth-sub">Enter your email and we'll send you a link to choose a new password.</p>
                <form onSubmit={handleForgot}>
                  {emailField}
                  <button type="submit" className="auth-primary" disabled={busy}>
                    {busy ? "Sending…" : "Send reset link"}
                  </button>
                </form>
              </>
            )}
            <ErrorMessage text={error} />
            <button type="button" className="auth-link auth-back" onClick={() => switchMode("password")}>
              ← Back to sign in
            </button>
          </>
        ) : (
          <>
            <h2>Welcome back</h2>
            <p className="auth-sub">Sign in with your password, or have a one-time link emailed to you.</p>

            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "password"}
                className={"auth-tab" + (mode === "password" ? " active" : "")}
                onClick={() => switchMode("password")}
              >
                Password
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "link"}
                className={"auth-tab" + (mode === "link" ? " active" : "")}
                onClick={() => switchMode("link")}
              >
                Email link
              </button>
            </div>

            {mode === "password" && (
              <form onSubmit={handlePasswordSignIn}>
                {emailField}
                <div className="auth-field">
                  <div className="auth-field-top">
                    <label htmlFor="auth-password">Password</label>
                    <button type="button" className="auth-link" onClick={() => switchMode("forgot")}>
                      Forgot password?
                    </button>
                  </div>
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button type="submit" className="auth-primary" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </form>
            )}

            {mode === "link" &&
              (sent ? (
                <p className="auth-message success">
                  Check <strong>{email}</strong> for a sign-in link, then come back to this tab.
                </p>
              ) : (
                <form onSubmit={handleSendLink}>
                  {emailField}
                  <span className="auth-hint" style={{ display: "block", margin: "-6px 0 12px" }}>
                    No password needed. This is also how new accounts are created.
                  </span>
                  <button type="submit" className="auth-primary" disabled={busy}>
                    {busy ? "Sending…" : "Email me a sign-in link"}
                  </button>
                </form>
              ))}

            <ErrorMessage text={error} />
          </>
        )}
        <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaResetKey} />
      </div>
      <p className="auth-footnote">
        New here? Use <strong>Email link</strong> to create your account. You can add a password afterward in
        Settings.
      </p>
    </AuthShell>
  );
}
