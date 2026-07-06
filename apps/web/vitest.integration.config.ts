import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests drive the real Stripe CLI (`stripe listen` / `stripe trigger`)
// against the webhook route handler. Node environment (the route is server-only)
// and serial execution (the CLI listener is a shared per-account resource).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/unit/setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/unit/shims/server-only.ts"),
    },
  },
});
