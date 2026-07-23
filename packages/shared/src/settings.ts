/**
 * Enforcement settings (architecture §4). These are optional, opt-in hardening toggles persisted by
 * the service alongside policy/schedule. Unlike `policy`, turning a setting *off* can be gated (the
 * service re-checks the USB key itself), so the UI must treat a `setBrowserHandshake(false)` failure
 * the same way it treats a failed disable.
 */

/** Self-reported capability the extension sends with every heartbeat. */
export interface BrowserHealth {
  /** The extension currently has the permissions + applied rules to actually block. */
  canBlock: boolean;
  /** Required permissions / host access are granted. */
  permissionsOk: boolean;
  /** Number of declarativeNetRequest dynamic rules currently applied (diagnostic only). */
  dnrRulesApplied?: number;
}

export interface Settings {
  /**
   * The browser handshake "strict mode". When on, a supported browser open during a locked
   * focus session must keep proving the extension is alive (heartbeats) or the service closes it;
   * unsupported browsers are closed outright. Default off. Turning it **off** is key-gated.
   */
  browserHandshakeEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  browserHandshakeEnabled: false,
};
