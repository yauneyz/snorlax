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
//
// Smart filtering: when the pushed policy has a non-null `intent`, pages that fall through both
// hard lists (`blockedDomains`/`allowedDomains`) are extracted and sent to the daemon for a
// relevance judgment (`judge-request`/`judge-result`) rather than being statically allowed or
// blocked. This is strictly additive on top of DNR — DNR still enforces the two hard lists — and
// is a no-op (zero listeners doing real work) for classic, non-Smart profiles.

import { buildRules, normalizeDomain } from './rules.js';
import { heartbeatDelayForState } from './heartbeat-timing.js';
import { extractPageContent } from './content-extract.js';

// Prefer the callback-compatible `chrome` namespace where both aliases exist (notably Firefox).
const browserApi = globalThis.chrome || globalThis.browser;
const HOST_NAME = 'com.talysman.host';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// Smart-filtering tuning. See the "Smart filtering" section below for how these are used.
const SPA_DEBOUNCE_MS = 1500;
// The daemon falls back after 8s. Keep this client guard later so its authoritative result wins.
const JUDGE_TIMEOUT_MS = 12_000;
const VERDICT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_VERDICT_CACHE_ENTRIES = 500;
const MAX_PENDING_JUDGES = 32;
const MAX_JUDGE_TEXT_LENGTH = 2000;

let port = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let reconnectMs = RECONNECT_MIN_MS;
let hasReceivedState = false;
let desiredRuleState = null;
let ruleApplyRunning = false;
let ruleApplyRetryTimer = null;
let ruleApplyRetryMs = RECONNECT_MIN_MS;
let policyGeneration = 0;
let lastAppliedGeneration = -1;

// Health/diagnostic state reported in the heartbeat.
let blockingActive = false; // last state.active the service pushed
// Unknown is fail-safe while focus is active; only explicit false relaxes the cadence.
let handshakeEnabled = null;
let blockingMode = null; // display-only label derived from policy shape; never includes domains/intent text
let lastApplyOk = true; // last updateDynamicRules succeeded
let appliedRuleCount = 0; // number of dynamic rules currently applied
let heartbeatSequence = 0;
let lastHeartbeatSentAt = null;
let lastHeartbeatAckAt = null;
let lastHeartbeatAckSequence = null;

// Current policy, tracked for the Smart-filtering navigation path (webNavigation fires between
// state pushes, so it needs somewhere to read the latest policy from). Never exposed to the popup
// or heartbeat frames beyond the derived `blockingMode` label above — same stance the old
// mode/domains split had ("never includes configured domains").
let currentPolicy = {
  active: false,
  blockedDomains: [],
  allowedDomains: [],
  defaultAction: 'allow',
  intent: null,
};

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
const EXTENSION_VERSION = (browserApi.runtime.getManifest && browserApi.runtime.getManifest().version) || '';

console.info('[talysman] worker started', {
  workerSessionId: PROFILE_ID,
  browser: BROWSER,
  extensionVersion: EXTENSION_VERSION,
});

/** Display-only mode label for the popup. Derived, never leaks domain lists or intent text. */
function deriveModeLabel(policy) {
  if (policy.intent) return 'smart';
  if (policy.defaultAction === 'block') {
    return policy.allowedDomains.length > 0 ? 'whitelist' : 'block-all';
  }
  return 'blacklist';
}

/** Accept the latest desired state synchronously, then serialize/coalesce DNR mutations. */
function applyState(state) {
  const previousHeartbeatDelay = heartbeatDelay();
  blockingActive = !!state.active;
  handshakeEnabled = typeof state.handshakeEnabled === 'boolean' ? state.handshakeEnabled : null;
  currentPolicy = {
    active: blockingActive,
    blockedDomains: Array.isArray(state.blockedDomains) ? state.blockedDomains : [],
    allowedDomains: Array.isArray(state.allowedDomains) ? state.allowedDomains : [],
    defaultAction: state.defaultAction === 'block' ? 'block' : 'allow',
    intent:
      state.intent && typeof state.intent.positive === 'string' && state.intent.positive
        ? state.intent
        : null,
  };
  policyGeneration += 1;
  invalidatePendingJudges();
  blockingMode = deriveModeLabel(currentPolicy);
  hasReceivedState = true;
  lastApplyOk = false;
  if (ruleApplyRetryTimer !== null) {
    clearTimeout(ruleApplyRetryTimer);
    ruleApplyRetryTimer = null;
    ruleApplyRetryMs = RECONNECT_MIN_MS;
  }
  desiredRuleState = { state, generation: policyGeneration };
  if (heartbeatDelay() < previousHeartbeatDelay) {
    scheduleHeartbeat(0);
  }
  void applyLatestRuleState();
}

