// src/householdGate.jsx
// Sits between AuthGate and App. Handles the full household lifecycle:
//   - "none": no household and no pending request -> create or request to join
//   - "pending": a join request is out, waiting on an existing member
//   - "denied": the last request was turned down
//   - "ready": an actual member -> renders the app, plus a floating
//     "Settings" button (badged with pending-request count) that opens a
//     panel to view members, remove someone, view/regenerate the invite
//     code, approve/deny anyone waiting to join, and pick an appearance
//     theme.
//
// Also owns the app's theme (light/dark + variants). The picker lives in
// the Settings panel below, but the CSS variables and the data-theme
// attribute are applied globally via document.documentElement, not
// scoped to App's own DOM: this file's UI (the floating button, the
// panel, and the pre-household screens) renders as a DOM *sibling* of
// App's .ledger-root, not a descendant, so anything scoped to
// .ledger-root wouldn't be visible here — and the pre-household screens
// render before App ever mounts at all, so nothing App injects can be
// relied on yet either. Applying theme globally sidesteps both problems.

import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient.js";
import { resetHouseholdCache } from "./storageAdapter.js";

/* ------------------------------------------------------------------ */
/* Theme                                                                */
/*                                                                      */
/* A personal, per-device display preference, so it lives in           */
/* localStorage rather than synced household data. IMPORTANT: the      */
/* variable values below must be kept in sync by hand with the matching */
/* :root[data-theme] blocks in ledger-app.jsx's STYLES constant — they  */
/* have to be duplicated here since this file's own UI needs them       */
/* before App has necessarily mounted.                                  */
/* ------------------------------------------------------------------ */

const THEME_KEY = "ledger-theme-v1";

const THEMES = [
  { id: "light-sage", label: "Default - Natural" },
  { id: "light-slate", label: "Light — Slate" },
  { id: "dark-midnight", label: "Dark — Midnight" },
];

function loadTheme() {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw && THEMES.some((t) => t.id === raw)) return raw;
  } catch (e) {
    /* ignore */
  }
  return "light-sage";
}

function saveTheme(themeId) {
  try {
    window.localStorage.setItem(THEME_KEY, themeId);
  } catch (e) {
    /* private browsing or storage disabled — the preference just won't persist */
  }
}

