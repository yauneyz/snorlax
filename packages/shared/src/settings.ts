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
  /**
   * Whether the system tray icon should be shown. Purely cosmetic (not a security boundary), so
   * unlike the other settings here, toggling it is never key-gated. Default on.
   */
  trayIconEnabled: boolean;
  /**
   * Whether the streak badge is shown (home, pause dialog, unlock popup, extension blocked page).
   * Display-only: the streak keeps being recorded either way. Never key-gated. Default on.
   */
  streakBadgeEnabled: boolean;
  /** Build/runtime capability gate. Production sets false and uses classic policy semantics. */
  smartFilteringEnabled: boolean;
  /**
   * Opt-in: count blocked site visits per day (hostname only) for the Stats page. The counts stay
   * on this device and are never sent anywhere. Turning it off deletes them. Never key-gated.
   * Default off.
   */
  blockedSiteStatsEnabled: boolean;
  /**
   * While focus is off, the browser extension shows an "are you sure?" page before opening a website
   * the default profile blocks, offering to continue, go back, or turn on focus mode instead. Apps
   * aren't asked about. Never key-gated. Default off.
   */
  confirmWhenOffEnabled: boolean;
  /** Custom text for that prompt; empty shows `DEFAULT_CONFIRM_MESSAGE`. */
  confirmMessage: string;
}

/** The "are you sure?" prompt's text when the user hasn't written their own. */
export const DEFAULT_CONFIRM_MESSAGE = 'Are you sure?';
/** Longest custom prompt text the service keeps (mirrors `CONFIRM_MESSAGE_MAX` in platform_core.rs). */
export const CONFIRM_MESSAGE_MAX = 280;

export const DEFAULT_SETTINGS: Settings = {
  browserHandshakeEnabled: false,
  trayIconEnabled: true,
  streakBadgeEnabled: true,
  smartFilteringEnabled: false,
  blockedSiteStatsEnabled: false,
  confirmWhenOffEnabled: false,
  confirmMessage: '',
};
