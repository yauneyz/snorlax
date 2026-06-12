/**
 * Auto-update wiring (architecture §12). Stub for phases 1-2; real electron-updater
 * check/download/notify lands in Phase 4 (requires code signing). Kept as a seam so
 * index.ts can call it unconditionally.
 */

import { logger } from './logging.js';

export function initUpdater(): void {
  logger.debug('[updater] disabled until Phase 4 (needs signing)');
}