const THEME_VARS_CSS = `
:root {
  --heading: #1E241F;
  --bg: #F5F6F1;
  --panel: #FFFFFF;
  --ink: #1E241F;
  --ink-muted: #62685E;
  --border: #DAD9CC;
  --accent: #C2661E;
  --accent-hover: #9C4F15;
  --accent-tint: #F7E9DC;
  --income: #3F7D5C;
  --expense: #AC4A2C;
  --warn-bg: #FBF1DA;
  --warn-border: #E3B558;
  --warn-ink: #8A5A15;
  --danger: #A6392B;
  --danger-tint-bg: #FBEAE6;
  --danger-tint-border: #E3A190;
  --subtle-bg: #F2F1E9;
  --radius: 6px;
}
:root[data-theme="light-slate"] {
  --heading: #1C2430; --bg: #F3F5F8; --panel: #FFFFFF; --ink: #1C2430; --ink-muted: #5B6675;
  --border: #D6DCE3; --accent: #2B6CB0; --accent-hover: #1E5490; --accent-tint: #E7EFF8;
  --income: #2F8F6F; --expense: #C1502F; --warn-bg: #FCF3D9; --warn-border: #DDAE3E;
  --warn-ink: #7A5A0D; --danger: #B0402E; --danger-tint-bg: #FBEAE6; --danger-tint-border: #E0AA98;
  --subtle-bg: #EDF0F4;
}
:root[data-theme="dark-midnight"] {
  --heading: #C8CDD8; --bg: #10131B; --panel: #1B2030; --ink: #E7E9F1; --ink-muted: #9BA3B5;
  --border: #2C3346; --accent: #7B9EE0; --accent-hover: #9AB6EA; --accent-tint: #232A42;
  --income: #6FCB9A; --expense: #E2896A; --warn-bg: #3B301A; --warn-border: #C99A3E;
  --warn-ink: #EAC581; --danger: #E2685A; --danger-tint-bg: #3A2420; --danger-tint-border: #7A4038;
  --subtle-bg: #242A3D;
}
/* Every heading gets an explicit theme color, so no outside stylesheet
   can turn them dark on the dark theme. */
h1, h2, h3 { color: var(--heading); }
.theme-picker-grid { display: flex; flex-direction: column; gap: 3px; }
.theme-swatch-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 6px; border: 1px solid transparent;
  background: none; font-family: sans-serif; font-size: 13px; color: var(--ink);
  cursor: pointer; text-align: left; width: 100%;
}
.theme-swatch-btn:hover { background: var(--subtle-bg); }
.theme-swatch-btn.active { border-color: var(--accent); background: var(--accent-tint); color: var(--accent); font-weight: 600; }
.theme-swatch { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--border); flex-shrink: 0; }
.theme-swatch-light-sage { background: linear-gradient(135deg, #F5F6F1 50%, #C2661E 50%); }
.theme-swatch-light-slate { background: linear-gradient(135deg, #F3F5F8 50%, #2B6CB0 50%); }
.theme-swatch-dark-midnight { background: linear-gradient(135deg, #10131B 50%, #7B9EE0 50%); }

/* Themed art: every spot holds both the black and the gold image, and
   only the one matching the current theme shows. Any theme whose id
   starts with "dark-" gets the gold version, so a future dark theme is
   covered too. */
.logo-dark { display: none; }
:root[data-theme^="dark-"] .logo-light { display: none; }
:root[data-theme^="dark-"] .logo-dark { display: inline-block; }

/* Loading indicator: the compass rose, turning slowly. It stays still for
   anyone whose device is set to reduce motion. */
.coinrose-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.coinrose-loading-star { width: 44px; height: 44px; animation: coinrose-spin 8s linear infinite; }
.coinrose-loading-label { font-family: 'Work Sans', -apple-system, sans-serif; font-size: 14px; color: var(--ink-muted); }
@keyframes coinrose-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .coinrose-loading-star { animation: none; } }

/* Background ring: the same faint gold ring as the sign-in screen, fixed
   in place while the page scrolls. z-index -1 puts it behind every
   panel, table, and chart; the screen that holds it sets
   "isolation: isolate" so the ring still draws above that screen's own
   background color. */
.coinrose-bg-ring {
  position: fixed;
  top: 50%;
  left: 50%;
  width: clamp(850px, 125vh, 1530px);
  height: auto;
  transform: translate(-50%, -50%);
  opacity: 0.12;
  pointer-events: none;
  z-index: -1;
}
:root[data-theme^="dark-"] .coinrose-bg-ring { opacity: 0.18; }
@media (max-width: 600px) {
  .coinrose-bg-ring { width: 225vw; }
}
`;

// Brand images, all in public/. File names are case-sensitive on Vercel,
// so these must match the files exactly.
export const LOGO_LIGHT_SRC = "/Black_Coin.svg";
export const LOGO_DARK_SRC = "/Gold_Coin.svg";
export const STAR_LIGHT_SRC = "/Black_Star.svg";
export const STAR_DARK_SRC = "/Gold_Star.svg";
export const DECO_RING_SRC = "/Gold_Deco_Ring.svg"; // gold only: used faintly, so it suits every theme

// If an image file is ever missing, hide it instead of showing a broken-
// image icon. (An inline style wins over the theme rules above.)
function hideMissingImage(e) {
  e.currentTarget.style.display = "none";
}

// An image that switches with the theme: the black version on the light
// themes, the gold version on the dark theme.
function ThemedImage({ lightSrc, darkSrc, className = "" }) {
  return (
    <>
      <img className={`${className} logo-light`} src={lightSrc} alt="" onError={hideMissingImage} />
      <img className={`${className} logo-dark`} src={darkSrc} alt="" onError={hideMissingImage} />
    </>
  );
}

// The coin logo. Used by the sidebar, the mobile top bar, and the sign-in
// and disclosure screens.
export function ThemedLogo({ className = "" }) {
  return <ThemedImage lightSrc={LOGO_LIGHT_SRC} darkSrc={LOGO_DARK_SRC} className={className} />;
}

// The compass-rose star. Used in loading screens, empty states, and
// Overview's "nothing flagged" message.
export function ThemedStar({ className = "" }) {
  return <ThemedImage lightSrc={STAR_LIGHT_SRC} darkSrc={STAR_DARK_SRC} className={className} />;
}

// The decorative ring behind the sign-in and disclosure cards.
export function DecoRing({ className = "" }) {
  return <img className={className} src={DECO_RING_SRC} alt="" aria-hidden="true" onError={hideMissingImage} />;
}

