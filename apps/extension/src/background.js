// Talysman extension background service worker (MV3).
//
// Receives live blocking state from the privileged service via a native-messaging host
// (talysman-natmsg.exe, which bridges browser stdio ⇄ the service's named pipe) and translates it
// into declarativeNetRequest dynamic rules. DNR dynamic rules persist across service-worker
// restarts, so enforcement survives the worker sleeping; we only touch them when state changes.
//
// Liveness handshake (strict mode): while connected, the extension sends the service a
// periodic heartbeat reporting that it can actually block. The native service closes any supported
// browser that stops proving the extension is alive during a locked session, so this heartbeat is
// what keeps the browser usable. The open native-messaging port also keeps the MV3 worker alive.
//
// Fail-safe stance: if the host disconnects we KEEP the last-applied rules and reconnect with
// backoff. On reconnect the service re-pushes authoritative state.

import { buildRules } from './rules.js';

// Prefer the callback-compatible `chrome` namespace where both aliases exist (notably Firefox).
// Safari exposes `browser`, which is also callback-compatible for native messaging.
const browserApi = globalThis.chrome || globalThis.browser;
const HOST_NAME = 'com.talysman.host';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_MS = 5000;
const SAFARI_SYNC_MS = 1000;
const HEARTBEAT_ACK_STALE_MS = 12000;

let port = null;
let reconnectTimer = null;
let safariSyncTimer = null;
let safariConnected = false;
let reconnectMs = RECONNECT_MIN_MS;
let hasReceivedState = false;

// Health/diagnostic state reported in the heartbeat.
let blockingActive = false; // last state.active the service pushed
let blockingMode = null; // last state.mode the service pushed; never includes configured domains
let lastApplyOk = true; // last updateDynamicRules succeeded
let appliedRuleCount = 0; // number of dynamic rules currently applied
let heartbeatSequence = 0;
let lastHeartbeatSentAt = null;
let lastHeartbeatAckAt = null;
let lastHeartbeatAckSequence = null;

// Stable-ish identifiers for this worker session (best-effort; the service correlates by browser
// PID, not these).
const PROFILE_ID = (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || String(Date.now());

function detectBrowser() {
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('OPR/')) return 'opera';
  if (ua.includes('Vivaldi')) return 'vivaldi';
  if (ua.includes('Safari/') && !ua.includes('Chrome/') && !ua.includes('Chromium/')) return 'safari';
  if (ua.includes('Chrome')) return 'chrome';
  return 'unknown';
}

const BROWSER = detectBrowser();
const EXTENSION_VERSION = (browserApi.runtime.getManifest && browserApi.runtime.getManifest().version) || '';

console.info('[talysman] worker started', {
  workerSessionId: PROFILE_ID,
  browser: BROWSER,
  extensionVersion: EXTENSION_VERSION,
});

/** Replace all dynamic rules with the ones derived from `state`. */
async function applyState(state) {
  blockingActive = !!state.active;
  blockingMode = ['blacklist', 'whitelist', 'block-all'].includes(state.mode) ? state.mode : null;
  hasReceivedState = true;
  let next;
  try {
    next = buildRules(state, { safari: BROWSER === 'safari' });
  } catch (e) {
    console.error('[talysman] buildRules failed', e);
    lastApplyOk = false;
    return;
  }
  try {
    const existing = await browserApi.declarativeNetRequest.getDynamicRules();
    await browserApi.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: next,
    });
    appliedRuleCount = next.length;
    lastApplyOk = true;
    // Do not log the configured domain list. It is local user data and is not needed for support.
    console.info('[talysman] applied', next.length, 'rule(s)');
  } catch (e) {
    console.error('[talysman] updateDynamicRules failed', e);
    lastApplyOk = false;
  }
}

/** Self-report whether the extension can actually enforce blocking right now. */
function currentHealth() {
  const permissionsOk = typeof browserApi.declarativeNetRequest !== 'undefined';
  return {
    canBlock: permissionsOk && lastApplyOk,
    permissionsOk,
    dnrRulesApplied: appliedRuleCount,
  };
}

/** Read-only status exposed to the toolbar popup. Never include the configured domain list. */
function currentPopupStatus() {
  const heartbeatAckAgeMs = lastHeartbeatAckAt === null ? null : Date.now() - lastHeartbeatAckAt;
  const transportConnected = port !== null || safariConnected;
  const roundTripConnected = transportConnected
    && heartbeatAckAgeMs !== null
    && heartbeatAckAgeMs <= HEARTBEAT_ACK_STALE_MS;

  return {
    connection: roundTripConnected ? 'connected' : transportConnected ? 'connecting' : 'disconnected',
    hasReceivedState,
    focusActive: blockingActive,
    mode: blockingMode,
    health: currentHealth(),
    version: EXTENSION_VERSION,
    diagnostics: {
      workerSessionId: PROFILE_ID,
      heartbeatSequence,
      lastHeartbeatSentAt,
      lastHeartbeatAckAt,
      lastHeartbeatAckSequence,
      heartbeatAckAgeMs,
    },
  };
}

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'talysman:get-status') return undefined;
  sendResponse(currentPopupStatus());
  return false;
});

