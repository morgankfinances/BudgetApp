// src/components/DemoMode.jsx
// The demo: the full app with made-up data, for visitors who haven't signed
// up. A banner says it's sample data and nothing is saved. Loaded only when
// someone opens the demo, so the home page stays light.

import React, { Suspense, lazy } from "react";
import { startDemo } from "../ledgerStore.js";
import { buildDemoLedger, DEMO_MEMBERS, DEMO_YOU } from "../lib/demoData.js";
import { LoadingIndicator } from "../householdGate.jsx";

const App = lazy(() => import("../App.jsx"));

export default function DemoMode({ onExit, onGetStarted }) {
  // Switch the data layer to sample data before the app first loads. (It's
  // switched back by whoever closes the demo: see authGate.jsx.)
  startDemo(buildDemoLedger());
  return (
    <>
      <style>{DEMO_STYLES}</style>
      <div className="demo-bar" role="region" aria-label="Demo">
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
`;