// Every loading screen in the app uses this: the turning compass rose.
export function LoadingIndicator({ label = "Loading…" }) {
  return (
    <div className="coinrose-loading" role="status">
      <ThemedStar className="coinrose-loading-star" />
      <div className="coinrose-loading-label">{label}</div>
    </div>
  );
}

// Applies this device's saved theme right away. The sign-in screen
// (authGate.jsx) renders before this file's component mounts, so it calls this
// itself; otherwise someone using the dark theme would see a bright
// sign-in screen first. Safe to call repeatedly.
export function applySavedTheme() {
  try {
    let styleEl = document.getElementById("ledger-theme-vars");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "ledger-theme-vars";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = THEME_VARS_CSS;
    document.documentElement.setAttribute("data-theme", loadTheme());
  } catch (e) {
    /* ignore: the sign-in screen falls back to default colors */
  }
}

function ThemePicker({ theme, onChange }) {
  return (
    <div className="theme-picker-grid">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={"theme-swatch-btn" + (theme === t.id ? " active" : "")}
          onClick={() => onChange(t.id)}
        >
          <span className={"theme-swatch theme-swatch-" + t.id} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

const boxStyle = {
  isolation: "isolate",
  display: "flex",
  minHeight: "100vh",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "sans-serif",
  background: "var(--bg)",
  color: "var(--ink)",
};

const inputStyle = {
  width: "100%",
  padding: 10,
  marginBottom: 8,
  boxSizing: "border-box",
  fontSize: 14,
  background: "var(--panel)",
  color: "var(--ink)",
  border: "1px solid var(--border)",
  borderRadius: 5,
};

const buttonStyle = {
  width: "100%",
  padding: 10,
  fontSize: 14,
  background: "var(--panel)",
  color: "var(--ink)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  cursor: "pointer",
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  fontFamily: "sans-serif",
};

const cardStyle = {
  width: "min(380px, 92vw)",
  maxHeight: "85vh",
  overflowY: "auto",
  background: "var(--panel)",
  color: "var(--ink)",
  borderRadius: 8,
  padding: 24,
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  boxSizing: "border-box",
};

const sectionLabelStyle = {
  fontSize: 11.5,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--ink-muted)",
  margin: "18px 0 8px",
  fontWeight: 600,
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 0",
  borderBottom: "1px solid var(--border)",
  fontSize: 13.5,
  gap: 8,
};

const smallBtnStyle = {
  padding: "5px 10px",
  fontSize: 12,
  cursor: "pointer",
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--panel)",
  color: "var(--ink)",
};

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return { text: "Expired", expired: true };
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return { text: `Expires in ${days} day${days === 1 ? "" : "s"}`, expired: false };
}

// Has to match the STORAGE_KEY constant in App.jsx — that's the one blob
// this whole app reads and writes, and the one history tracks.
const LEDGER_STORAGE_KEY = "ledger-data-v1";

function formatRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Set or change the signed-in user's password. The password goes
// straight to Supabase Auth (stored only as a salted bcrypt hash) and
// never touches this app's own tables.
//
// If "Secure password change" is turned on in Supabase and the last
// sign-in wasn't recent, Supabase refuses the change until the user
// proves it's really them. In that case this asks Supabase to email a
// short code, then retries with that code. Supabase enforces this on its
// servers, so this UI can't be used to skip it.
const MIN_PASSWORD_LENGTH = 12;

