# Category-1 E2E (playwright-electron)

These specs drive the **real Electron UI** against the **in-process mock service** (no
privileges / real blocking needed). They are scaffolded here; wiring them into CI is a
follow-up (needs `@playwright/test` + `playwright` installed and a built app).

To run locally once dependencies are added:

```bash
pnpm --filter @focuslock/desktop build
pnpm exec playwright test tests/electron/e2e
```

The mock service starts automatically because the app falls back to it when the native
service pipe is unreachable (see `apps/desktop/src/main/index.ts`).