async function applyLatestRuleState() {
  if (ruleApplyRunning || ruleApplyRetryTimer !== null) return;
  ruleApplyRunning = true;
  try {
    while (desiredRuleState) {
      const desired = desiredRuleState;
      desiredRuleState = null;
      try {
        const next = buildRules(desired.state);
        const existing = await browserApi.declarativeNetRequest.getDynamicRules();
        await browserApi.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existing.map((r) => r.id),
          addRules: next,
        });
        if (desired.generation === policyGeneration) {
          appliedRuleCount = next.length;
          lastAppliedGeneration = desired.generation;
          lastApplyOk = true;
          ruleApplyRetryMs = RECONNECT_MIN_MS;
          scheduleHeartbeat(0);
        }
        // Do not log the configured domain list. It is local user data.
        console.info('[talysman] applied', next.length, 'rule(s)');
      } catch (e) {
        console.error('[talysman] dynamic-rule update failed', e);
        lastApplyOk = false;
        // Preserve only the newest state. Retry with capped exponential backoff so a transient
        // browser failure cannot leave focus-off rules stuck forever without burning battery.
        if (!desiredRuleState && desired.generation === policyGeneration) {
          desiredRuleState = desired;
          const delay = ruleApplyRetryMs;
          ruleApplyRetryMs = Math.min(ruleApplyRetryMs * 2, RECONNECT_MAX_MS);
          ruleApplyRetryTimer = setTimeout(() => {
            ruleApplyRetryTimer = null;
            void applyLatestRuleState();
          }, delay);
          scheduleHeartbeat(0);
        }
        break;
      }
    }
  } finally {
    ruleApplyRunning = false;
    if (desiredRuleState && ruleApplyRetryTimer === null) void applyLatestRuleState();
  }
}

/** Self-report whether the extension can actually enforce blocking right now. */
function currentHealth() {
  const permissionsOk = typeof browserApi.declarativeNetRequest !== 'undefined';
  return {
    canBlock: permissionsOk && lastApplyOk && lastAppliedGeneration === policyGeneration,
    permissionsOk,
    dnrRulesApplied: appliedRuleCount,
  };
}

/** Read-only status exposed to the toolbar popup. Never include the configured domain list. */
function currentPopupStatus() {
  const heartbeatAckAgeMs = lastHeartbeatAckAt === null ? null : Date.now() - lastHeartbeatAckAt;
  const transportConnected = port !== null;
  const roundTripConnected = transportConnected
    && heartbeatAckAgeMs !== null
    && heartbeatAckAgeMs <= heartbeatDelay() * 2.5;

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
        defaultAction: msg.defaultAction,
        blockedDomainCount: Array.isArray(msg.blockedDomains) ? msg.blockedDomains.length : 0,
        allowedDomainCount: Array.isArray(msg.allowedDomains) ? msg.allowedDomains.length : 0,
        smartFilteringActive: !!(msg.intent && msg.intent.positive),
      });
      applyState(msg);
      return;
    }
    if (msg && msg.type === 'heartbeatAck') {
      lastHeartbeatAckAt = Date.now();
      lastHeartbeatAckSequence = msg.sequence ?? null;
      reconnectMs = RECONNECT_MIN_MS;
      return;
    }
    if (msg && msg.type === 'judge-result') {
      handleJudgeResult(msg);
      return;
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

function heartbeatDelay() {
  return heartbeatDelayForState({
    browser: BROWSER,
    blockingActive,
    handshakeEnabled,
  });
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
    } catch (e) {
      console.warn('[talysman] heartbeat post failed', e && e.message);
    }
  }
  scheduleHeartbeat(heartbeatDelay());
}

function scheduleHeartbeat(delay) {
  if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    heartbeat();
  }, delay);
}