function PasswordSection() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nonce, setNonce] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(false);

  function reset() {
    setOpen(false);
    setPassword("");
    setConfirm("");
    setNonce("");
    setNeedsCode(false);
    setError(null);
    setNotice(null);
  }

  async function handleSave() {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters. A few random words strung together works well.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    if (needsCode && !nonce.trim()) {
      setError("Enter the code from your email.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser(
      needsCode ? { password, nonce: nonce.trim() } : { password }
    );

    if (error) {
      const needsReauth = error.code === "reauthentication_needed" || /reauthenticat/i.test(error.message || "");
      if (needsReauth && !needsCode) {
        const { error: reauthError } = await supabase.auth.reauthenticate();
        setBusy(false);
        if (reauthError) {
          setError(reauthError.message);
          return;
        }
        setNeedsCode(true);
        setNotice("To confirm it's you, we emailed you a verification code. Enter it below, then save again.");
        return;
      }
      setBusy(false);
      setError(error.message);
      return;
    }

    // Sign this account out on every other device.
    await supabase.auth.signOut({ scope: "others" });
    setBusy(false);
    reset();
    setDone(true);
  }

  const fieldStyle = { ...inputStyle, marginBottom: 8 };

  return (
    <>
      <div style={sectionLabelStyle}>Password</div>
      {!open ? (
        <>
          {done && (
            <p style={{ fontSize: 12.5, color: "var(--income)", marginBottom: 8 }}>
              Password saved. You're still signed in here; any other devices were signed out.
            </p>
          )}
          <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>
            Optional. Lets you sign in with your email and a password instead of waiting for an email link.
            Email links keep working either way.
          </p>
          <button
            style={{ ...buttonStyle, marginBottom: 8 }}
            onClick={() => {
              setDone(false);
              setOpen(true);
            }}
          >
            Set or change password
          </button>
        </>
      ) : (
        <div style={{ marginBottom: 8 }}>
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={fieldStyle}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={fieldStyle}
          />
          {needsCode && (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code from your email"
              value={nonce}
              onChange={(e) => setNonce(e.target.value)}
              style={fieldStyle}
            />
          )}
          {notice && <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>{notice}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={buttonStyle} onClick={handleSave} disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
            <button style={buttonStyle} onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>
      )}
    </>
  );
}

function HistorySection() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState(null);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("list_storage_history", {
      p_key: LEDGER_STORAGE_KEY,
      p_shared: false,
    });
    if (error) setError(error.message);
    setEntries(data || []);
    setLoading(false);
  }

  function handleOpen() {
    setOpen(true);
    loadHistory();
  }

  async function handleRestore(id) {
    setRestoring(true);
    setError(null);
    const { error } = await supabase.rpc("restore_storage_history", { p_history_id: id });
    if (error) {
      setRestoring(false);
      setError(error.message);
      return;
    }
    // The live data changed out from under the already-loaded app, so
    // reload to pick up the restored version cleanly.
    window.location.reload();
  }

  return (
    <>
      <div style={sectionLabelStyle}>Data history</div>
      {!open ? (
        <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={handleOpen}>
          View history
        </button>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>
            Every past version of your data, kept for 1 hour. Restoring replaces everything currently in the
            app with that older version — it's not a way to bring back just one item.
          </p>
          {loading ? (
            <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Loading…</p>
          ) : entries.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>No earlier versions yet.</p>
          ) : (
            entries.map((entry) => (
              <div style={rowStyle} key={entry.id}>
                <span>{formatRelativeTime(entry.archived_at)}</span>
                {confirmingId === entry.id ? (
                  <span style={{ display: "flex", gap: 6 }}>
                    <button
                      style={{ ...smallBtnStyle, borderColor: "var(--danger)", color: "var(--danger)" }}
                      onClick={() => handleRestore(entry.id)}
                      disabled={restoring}
                    >
                      {restoring ? "Restoring…" : "Confirm"}
                    </button>
                    <button style={smallBtnStyle} onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button style={smallBtnStyle} onClick={() => setConfirmingId(entry.id)}>
                    Restore
                  </button>
                )}
              </div>
            ))
          )}
          {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        </>
      )}
    </>
  );
}

