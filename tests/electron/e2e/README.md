# Category-1 E2E (playwright-electron)

These specs drive the **real Electron UI** against the **in-process mock service** (no
privileges / real blocking needed). The test command builds a development bundle with a
dedicated nonexistent service pipe before launching Electron, and the test fails closed unless
the main process reports that it is using the mock.

To run locally:

```bash
pnpm test:electron:e2e
```

The mock service starts automatically because the app falls back to it when the native
service pipe is unreachable (see `apps/desktop/src/main/index.ts`).
