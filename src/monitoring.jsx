// src/monitoring.jsx
// Crash reporting with Sentry, configured for a finance app: errors only
// (no performance tracing, no session replay), no personal info, and the
// privacy rules in lib/monitoring.js applied to every report.
//
// Turned on only in the deployed site, and only when VITE_SENTRY_DSN is
// set. Local development never sends anything.

import React from "react";
import * as Sentry from "@sentry/react";
import { scrubEvent, scrubBreadcrumb } from "./lib/monitoring.js";

const DSN = import.meta.env?.VITE_SENTRY_DSN || "";

Sentry.init({
  dsn: DSN,
  enabled: Boolean(DSN) && Boolean(import.meta.env?.PROD),
  environment: import.meta.env?.MODE,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  integrations: [
    // Record page changes and network requests (addresses only), but not
    // console output or clicks.
    Sentry.breadcrumbsIntegration({ console: false, dom: false, fetch: true, xhr: true, history: true }),
  ],
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

function CrashScreen() {
  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontFamily: "'Work Sans', -apple-system, sans-serif",
        background: "var(--bg, #F5F6F1)",
        color: "var(--ink, #1E241F)",
      }}
    >
      <div style={{ maxWidth: 380 }}>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500, marginBottom: 8 }}>
          Something went wrong
        </h2>
        <p style={{ color: "var(--ink-muted, #62685E)", marginBottom: 18, lineHeight: 1.5 }}>
          Your saved data is safe. Reloading the page usually fixes this. If it keeps happening,
          email morgankfinances@gmail.com.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            borderRadius: 6,
            background: "var(--accent, #C2661E)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

// Wrap the app in this: a crash anywhere below shows CrashScreen instead
// of a blank page, and is reported (scrubbed) to Sentry.
export function AppErrorBoundary({ children }) {
  return <Sentry.ErrorBoundary fallback={<CrashScreen />}>{children}</Sentry.ErrorBoundary>;
}