function MemberRow({ member, currentUserId, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  const isSelf = member.user_id === currentUserId;

  return (
    <div style={rowStyle}>
      <span>
        {member.email}
        {isSelf ? " (you)" : ""}
      </span>
      {!isSelf &&
        (confirming ? (
          <span style={{ display: "flex", gap: 6 }}>
            <button
              style={{ ...smallBtnStyle, borderColor: "var(--danger)", color: "var(--danger)" }}
              onClick={() => onRemove(member.user_id)}
            >
              Confirm
            </button>
            <button style={smallBtnStyle} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button style={smallBtnStyle} onClick={() => setConfirming(true)}>
            Remove
          </button>
        ))}
    </div>
  );
}

function RequestRow({ request, onApprove, onDeny }) {
  return (
    <div style={rowStyle}>
      <span>{request.requester_email || "Unknown"}</span>
      <span style={{ display: "flex", gap: 6 }}>
        <button
          style={{ ...smallBtnStyle, borderColor: "var(--income)", color: "var(--income)" }}
          onClick={() => onApprove(request.id)}
        >
          Approve
        </button>
        <button
          style={{ ...smallBtnStyle, borderColor: "var(--danger)", color: "var(--danger)" }}
          onClick={() => onDeny(request.id)}
        >
          Deny
        </button>
      </span>
    </div>
  );
}

function HouseholdPanel({ onClose, onDataChanged, theme, onThemeChange }) {
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  const [leaveError, setLeaveError] = useState(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchCode, setSwitchCode] = useState("");
  const [switchConfirming, setSwitchConfirming] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchSent, setSwitchSent] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user.id);

    const { data: membership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id, households(id, name, invite_code, invite_code_expires_at)")
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      setError("Couldn't load household info.");
      setLoading(false);
      return;
    }

    setHousehold(membership.households);

    const [{ data: memberData }, { data: requestData }] = await Promise.all([
      supabase.rpc("get_household_members", { p_household_id: membership.household_id }),
      supabase
        .from("household_join_requests")
        .select("id, requester_email, created_at")
        .eq("household_id", membership.household_id)
        .eq("status", "pending")
        .order("created_at"),
    ]);

    setMembers(memberData || []);
    setRequests(requestData || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRegenerate() {
    if (!household) return;
    setRegenerating(true);
    setError(null);
    const { error } = await supabase.rpc("regenerate_invite_code", {
      p_household_id: household.id,
    });
    setRegenerating(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  function handleCopy() {
    if (!household) return;
    navigator.clipboard?.writeText(household.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleApprove(requestId) {
    setError(null);
    const { error } = await supabase.rpc("approve_join_request", { p_request_id: requestId });
    if (error) {
      setError(error.message);
      return;
    }
    load();
    onDataChanged?.();
  }

  async function handleDeny(requestId) {
    setError(null);
    const { error } = await supabase.rpc("deny_join_request", { p_request_id: requestId });
    if (error) {
      setError(error.message);
      return;
    }
    load();
    onDataChanged?.();
  }

  async function handleRemove(targetUserId) {
    if (!household) return;
    setError(null);
    const { error } = await supabase.rpc("remove_household_member", {
      p_household_id: household.id,
      p_target_user_id: targetUserId,
    });
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleLeave() {
    setLeaveError(null);
    const { error } = await supabase.rpc("leave_household");
    if (error) {
      setLeaveError(error.message);
      return;
    }
    window.location.reload();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  async function handleDeleteEverything() {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.rpc("delete_my_household_data");
    if (error) {
      setDeleting(false);
      setDeleteError(error.message);
      return;
    }
    await supabase.auth.signOut();
  }

  async function handleSendSwitchRequest() {
    setSwitchBusy(true);
    setSwitchError(null);
    const { error } = await supabase.rpc("request_join_household", {
      p_invite_code: switchCode.trim(),
    });
    setSwitchBusy(false);
    if (error) {
      setSwitchError(error.message || "Couldn't request to join with that code.");
      return;
    }
    setSwitchConfirming(false);
    setSwitchSent(true);
  }

  function resetSwitchForm() {
    setSwitchOpen(false);
    setSwitchCode("");
    setSwitchConfirming(false);
    setSwitchSent(false);
    setSwitchError(null);
  }

  function startEditName() {
    setNameDraft(household.name);
    setEditingName(true);
  }

  async function handleSaveName() {
    if (!household || !nameDraft.trim()) return;
    setRenaming(true);
    setError(null);
    const { error } = await supabase.rpc("rename_household", {
      p_household_id: household.id,
      p_name: nameDraft.trim(),
    });
    setRenaming(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingName(false);
    load();
    onDataChanged?.();
  }

  const expiry = household ? formatExpiry(household.invite_code_expires_at) : null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>Settings</h2>

        {loading ? (
          <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>Loading…</p>
        ) : household ? (
          <>
            {editingName ? (
              <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                <input
                  type="text"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  style={{
                    flex: 1,
                    fontSize: 14,
                    padding: "5px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                />
                <button style={smallBtnStyle} onClick={handleSaveName} disabled={renaming}>
                  {renaming ? "Saving…" : "Save"}
                </button>
                <button style={smallBtnStyle} onClick={() => setEditingName(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <p
                style={{
                  fontSize: 14,
                  color: "var(--ink-muted)",
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {household.name}
                <button style={smallBtnStyle} onClick={startEditName}>
                  Rename
                </button>
              </p>
            )}

            <div style={sectionLabelStyle}>Members</div>
            {members.map((m) => (
              <MemberRow key={m.user_id} member={m} currentUserId={currentUserId} onRemove={handleRemove} />
            ))}

            {requests.length > 0 && (
              <>
                <div style={sectionLabelStyle}>Waiting to join ({requests.length})</div>
                {requests.map((r) => (
                  <RequestRow key={r.id} request={r} onApprove={handleApprove} onDeny={handleDeny} />
                ))}
              </>
            )}

            <div style={sectionLabelStyle}>Invite code</div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 3,
                padding: 12,
                textAlign: "center",
                border: "1px solid var(--border)",
                borderRadius: 6,
                marginBottom: 8,
                fontFamily: "monospace",
                background: "var(--bg)",
                color: "var(--ink)",
              }}
            >
              {household.invite_code}
            </div>
            {expiry && (
              <p
                style={{
                  fontSize: 12.5,
                  color: expiry.expired ? "var(--danger)" : "var(--ink-muted)",
                  marginBottom: 14,
                }}
              >
                {expiry.text}
              </p>
            )}
            <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 14 }}>
              Anyone who enters this code will show up above under "Waiting to join" until you approve them —
              they won't see any data until then.
            </p>
            <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={handleCopy}>
              {copied ? "Copied!" : "Copy code"}
            </button>
            <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? "Generating…" : "Generate a new code"}
            </button>
            {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

            <HistorySection />

            <div style={sectionLabelStyle}>Switch households</div>
            {!switchOpen ? (
              <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={() => setSwitchOpen(true)}>
                Join a different household
              </button>
            ) : switchSent ? (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12.5, color: "var(--income)", marginBottom: 8 }}>
                  Request sent. You'll keep using {household.name} normally until someone in the other household
                  approves it.
                </p>
                <button style={buttonStyle} onClick={resetSwitchForm}>
                  Done
                </button>
              </div>
            ) : switchConfirming ? (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 8 }}>
                  If this is accepted, your current data in <strong>{household.name}</strong> will be merged into
                  the household for this code, and you'll leave {household.name} — it won't be usable from here
                  afterward. Any of your accounts or categories with names that collide will be renamed so
                  nothing gets confused between the two. This still requires someone in the other household to
                  approve you first.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    style={{ ...buttonStyle, border: "1px solid var(--danger)", color: "var(--danger)" }}
                    onClick={handleSendSwitchRequest}
                    disabled={switchBusy}
                  >
                    {switchBusy ? "Sending…" : "Send request"}
                  </button>
                  <button style={buttonStyle} onClick={() => setSwitchConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  placeholder="Enter invite code"
                  value={switchCode}
                  onChange={(e) => setSwitchCode(e.target.value)}
                  style={{
                    width: "100%",
                    fontSize: 14,
                    padding: "8px 10px",
                    marginBottom: 8,
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    boxSizing: "border-box",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={buttonStyle} onClick={() => setSwitchConfirming(true)} disabled={!switchCode.trim()}>
                    Continue
                  </button>
                  <button style={buttonStyle} onClick={resetSwitchForm}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {switchError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{switchError}</p>}
          </>
        ) : (
          <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>
        )}

        <div style={sectionLabelStyle}>Appearance</div>
        <ThemePicker theme={theme} onChange={onThemeChange} />

        <PasswordSection />

        <div style={sectionLabelStyle}>About</div>
        <button
          style={{ ...buttonStyle, marginBottom: 8 }}
          onClick={() => {
            // Close Settings, then ask the app to replay the tour. (A signal
            // instead of an import keeps the files from importing each other
            // in a loop.)
            onClose();
            window.dispatchEvent(new Event("coinrose:start-tutorial"));
          }}
        >
          View tutorial
        </button>
        <button
          style={{ ...buttonStyle, marginBottom: 8 }}
          onClick={() => {
            // Close Settings, then ask disclosureGate.jsx to show the notice.
            // (A signal instead of an import keeps the two files from
            // importing each other in a loop.)
            onClose();
            window.dispatchEvent(new Event("coinrose:show-disclosure"));
          }}
        >
          View disclosure
        </button>

        <div style={sectionLabelStyle}>Account</div>
        {leaveConfirming ? (
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 8 }}>
              You'll get a personal copy of the current data, and lose access to this household going forward.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ ...buttonStyle, border: "1px solid var(--danger)", color: "var(--danger)" }}
                onClick={handleLeave}
              >
                Confirm leave
              </button>
              <button style={buttonStyle} onClick={() => setLeaveConfirming(false)}>
                Cancel
              </button>
            </div>
            {leaveError && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{leaveError}</p>}
          </div>
        ) : (
          <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={() => setLeaveConfirming(true)}>
            Leave this household
          </button>
        )}
        <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={handleSignOut}>
          Sign out
        </button>

        <div style={{ ...sectionLabelStyle, color: "var(--danger)" }}>Danger zone</div>
        {members.length > 1 ? (
          <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>
            This household has other members, so its data isn't only yours to delete. Use "Leave this household"
            above if you want to disconnect — that keeps everyone's data intact, including your own copy.
          </p>
        ) : deleteConfirming ? (
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 8 }}>
              This permanently deletes every account, transaction, and category in this household right now.
              Unlike leaving, nothing is kept anywhere — not a copy, not even in Data History. This cannot be
              undone.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ ...buttonStyle, border: "1px solid var(--danger)", color: "var(--danger)" }}
                onClick={handleDeleteEverything}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Yes, delete everything"}
              </button>
              <button style={buttonStyle} onClick={() => setDeleteConfirming(false)}>
                Cancel
              </button>
            </div>
            {deleteError && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{deleteError}</p>}
          </div>
        ) : (
          <button
            style={{ ...buttonStyle, marginBottom: 8, border: "1px solid var(--danger)", color: "var(--danger)" }}
            onClick={() => setDeleteConfirming(true)}
          >
            Delete all my data
          </button>
        )}

        <button style={{ ...buttonStyle, marginTop: 8, background: "none" }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export default function HouseholdGate({ children }) {
  const [status, setStatus] = useState("checking"); // checking | none | pending | denied | ready
  const [householdName, setHouseholdName] = useState("");
  const [activeHouseholdName, setActiveHouseholdName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createdCode, setCreatedCode] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [theme, setTheme] = useState(loadTheme);

  // Injects the theme CSS variables into <head> once, regardless of
  // which status branch is currently rendering below — a plain <style>
  // tag in JSX would need repeating in every early return.
  useEffect(() => {
    let styleEl = document.getElementById("ledger-theme-vars");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "ledger-theme-vars";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = THEME_VARS_CSS;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function handleThemeChange(themeId) {
    setTheme(themeId);
    saveTheme(themeId);
  }

  async function refreshPendingCount(householdId) {
    if (!householdId) {
      setPendingCount(0);
      return;
    }
    const { data } = await supabase
      .from("household_join_requests")
      .select("id")
      .eq("household_id", householdId)
      .eq("status", "pending");
    setPendingCount((data || []).length);
  }

  async function checkMembership() {
    setStatus("checking");
    resetHouseholdCache();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: membership } = await supabase
      .from("household_members")
      .select("household_id, households(name)")
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership) {
      setStatus("ready");
      setActiveHouseholdName(membership.households?.name || "");
      refreshPendingCount(membership.household_id);
      return;
    }
    setActiveHouseholdName("");

    const { data: request } = await supabase
      .from("household_join_requests")
      .select("id, status")
      .eq("requester_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (request && request.status === "pending") {
      setStatus("pending");
    } else if (request && request.status === "denied") {
      setStatus("denied");
    } else {
      setStatus("none");
    }
  }

  useEffect(() => {
    checkMembership();
  }, []);

  // Tab title for the household screens. Once the app is showing
  // ("ready"), the app sets its own titles by page.
  useEffect(() => {
    if (status === "ready") return;
    const page = {
      pending: "Waiting for Approval",
      denied: "Request Not Approved",
      none: createdCode ? "Household Created" : "Set Up Your Household",
    }[status];
    document.title = page ? `${page} | Coinrose` : "Coinrose";
  }, [status, createdCode]);

  // Poll for a decision while waiting on approval.
  useEffect(() => {
    if (status !== "pending") return;
    const interval = setInterval(checkMembership, 8000);
    return () => clearInterval(interval);
  }, [status]);

  // Periodically refresh the pending-request badge while inside the app.
  useEffect(() => {
    if (status !== "ready") return;
    const interval = setInterval(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: membership } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", user.id)
        .maybeSingle();
      refreshPendingCount(membership?.household_id);
    }, 30000);
    return () => clearInterval(interval);
  }, [status]);

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data: householdId, error } = await supabase.rpc("create_household", {
      p_name: householdName.trim() || "My Household",
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const { data: hh } = await supabase
      .from("households")
      .select("invite_code")
      .eq("id", householdId)
      .maybeSingle();
    setBusy(false);
    resetHouseholdCache();
    setCreatedCode(hh?.invite_code || null);
  }

  async function handleRequestJoin(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("request_join_household", {
      p_invite_code: joinCode.trim(),
    });
    setBusy(false);
    if (error) {
      setError(error.message || "Couldn't request to join with that code.");
      return;
    }
    checkMembership();
  }

  if (status === "checking") {
    return (
      <div style={boxStyle}>
        <DecoRing className="coinrose-bg-ring" />
        <LoadingIndicator />
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div style={boxStyle}>
        <DecoRing className="coinrose-bg-ring" />
        <div style={{ width: "min(360px, 92vw)", textAlign: "center", boxSizing: "border-box" }}>
          <h2 style={{ marginBottom: 4 }}>Waiting for approval</h2>
          <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>
            Your request to join has been sent. Someone already in the household needs to approve you before
            you can see anything — this page will update automatically once they do.
          </p>
          <button style={{ ...buttonStyle, marginTop: 12, background: "none" }} onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div style={boxStyle}>
        <DecoRing className="coinrose-bg-ring" />
        <div style={{ width: "min(360px, 92vw)", textAlign: "center", boxSizing: "border-box" }}>
          <h2 style={{ marginBottom: 4 }}>Request not approved</h2>
          <p style={{ fontSize: 14, color: "var(--ink-muted)", marginBottom: 16 }}>
            Your request to join wasn't approved. Double check the code with whoever sent it, or try again.
          </p>
          <button style={buttonStyle} onClick={() => setStatus("none")}>
            Try a different code
          </button>
          <button style={{ ...buttonStyle, marginTop: 8, background: "none" }} onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (status === "none") {
    if (createdCode) {
      return (
        <div style={boxStyle}>
          <DecoRing className="coinrose-bg-ring" />
          <div style={{ width: "min(360px, 92vw)", boxSizing: "border-box" }}>
            <h2 style={{ marginBottom: 4 }}>Household created</h2>
            <p style={{ fontSize: 14, color: "var(--ink)" }}>
              Share this code with whoever you want to join. When they enter it, you'll see a request waiting
              for your approval in the Household panel — nothing is shared until you approve it.
            </p>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 3,
                padding: 14,
                textAlign: "center",
                border: "1px solid var(--border)",
                borderRadius: 6,
                margin: "14px 0",
                fontFamily: "monospace",
                background: "var(--panel)",
              }}
            >
              {createdCode}
            </div>
            <button style={buttonStyle} onClick={checkMembership}>
              Continue
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={boxStyle}>
        <DecoRing className="coinrose-bg-ring" />
        <div style={{ width: "min(360px, 92vw)", boxSizing: "border-box" }}>
          <h2 style={{ marginBottom: 4 }}>Set up your household</h2>
          <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>
            Create a new household, or request to join one with an invite code someone shared with you.
          </p>

          <form onSubmit={handleCreate} style={{ marginTop: 20 }}>
            <input
              type="text"
              placeholder="Household name (optional)"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              Create a new household
            </button>
          </form>

          <div style={{ textAlign: "center", margin: "16px 0", color: "var(--ink-muted)", fontSize: 12 }}>— or —</div>

          <form onSubmit={handleRequestJoin}>
            <input
              type="text"
              required
              placeholder="Enter invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              Request to join
            </button>
          </form>

          {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

          <button style={{ ...buttonStyle, marginTop: 8, background: "none" }} onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {React.cloneElement(children, { householdName: activeHouseholdName })}
      <button
        onClick={() => setPanelOpen(true)}
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          padding: "8px 14px",
          fontSize: 12.5,
          fontFamily: "sans-serif",
          background: "var(--panel)",
          color: "var(--ink)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          zIndex: 50,
        }}
      >
        Settings
        {pendingCount > 0 && (
          <span
            style={{
              marginLeft: 6,
              // Deliberately a fixed color, not var(--danger) — this is a
              // small solid alert badge, and a couple of the dark themes'
              // --danger values are light enough that white text on them
              // would lose contrast. A fixed, always-dark red keeps the
              // badge legible regardless of theme.
              background: "#C0392B",
              color: "#fff",
              borderRadius: 999,
              padding: "1px 6px",
              fontSize: 11,
            }}
          >
            {pendingCount}
          </span>
        )}
      </button>
      {panelOpen && (
        <HouseholdPanel
          onClose={() => setPanelOpen(false)}
          onDataChanged={checkMembership}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      )}
    </>
  );
}