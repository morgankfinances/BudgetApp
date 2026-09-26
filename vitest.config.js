import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/__tests__/setup.js"],
    // Tests never use the real Turnstile or Sentry, whatever is in your
    // .env.local (which Vitest would otherwise read, like the app does).
    env: { VITE_TURNSTILE_SITE_KEY: "", VITE_SENTRY_DSN: "" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "src/**/__tests__/**",
        "src/main.jsx",           // just starts the app
        "src/styles.js",          // CSS text, not code that runs
        "src/supabaseClient.js",  // connection setup
        "src/storageAdapter.js",
      ],
      reporter: ["text", "text-summary"],
      // "functions" counts every small inline handler (each Cancel button,
      // hover, close...), so its minimum is a bit lower.
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 70 },
    },
  },
});
