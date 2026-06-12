/**
 * Test-facing re-export of the in-process mock service used by the dev app. Keeping a single
 * implementation (in apps/desktop) means the behaviour the e2e tests assert against is exactly
 * what `pnpm dev` runs.
 */
export { MockServiceConnection } from '../../apps/desktop/src/main/service/mockService.js';
