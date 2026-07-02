/**
 * Ensures the privileged service is installed and current (architecture §12). Full
 * implementation (version compare via `ping`, elevated install/repair via
 * talysman-svcctl.exe) lands in Phase 4 alongside auto-update.
 *
 * For phases 1-2 this is a stub: the service is installed by the NSIS installer, and in dev
 * you run it manually (see build-guide.md). This module exists so the import graph and the
 * Phase-4 seam are already in place.
 */

import { logger } from '../logging.js';

export async function ensureServiceInstalled(): Promise<void> {
  logger.debug('[installer] ensureServiceInstalled: no-op for phases 1-2');
}