function connect() {
  if (BROWSER === 'safari') {
    scheduleSafariSync(0);
    return;
  }
  if (port) return;

  console.info('[talysman] opening native port', { workerSessionId: PROFILE_ID });
  try {
    port = browserApi.runtime.connectNative(HOST_NAME);
  } catch (e) {
    console.error('[talysman] connectNative threw', e);
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener((msg) => {
    // The host sends the full state on connect and on every change.
    if (msg && msg.type === 'state') {
      reconnectMs = RECONNECT_MIN_MS; // healthy connection → reset backoff
      console.info('[talysman] native state received', {
        workerSessionId: PROFILE_ID,
        active: !!msg.active,
        mode: msg.mode,
        domainCount: Array.isArray(msg.domains) ? msg.domains.length : 0,
      });
      applyState(msg);
      return;
    }
    if (msg && msg.type === 'heartbeatAck') {
      lastHeartbeatAckAt = Date.now();
      lastHeartbeatAckSequence = msg.sequence ?? null;
      reconnectMs = RECONNECT_MIN_MS;
      console.info('[talysman] heartbeat acknowledged', {
        workerSessionId: PROFILE_ID,
        sequence: msg.sequence,
        browserPid: msg.browserPid,
        healthy: msg.healthy,
      });
    }
  });

  port.onDisconnect.addListener(() => {
    const err = browserApi.runtime.lastError;
    console.warn('[talysman] native host disconnected', err && err.message);
    port = null;
    scheduleReconnect();
  });

  // Ask the host for current state immediately.
  try {
    port.postMessage({ type: 'hello' });
  } catch (e) {
    console.error('[talysman] hello failed', e);
  }
}

function heartbeatFrame() {
  const sequence = ++heartbeatSequence;
  const sentAt = Date.now();
  lastHeartbeatSentAt = sentAt;
  return {
    type: 'heartbeat',
    sequence,
    sentAt,
    browser: BROWSER,
    workerSessionId: PROFILE_ID,
    extensionVersion: EXTENSION_VERSION,
    lockedActive: blockingActive,
    health: currentHealth(),
  };
}

// Safari native messaging is mediated by the containing app extension. A short request/response
// sync is more reliable there than holding Chromium's stdio-style native port open indefinitely.
// The Swift handler returns both the current blocking state and the heartbeat acknowledgement.
function scheduleSafariSync(delay) {
  if (safariSyncTimer !== null) return;
  safariSyncTimer = setTimeout(() => {
    safariSyncTimer = null;
    const frame = heartbeatFrame();
    try {
      browserApi.runtime.sendNativeMessage(HOST_NAME, frame, (response) => {
        const error = browserApi.runtime.lastError;
        if (error || !response || response.type === 'error') {
          safariConnected = false;
          console.warn('[talysman] Safari native sync failed', error?.message || response?.message);
          scheduleSafariSync(Math.min(reconnectMs, RECONNECT_MAX_MS));
          reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
          return;
        }

        safariConnected = true;
        reconnectMs = RECONNECT_MIN_MS;
        if (response.state) applyState(response.state);
        if (response.heartbeatAck) {
          lastHeartbeatAckAt = Date.now();
          lastHeartbeatAckSequence = response.heartbeatAck.sequence ?? null;
        }
        scheduleSafariSync(SAFARI_SYNC_MS);
      });
    } catch (error) {
      safariConnected = false;
      console.warn('[talysman] Safari native sync threw', error && error.message);
      scheduleSafariSync(Math.min(reconnectMs, RECONNECT_MAX_MS));
      reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
    }
  }, delay);
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  const delay = reconnectMs;
  reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/** Periodic liveness heartbeat. Skips quietly when disconnected; reconnect resumes it. */
function heartbeat() {
  if (port) {
    try {
      const frame = heartbeatFrame();
      port.postMessage(frame);
      console.info('[talysman] heartbeat sent', {
        workerSessionId: PROFILE_ID,
        sequence: frame.sequence,
        sentAt: frame.sentAt,
        lockedActive: blockingActive,
        health: frame.health,
      });
    } catch (e) {
      console.warn('[talysman] heartbeat post failed', e && e.message);
    }
  }
  setTimeout(heartbeat, HEARTBEAT_MS);
}

// Register these listeners synchronously so Chrome wakes this worker when the profile starts or the
// extension updates. Top-level connect also covers any other event that revives the worker.
browserApi.runtime.onStartup.addListener(connect);
browserApi.runtime.onInstalled.addListener(connect);

connect();
heartbeat();
