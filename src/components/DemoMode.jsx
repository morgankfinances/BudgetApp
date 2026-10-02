// src/components/DemoMode.jsx
// The demo: the full app with made-up data, for visitors who haven't signed
// up. A banner says it's sample data and nothing is saved. Loaded only when
// someone opens the demo, so the home page stays light.

import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { startDemo } from "../ledgerStore.js";
import { buildDemoLedger, DEMO_MEMBERS, DEMO_YOU } from "../lib/demoData.js";
import { TUTORIAL_EVENT } from "../lib/tutorial.js";
import { ImportSettings, LoadingIndicator, ThemePicker, buttonStyle, cardStyle, loadTheme, overlayStyle, saveTheme, sectionLabelStyle } from "../householdGate.jsx";

const App = lazy(() => import("../App.jsx"));

// A sample invite code for the demo's Settings. Real codes are 8 characters
// of 0-9 and A-F, so this one can never be made for (or match) a real
// household.
export const DEMO_INVITE_CODE = "DEMO-CODE";

// The demo's Settings: themes, the tour, and the import settings really
// work; household details are samples; account features point to signing up.
function DemoSettings({ onGetStarted }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(loadTheme);
  const buttonRef = useRef(null);
  const dialogRef = useRef(null);
  const close = () => {
    setOpen(false);
    setTimeout(() => buttonRef.current && buttonRef.current.focus(), 0);
  };
  useEffect(() => {
    if (!open) return undefined;
    if (dialogRef.current) dialogRef.current.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // Keep Tab inside the panel while it's open.
  function trapTab(e) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  const chooseTheme = (id) => {
    setTheme(id);
    saveTheme(id);
    document.documentElement.setAttribute("data-theme", id);
  };
  return (
    <>
      <button ref={buttonRef} type="button" className="demo-settings-btn" onClick={() => setOpen(true)}>
        Settings
      </button>
      {open && (
        <div style={overlayStyle} onClick={close}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-settings-title"
            tabIndex={-1}
            style={{ ...cardStyle, outline: "none" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
          >
            <h2 id="demo-settings-title" style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>
              Settings <span className="demo-tag">Demo</span>
            </h2>
            <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--ink-muted)" }}>Sample Household</p>

            <div style={sectionLabelStyle}>Members</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", fontSize: 13 }}>
              {DEMO_MEMBERS.map((m) => (
                <li key={m.user_id} style={{ padding: "4px 0" }}>
                  {m.email}
                  {m.user_id === DEMO_YOU ? " (you)" : ""} · {m.role === "owner" ? "Owner" : "Member"}
                </li>
              ))}
            </ul>

            <div style={sectionLabelStyle}>Invite code</div>
            <div className="demo-invite-code">{DEMO_INVITE_CODE}</div>
            <p style={{ fontSize: 12.5, margin: "4px 0 12px", color: "var(--ink-muted)" }}>
              A sample. In your own household, this is the code you share so people can ask to join.
            </p>

            <ImportSettings />

            <div style={sectionLabelStyle}>Appearance</div>
            <ThemePicker theme={theme} onChange={chooseTheme} />

            <div style={sectionLabelStyle}>About</div>
            <button
              type="button"
              style={{ ...buttonStyle, marginBottom: 12 }}
              onClick={() => {
                close();
                window.dispatchEvent(new Event(TUTORIAL_EVENT));
              }}
            >
              View tutorial
            </button>
            <p style={{ fontSize: 12.5, margin: "0 0 12px" }}>
              <a href="/help.html" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>
                Help &amp; FAQ
              </a>
            </p>

            <div style={sectionLabelStyle}>In your own account</div>
            <p style={{ fontSize: 13, margin: "0 0 8px" }}>
              Inviting people, passwords and two-step sign-in, Data History, and deleting your account all work once you
              have an account. They're not part of the demo.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={buttonStyle} onClick={onGetStarted}>
                Create your account
              </button>
              <button type="button" style={buttonStyle} onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function DemoMode({ onExit, onGetStarted }) {
  // Switch the data layer to sample data before the app first loads. (It's
  // switched back by whoever closes the demo: see authGate.jsx.)
  startDemo(buildDemoLedger());
  // Tell anything pinned to the top of the screen how tall this banner is,
  // so it sits below it (it wraps on narrow windows, so it's measured).
  const barRef = useRef(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => barRef.current && root.style.setProperty("--top-banner-height", `${barRef.current.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (observer && barRef.current) observer.observe(barRef.current);
    window.addEventListener("resize", measure);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--top-banner-height");
    };
  }, []);
  return (
    <>
      <style>{DEMO_STYLES}</style>
      <DemoSettings onGetStarted={onGetStarted} />
      <div className="demo-bar" role="region" aria-label="Demo" ref={barRef}>
        <p>
          <strong>You're exploring a demo</strong> with made-up sample data. Look around and change anything: nothing is
          saved.
        </p>
        <div className="demo-bar-actions">
          <button type="button" className="demo-bar-btn demo-bar-btn-primary" onClick={onGetStarted}>
            Create your account
          </button>
          <button type="button" className="demo-bar-btn" onClick={onExit}>
            Exit demo
          </button>
        </div>
      </div>
      <Suspense
        fallback={
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LoadingIndicator label="Loading the demo…" />
          </div>
        }
      >
        <App householdName="Sample Household" currentUserId={DEMO_YOU} householdMembers={DEMO_MEMBERS} />
      </Suspense>
    </>
  );
}

const DEMO_STYLES = `
.demo-bar {
  position: sticky; top: 0; z-index: 40;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 8px 16px;
  background: var(--accent-button); color: var(--on-accent);
  font-family: 'Coinrose Body', -apple-system, 'Segoe UI', sans-serif; font-size: 14px;
}
.demo-bar p { margin: 0; }
.demo-bar-actions { display: flex; gap: 8px; }
.demo-bar-btn {
  font: inherit; font-weight: 600; font-size: 13px; cursor: pointer;
  padding: 6px 12px; border-radius: 6px;
  background: transparent; color: var(--on-accent); border: 1px solid var(--on-accent);
}
.demo-bar-btn-primary { background: var(--on-accent); color: var(--accent-button); }
.demo-bar-btn:focus-visible { outline: 3px solid var(--on-accent); outline-offset: 2px; }
/* The same look and place as the real Settings button. */
.demo-settings-btn {
  position: fixed; bottom: 16px; right: 16px; z-index: 50;
  padding: 8px 14px; font-size: 12.5px; font-family: 'Coinrose Body', -apple-system, 'Segoe UI', sans-serif;
  background: var(--panel); color: var(--ink); border: 1px solid var(--border); border-radius: 6px;
  cursor: pointer; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.demo-tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; vertical-align: 3px;
  padding: 2px 6px; border-radius: 4px; background: var(--subtle-bg); color: var(--ink-muted); margin-left: 6px; }
.demo-invite-code { font-family: monospace; font-size: 18px; letter-spacing: .12em; padding: 8px 12px; border-radius: 6px;
  background: var(--subtle-bg); color: var(--ink); text-align: center; }
`;