// ---------------------------------------------------------------------------------------------
// Smart filtering
//
// Activates only when currentPolicy.intent is non-null. For a qualifying main-frame navigation
// that lands on neither hard list, we extract lightweight page content and ask the daemon whether
// the page is relevant to the user's stated intent. Everything here is a no-op the moment
// intent is null, so classic (non-Smart) profiles pay zero extra overhead.
// ---------------------------------------------------------------------------------------------

const spaDebounceTimers = new Map(); // tabId -> timeoutId
const verdictCache = new Map(); // cacheKey -> { relevant, reason, expiresAt }
const pendingJudgeRequests = new Map(); // requestId -> { tabId, url, timeoutId }

function invalidatePendingJudges() {
  for (const timer of spaDebounceTimers.values()) clearTimeout(timer);
  spaDebounceTimers.clear();
  for (const pending of pendingJudgeRequests.values()) {
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
  }
  pendingJudgeRequests.clear();
}

function generateRequestId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `judge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Does `hostname` match `domain` (or one of its subdomains), mirroring rules.js's DNR semantics. */
function hostnameMatchesDomain(hostname, domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  const h = hostname.toLowerCase();
  return h === normalized || h.endsWith(`.${normalized}`);
}

function hostnameMatchesAny(hostname, domains) {
  return (domains || []).some((domain) => hostnameMatchesDomain(hostname, domain));
}

function verdictCacheKey(url, intent) {
  return JSON.stringify([url, intent.positive, intent.negative || '']);
}

function getCachedVerdict(url, intent) {
  const key = verdictCacheKey(url, intent);
  const entry = verdictCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    verdictCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedVerdict(url, intent, relevant, reason) {
  const now = Date.now();
  for (const [key, entry] of verdictCache) {
    if (entry.expiresAt <= now) verdictCache.delete(key);
  }
  while (verdictCache.size >= MAX_VERDICT_CACHE_ENTRIES) {
    const oldest = verdictCache.keys().next().value;
    if (oldest === undefined) break;
    verdictCache.delete(oldest);
  }
  const key = verdictCacheKey(url, intent);
  verdictCache.delete(key);
  verdictCache.set(key, {
    relevant,
    reason,
    expiresAt: now + VERDICT_CACHE_TTL_MS,
  });
}

/** Same-page check used to guard against a verdict/timeout landing after the user navigated away. */
function urlsRoughlyMatch(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname === ub.hostname && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

/** Redirect `tabId` to the local blocked page, but only if it's still on `expectedUrl`. */
async function redirectIfStillOnUrl(tabId, expectedUrl, reason, generation = policyGeneration) {
  if (generation !== policyGeneration || !currentPolicy.active) return;
  try {
    const tab = await browserApi.tabs.get(tabId);
    if (!tab || !tab.url) return;
    if (!urlsRoughlyMatch(tab.url, expectedUrl)) return; // user already navigated away
    await browserApi.tabs.update(tabId, {
      url: browserApi.runtime.getURL('blocked.html') + '?reason=' + encodeURIComponent(reason || ''),
    });
  } catch (e) {
    // Tab likely closed mid-flight; nothing to do.
  }
}

/** Client-side backstop when defaultAction is the only signal we have (timeout or extraction failure). */
function applyDefaultActionFallback(tabId, url, reason, generation, defaultAction) {
  if (generation !== policyGeneration || !currentPolicy.active) return;
  if (defaultAction !== 'block') return; // fail-open: leave the tab alone
  void redirectIfStillOnUrl(tabId, url, reason, generation);
}

function clearPendingJudgeRequest(requestId) {
  const pending = pendingJudgeRequests.get(requestId);
  if (!pending) return;
  if (pending.timeoutId) clearTimeout(pending.timeoutId);
  pendingJudgeRequests.delete(requestId);
}

/** Handle a `judge-result` frame from the native host. */
function handleJudgeResult(msg) {
  const requestId = msg && msg.requestId;
  if (!requestId) return;
  const pending = pendingJudgeRequests.get(requestId);
  if (!pending) return; // stale (already timed out) or unknown request id

  clearPendingJudgeRequest(requestId);
  if (pending.generation !== policyGeneration || !currentPolicy.active) return;

  const url = msg.url || pending.url;
  const relevant = !!msg.relevant;
  const reason = typeof msg.reason === 'string' ? msg.reason : '';

  setCachedVerdict(url, pending.intent, relevant, reason);

  if (!relevant) {
    void redirectIfStillOnUrl(pending.tabId, pending.url, reason, pending.generation);
  }
  // relevant === true → verdict is cached above; leave the tab alone.
}

function sendJudgeRequest(requestId, tabId, url, extractedText, generation, intent, defaultAction) {
  while (pendingJudgeRequests.size >= MAX_PENDING_JUDGES) {
    const oldest = pendingJudgeRequests.keys().next().value;
    if (oldest === undefined) break;
    clearPendingJudgeRequest(oldest);
  }
  const entry = { tabId, url, generation, intent, defaultAction, timeoutId: null };
  pendingJudgeRequests.set(requestId, entry);
  entry.timeoutId = setTimeout(() => {
    if (!pendingJudgeRequests.has(requestId)) return;
    pendingJudgeRequests.delete(requestId);
    console.warn('[talysman] judge-request timed out', { requestId });
    applyDefaultActionFallback(tabId, url, "Couldn't verify in time", generation, defaultAction);
  }, JUDGE_TIMEOUT_MS);

  const frame = { type: 'judge-request', requestId, url, extractedText };
  try {
    if (port) {
      port.postMessage(frame);
    } else {
      console.warn('[talysman] no native port available for judge-request', { requestId });
    }
  } catch (e) {
    console.warn('[talysman] judge-request send failed', e && e.message);
  }
}

/** Consider a completed main-frame navigation for Smart filtering. */
async function handleQualifyingNavigation(tabId, url) {
  if (!currentPolicy.active || !currentPolicy.intent) return; // classic mode: zero overhead
  const generation = policyGeneration;
  const intent = currentPolicy.intent;
  const defaultAction = currentPolicy.defaultAction;
  if (!/^https?:\/\//i.test(url)) return; // browser-internal pages etc. are out of scope

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return;
  }

  // Already authoritatively handled by DNR (blocked) or explicitly exempt (allowed).
  if (hostnameMatchesAny(hostname, currentPolicy.blockedDomains)) return;
  if (hostnameMatchesAny(hostname, currentPolicy.allowedDomains)) return;

  const cached = getCachedVerdict(url, intent);
  if (cached) {
    if (!cached.relevant) void redirectIfStillOnUrl(tabId, url, cached.reason, generation);
    return;
  }

  let extraction = null;
  try {
    const results = await browserApi.scripting.executeScript({
      target: { tabId },
      func: extractPageContent,
    });
    extraction = results && results[0] && results[0].result;
  } catch (e) {
    console.warn('[talysman] content extraction failed', e && e.message);
  }

  // Content extraction is asynchronous. A focus/profile change invalidates the work.
  if (generation !== policyGeneration || !currentPolicy.active) return;

  if (!extraction) {
    // Couldn't determine relevance at all — fall back to defaultAction, same as an unreachable judge.
    applyDefaultActionFallback(tabId, url, "Couldn't verify in time", generation, defaultAction);
    return;
  }

  const combinedText = [extraction.title, extraction.description, extraction.text]
    .filter(Boolean)
    .join(' — ')
    .slice(0, MAX_JUDGE_TEXT_LENGTH);

  sendJudgeRequest(generateRequestId(), tabId, url, combinedText, generation, intent, defaultAction);
}

function debounceSpaNavigation(tabId, url) {
  const existing = spaDebounceTimers.get(tabId);
  if (existing) clearTimeout(existing);
  spaDebounceTimers.set(
    tabId,
    setTimeout(() => {
      spaDebounceTimers.delete(tabId);
      handleQualifyingNavigation(tabId, url);
    }, SPA_DEBOUNCE_MS),
  );
}

if (browserApi.webNavigation) {
  browserApi.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    handleQualifyingNavigation(details.tabId, details.url);
  });

  browserApi.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    debounceSpaNavigation(details.tabId, details.url);
  });
}

// Register these listeners synchronously so Chrome wakes this worker when the profile starts or the
// extension updates. Top-level connect also covers any other event that revives the worker.
browserApi.runtime.onStartup.addListener(connect);
browserApi.runtime.onInstalled.addListener(connect);

connect();
heartbeat();
