// Talysman extension background service worker (MV3).
//
// Receives live blocking state from the privileged service via a native-messaging host
// (talysman-natmsg.exe, which bridges browser stdio ⇄ the service's named pipe) and translates it
// into declarativeNetRequest dynamic rules. DNR dynamic rules persist across service-worker
// restarts, so enforcement survives the worker sleeping; we only touch them when state changes.
//
// Liveness handshake (dead-man's switch): while connected, the extension sends the service a
// periodic heartbeat reporting that it can actually block. The native service closes any supported
// browser that stops proving the extension is alive during a locked session, so this heartbeat is
// what keeps the browser usable. The open native-messaging port also keeps the MV3 worker alive.
//
// Fail-safe stance: if the host disconnects we KEEP the last-applied rules and reconnect with
// backoff. On reconnect the service re-pushes authoritative state.

import { buildRules } from './rules.js';

const HOST_NAME = 'com.talysman.host';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_MS = 5000;

let port = null;
let reconnectMs = RECONNECT_MIN_MS;

// Health/diagnostic state reported in the heartbeat.
let blockingActive = false; // last state.active the service pushed
let lastApplyOk = true; // last updateDynamicRules succeeded
let appliedRuleCount = 0; // number of dynamic rules currently applied

// Stable-ish identifiers for this worker session (best-effort; the service correlates by browser
// PID, not these).
const PROFILE_ID = (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || String(Date.now());

function detectBrowser() {
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('OPR/')) return 'opera';
  if (ua.includes('Vivaldi')) return 'vivaldi';
  if (ua.includes('Chrome')) return 'chrome';
  return 'unknown';
}

const BROWSER = detectBrowser();
const EXTENSION_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';

/** Replace all dynamic rules with the ones derived from `state`. */
async function applyState(state) {
  blockingActive = !!state.active;
  let next;
  try {
    next = buildRules(state);
  } catch (e) {
    console.error('[talysman] buildRules failed', e);
    lastApplyOk = false;
    return;
  }
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
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
  const permissionsOk = typeof chrome.declarativeNetRequest !== 'undefined';
  return {
    canBlock: permissionsOk && lastApplyOk,
    permissionsOk,
    dnrRulesApplied: appliedRuleCount,
  };
}

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    console.error('[talysman] connectNative threw', e);
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener((msg) => {
    // The host sends the full state on connect and on every change.
    if (msg && msg.type === 'state') {
      reconnectMs = RECONNECT_MIN_MS; // healthy connection → reset backoff
      applyState(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
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

function scheduleReconnect() {
  const delay = reconnectMs;
  reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  setTimeout(connect, delay);
}

/** Periodic liveness heartbeat. Skips quietly when disconnected; reconnect resumes it. */
function heartbeat() {
  if (port) {
    try {
      port.postMessage({
        type: 'heartbeat',
        browser: BROWSER,
        profileId: PROFILE_ID,
        extensionVersion: EXTENSION_VERSION,
        lockedActive: blockingActive,
        health: currentHealth(),
      });
    } catch (e) {
      console.warn('[talysman] heartbeat post failed', e && e.message);
    }
  }
  setTimeout(heartbeat, HEARTBEAT_MS);
}

// Connect on worker start (install, browser launch, and whenever MV3 revives the worker), and start
// the heartbeat loop. Both restart cleanly if the worker is torn down and revived.
connect();
heartbeat();
