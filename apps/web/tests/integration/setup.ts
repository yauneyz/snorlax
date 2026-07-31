// Integration tests drive the real Stripe CLI against real (test-mode) Stripe, so they need
// the actual generated env — not the fake defaults in tests/unit/setup.ts. Load apps/web/.env.local
// (written by scripts/sync-env.ts) before the unit setup's `??=` fallbacks run, so real values win.
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
