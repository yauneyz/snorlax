// FocusLock extension background service worker (MV3).
//
// Receives live blocking state from the privileged service via a native-messaging host
// (focuslock-natmsg.exe, which bridges browser stdio ⇄ the service's named pipe) and translates it
// into declarativeNetRequest dynamic rules. DNR dynamic rules persist across service-worker
// restarts, so enforcement survives the worker sleeping; we only touch them when state changes.
//
// Fail-safe stance: if the host disconnects we KEEP the last-applied rules and reconnect with
// backoff. On reconnect the service re-pushes authoritative state. The user remains in control of
// the extension through the browser's standard disable/remove controls.

import { buildRules } from './rules.js';

const HOST_NAME = 'com.focuslock.host';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let port = null;
let reconnectMs = RECONNECT_MIN_MS;

/** Replace all dynamic rules with the ones derived from `state`. */
async function applyState(state) {
  let next;
  try {
    next = buildRules(state);
  } catch (e) {
    console.error('[focuslock] buildRules failed', e);
    return;
  }
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: next,
    });
    // Do not log the configured domain list. It is local user data and is not needed for support.
    console.info('[focuslock] applied', next.length, 'rule(s)');
  } catch (e) {
    console.error('[focuslock] updateDynamicRules failed', e);
  }
}

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    console.error('[focuslock] connectNative threw', e);
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
    console.warn('[focuslock] native host disconnected', err && err.message);
    port = null;
    scheduleReconnect();
  });

  // Ask the host for current state immediately.
  try {
    port.postMessage({ type: 'hello' });
  } catch (e) {
    console.error('[focuslock] hello failed', e);
  }
}

function scheduleReconnect() {
  const delay = reconnectMs;
  reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  setTimeout(connect, delay);
}

// Connect on worker start (install, browser launch, and whenever MV3 revives the worker).
connect();
