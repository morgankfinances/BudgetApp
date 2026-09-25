import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.js", "src/ledgerStore.js"],
      exclude: ["src/lib/__tests__/**"],
      reporter: ["text", "text-summary"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
