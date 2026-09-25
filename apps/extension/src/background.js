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
// DNR is not the only enforcement point: a site's service worker can answer a top-level navigation
// from Cache Storage without any network request, which DNR never sees. See the "Hard-policy
// navigation backstop" section below for the webNavigation-based second line of defense.
//
// Every top-level navigation goes through one decision: `decide()` in site-engine.js, which
// walks the policy layers (hard block → site rules → hard allow → default) and yields allow,
// block, or judge. DNR enforces the same decisions ahead of the network (see rules.js); the
// webNavigation listeners below are the backstop for what DNR can't see, and the only enforcer
// of what DNR can't express — `judge`, which extracts the page and asks the AI judge via the
// daemon (`judge-request`/`judge-result`). Site rules never block a page: blocked site features
// are hidden in-page by site-content.js, and a judge rejection on a site page hides that page's
// feature there rather than leaving the page.

import { buildRules } from './rules.js';
import { heartbeatDelayForState } from './heartbeat-timing.js';
import { extractPageContent } from './content-extract.js';
import { buildPremadeRulePlan } from './premade-rules.js';
import { SITE_CATALOG } from './site-catalog.js';
import { isAndroidBrowser, loopbackPort } from './loopback-port.js';
import { decide, effectiveFeatures, siteForHostname } from './site-engine.js';
import {
  LEGACY_HELLO_FIELDS,
  legacyJudgeRequestFields,
  upgradeLegacyJudgeResult,
  upgradeLegacyStateFrame,
} from './legacy-compat.js';

// Prefer the callback-compatible `chrome` namespace where both aliases exist (notably Firefox).
const browserApi = globalThis.chrome || globalThis.browser;
const HOST_NAME = 'com.talysman.host';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// Site-rule capability this build advertises to the native host; the host hard-blocks any site
// this build's catalog doesn't know.
const SITE_CAPABILITY = 3;
const SITE_IDS = Object.keys(SITE_CATALOG);

// AI judge tuning. See the "AI judge" section below for how these are used.
const SPA_DEBOUNCE_MS = 1500;
// The daemon falls back after 8s. Keep this client guard later so its authoritative result wins.
const JUDGE_TIMEOUT_MS = 12_000;
const VERDICT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_VERDICT_CACHE_ENTRIES = 500;
const MAX_PENDING_JUDGES = 32;
const MAX_JUDGE_TEXT_LENGTH = 4000;
const MAX_JUDGE_TITLE_LENGTH = 300;

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
let blockingMode = null; // display-only label derived from policy shape; never includes domains/task text
let lastApplyOk = true; // last static + dynamic DNR update succeeded
let appliedRuleCount = 0; // number of dynamic rules currently applied
let appliedPremadeRuleCount = 0;
let heartbeatSequence = 0;
let lastHeartbeatSentAt = null;
let lastHeartbeatAckAt = null;
let lastHeartbeatAckSequence = null;

// Current policy, tracked for the navigation backstop and the AI judge (webNavigation fires
// between state pushes, so it needs somewhere to read the latest policy from). Never exposed to
// the popup or heartbeat frames beyond the derived `blockingMode` label above — same stance the
// old mode/domains split had ("never includes configured domains").
let currentPolicy = {
  active: false,
  blockedDomains: [],
  allowedDomains: [],
  defaultAction: 'allow',
  enabledPremadeLists: [],
  sites: {},
  judge: null,
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

/** Display-only mode label for the popup. Derived, never leaks domain lists or task text. */
function deriveModeLabel(policy) {
  if (policy.defaultAction === 'judge') return 'smart';
  if (policy.defaultAction === 'block') {
    return policy.allowedDomains.length > 0 ? 'whitelist' : 'block-all';
  }
  return 'blacklist';
}

/** Built-in bulk blocklists, shipped as static DNR rulesets (see manifest.json). Toggling one is
 * an `updateStaticRules` operation. The generator packs every category into a few shared ruleset
 * files below AMO's 5MB parser limit; this avoids consuming one enabled ruleset per category while
 * keeping the large compiled domain index out of the service worker. */

/** Enable exactly the rulesets for `enabledPremadeLists` while focus is active; disable all of
 * them otherwise — mirrors `buildRules` returning `[]` when focus is inactive. */
async function applyPremadeRulesets(active, enabledPremadeLists) {
  const plan = buildPremadeRulePlan(active, enabledPremadeLists);
  if (plan.updates.length > 0 && typeof browserApi.declarativeNetRequest?.updateStaticRules !== 'function') {
    throw new Error('this browser cannot toggle individual static blocklist rules');
  }
  for (const update of plan.updates) {
    await browserApi.declarativeNetRequest.updateStaticRules(update);
  }
  await browserApi.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: plan.enableRulesetIds,
    disableRulesetIds: plan.disableRulesetIds,
  });
  return plan.enabledRuleCount;
}

/** Apply static premade rules and dynamic policy rules as one health/retry unit. */
async function applyRuleState(state) {
  const failures = [];
  let premadeRuleCount = 0;
  let next = [];
  try {
    premadeRuleCount = await applyPremadeRulesets(
      !!state.active,
      Array.isArray(state.enabledPremadeLists) ? state.enabledPremadeLists : [],
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    next = buildRules(state);
    const existing = await browserApi.declarativeNetRequest.getDynamicRules();
    await browserApi.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: next,
    });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, 'could not apply browser rules');
  return { dynamicRuleCount: next.length, premadeRuleCount };
}

function sanitizeSites(sites) {
  const out = {};
  if (!sites || typeof sites !== 'object') return out;
  for (const [id, rule] of Object.entries(sites)) {
    if (!SITE_CATALOG[id]) continue;
    const features = rule && typeof rule.features === 'object' && rule.features ? rule.features : {};
    out[id] = { features: effectiveFeatures(id, { features }) };
  }
  return out;
}

function sanitizeJudge(judge) {
  if (!judge || !Array.isArray(judge.tasks) || judge.tasks.length === 0) return null;
  return {
    tasks: judge.tasks.filter((task) => task && typeof task.title === 'string'),
    avoid: Array.isArray(judge.avoid) ? judge.avoid.filter((item) => typeof item === 'string') : [],
    fallback: judge.fallback === 'block' ? 'block' : 'allow',
  };
}

/** Accept the latest desired state synchronously, then serialize/coalesce DNR mutations. */
function applyState(frame) {
  const state = upgradeLegacyStateFrame(frame); // LEGACY-COMPAT(v5)
  const previousHeartbeatDelay = heartbeatDelay();
  blockingActive = !!state.active;
  handshakeEnabled = typeof state.handshakeEnabled === 'boolean' ? state.handshakeEnabled : null;
  const defaultAction = ['allow', 'judge', 'block'].includes(state.defaultAction) ? state.defaultAction : 'allow';
  currentPolicy = {
    active: blockingActive,
    blockedDomains: Array.isArray(state.blockedDomains) ? state.blockedDomains : [],
    allowedDomains: Array.isArray(state.allowedDomains) ? state.allowedDomains : [],
    defaultAction,
    enabledPremadeLists: Array.isArray(state.enabledPremadeLists) ? state.enabledPremadeLists : [],
    sites: sanitizeSites(state.sites),
    judge: sanitizeJudge(state.judge),
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
  desiredRuleState = { state: currentPolicy, generation: policyGeneration };
  if (heartbeatDelay() < previousHeartbeatDelay) {
    scheduleHeartbeat(0);
  }
  void applyLatestRuleState();
  // DNR only affects requests made from here on, so a tab already sitting on a now-blocked page
  // would stay put. Re-check what's open against the new policy.
  void enforcePolicyOnOpenTabs();
  void notifySiteContentScripts();
}

async function applyLatestRuleState() {
  if (ruleApplyRunning || ruleApplyRetryTimer !== null) return;
  ruleApplyRunning = true;
  try {
    while (desiredRuleState) {
      const desired = desiredRuleState;
      desiredRuleState = null;
      try {
        const counts = await applyRuleState(desired.state);
        if (desired.generation === policyGeneration) {
          appliedRuleCount = counts.dynamicRuleCount;
          appliedPremadeRuleCount = counts.premadeRuleCount;
          lastAppliedGeneration = desired.generation;
          lastApplyOk = true;
          ruleApplyRetryMs = RECONNECT_MIN_MS;
          scheduleHeartbeat(0);
        }
        // Do not log the configured domain list. It is local user data.
        console.info('[talysman] applied browser rules', counts);
      } catch (e) {
        console.error('[talysman] browser-rule update failed', e);
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
    premadeRulesApplied: appliedPremadeRuleCount,
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

/** What site content scripts and the blocked page need: resolved feature actions per enabled site. */
function sitePolicyMessage() {
  return { active: currentPolicy.active, sites: currentPolicy.sites };
}

// ---------------------------------------------------------------------------------------------
// Blocked-page unlock popup. The page asks for the URL its tab was blocked on and relays two kinds
// of service calls through the native host: popup info, and the keyless pool-unlock commands. The
// host enforces that allowlist too (natmsg_frames::relay_request).
// ---------------------------------------------------------------------------------------------

/** Last http(s) URL each tab tried to load at top level — what a blocked page was blocking. */
const attemptedUrlByTab = new Map();
const pendingServiceRequests = new Map();
let nextServiceRequestId = 1;
const SERVICE_REQUEST_TIMEOUT_MS = 8000;

function serviceRequest(method, params) {
  return new Promise((resolve) => {
    if (!port) {
      resolve({ ok: false, code: 'INTERNAL', message: 'The Talysman app isn’t connected.' });
      return;
    }
    const requestId = nextServiceRequestId++;
    const timer = setTimeout(() => {
      pendingServiceRequests.delete(requestId);
      resolve({ ok: false, code: 'INTERNAL', message: 'The Talysman app didn’t answer.' });
    }, SERVICE_REQUEST_TIMEOUT_MS);
    pendingServiceRequests.set(requestId, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    try {
      port.postMessage({ type: 'service-request', requestId, method, params });
    } catch (e) {
      pendingServiceRequests.delete(requestId);
      clearTimeout(timer);
      resolve({ ok: false, code: 'INTERNAL', message: String(e && e.message) });
    }
  });
}

function handleServiceResponse(msg) {
  const resolve = pendingServiceRequests.get(msg.requestId);
  if (!resolve) return;
  pendingServiceRequests.delete(msg.requestId);
  resolve(msg);
}

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'talysman:site-policy') {
    sendResponse(sitePolicyMessage());
    return false;
  }
  if (message?.type === 'talysman:blocked-context') {
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    const url = tabId === undefined ? null : attemptedUrlByTab.get(tabId) ?? null;
    sendResponse({ url, decision: url ? decide(currentPolicy, url) : null });
    return false;
  }
  if (message?.type === 'talysman:service') {
    void serviceRequest(message.method, message.params).then(sendResponse);
    return true;
  }
  if (!message || message.type !== 'talysman:get-status') return undefined;
  sendResponse(currentPopupStatus());
  return false;
});

function connect() {
  if (port) return;

  // Firefox for Android: the Talysman app's loopback bridge, once the user entered its code.
  const android = isAndroidBrowser() || typeof browserApi.runtime.connectNative !== 'function';
  if (android && !androidPairingCode) {
    scheduleReconnect();
    return;
  }

  console.info('[talysman] opening native port', { workerSessionId: PROFILE_ID, android });
  try {
    port = android ? loopbackPort(androidPairingCode) : browserApi.runtime.connectNative(HOST_NAME);
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
        siteCount: msg.sites ? Object.keys(msg.sites).length : 0,
        judgeActive: !!msg.judge,
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
    if (msg && msg.type === 'service-response') {
      handleServiceResponse(msg);
      return;
    }
    if (msg && msg.type === 'judge-result') {
      handleJudgeResult(upgradeLegacyJudgeResult(msg)); // LEGACY-COMPAT(v5)
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
    port.postMessage({
      type: 'hello',
      siteCapability: SITE_CAPABILITY,
      siteIds: SITE_IDS,
      ...LEGACY_HELLO_FIELDS, // LEGACY-COMPAT(v5)
    });
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
    siteCapability: SITE_CAPABILITY,
    ...LEGACY_HELLO_FIELDS, // LEGACY-COMPAT(v5)
    lockedActive: blockingActive,
    health: currentHealth(),
  };
}

function heartbeatDelay() {
  return heartbeatDelayForState({
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
// AI judge
//
// Runs only for navigations whose decision is `judge` — a judged `defaultAction` on an unlisted
// page, or a site feature the user set to "AI decides" (e.g. Reddit posts). The page loads, we
// extract its text (focused on the route's content selector when the catalog has one), and the
// daemon attaches the user's tasks and "help me avoid" list and asks the judge. A `block` verdict
// sends the tab to the blocked page with the judge's reason. Nothing here runs for policies with
// no `judge` action.
// ---------------------------------------------------------------------------------------------

const spaDebounceTimers = new Map(); // tabId -> timeoutId
const verdictCache = new Map(); // cacheKey -> { verdict, reason, expiresAt }
const pendingJudgeRequests = new Map(); // requestId -> { tabId, url, generation, judgeKey, decision, timeoutId }

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

/** Verdicts are only reusable while the tasks/avoid list that produced them are unchanged. */
function judgeKey(judge) {
  return JSON.stringify([judge.tasks.map((task) => [task.title, task.notes || '']), judge.avoid]);
}

function verdictCacheKey(url, key) {
  return JSON.stringify([url, key]);
}

function getCachedVerdict(url, key) {
  const cacheKey = verdictCacheKey(url, key);
  const entry = verdictCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    verdictCache.delete(cacheKey);
    return null;
  }
  return entry;
}

function setCachedVerdict(url, key, verdict, reason) {
  const now = Date.now();
  for (const [cacheKey, entry] of verdictCache) {
    if (entry.expiresAt <= now) verdictCache.delete(cacheKey);
  }
  while (verdictCache.size >= MAX_VERDICT_CACHE_ENTRIES) {
    const oldest = verdictCache.keys().next().value;
    if (oldest === undefined) break;
    verdictCache.delete(oldest);
  }
  const cacheKey = verdictCacheKey(url, key);
  verdictCache.delete(cacheKey);
  verdictCache.set(cacheKey, { verdict, reason, expiresAt: now + VERDICT_CACHE_TTL_MS });
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

/**
 * The local blocked page for a decision. The page renders the layer-specific explanation and the
 * site's entry points from these parameters.
 * @param {{ layer?: string, reason?: string }} block
 */
function blockedPageUrl(block) {
  const base = browserApi.runtime.getURL('blocked.html');
  const query = new URLSearchParams();
  if (block.layer) query.set('layer', block.layer);
  if (block.reason) query.set('reason', block.reason);
  return query.size ? `${base}?${query}` : base;
}

/** Redirect `tabId` to the local blocked page, but only if it's still on `expectedUrl`. */
async function redirectIfStillOnUrl(tabId, expectedUrl, block, generation = policyGeneration) {
  if (generation !== policyGeneration || !currentPolicy.active) {
    console.info('[talysman] redirect skipped: stale policy', { tabId, generation, currentGeneration: policyGeneration });
    return;
  }
  try {
    const tab = await browserApi.tabs.get(tabId);
    if (!tab || !tab.url) return;
    if (!urlsRoughlyMatch(tab.url, expectedUrl)) {
      console.info('[talysman] redirect skipped: tab navigated away', { tabId, expectedUrl, currentUrl: tab.url });
      return;
    }
    await browserApi.tabs.update(tabId, { url: blockedPageUrl(block) });
    console.info('[talysman] redirected to blocked page', { tabId, expectedUrl, layer: block.layer });
  } catch (e) {
    console.warn('[talysman] redirect failed', { tabId, expectedUrl, error: e && e.message });
  }
}

/**
 * Act on a judge rejection. A site page stays open with its judged feature hidden (site rules
 * never block a page); anything else goes to the blocked page.
 */
function rejectJudgedPage(tabId, url, decision, generation, reason) {
  if (generation !== policyGeneration || !currentPolicy.active) return;
  if (decision.layer === 'site') {
    Promise.resolve(browserApi.tabs.sendMessage(tabId, { type: 'talysman:site-judged', url, verdict: 'block' })).catch(() => {});
    console.info('[talysman][judge] hid judged site page', { tabId, url, site: decision.site, feature: decision.feature });
    return;
  }
  void redirectIfStillOnUrl(tabId, url, { layer: 'judge', reason }, generation);
}

/** Apply the judge's fallback when no verdict could be obtained (timeout, extraction failure). */
function applyJudgeFallback(tabId, url, generation, decision, judge, reason) {
  if (judge.fallback !== 'block') return; // fail-open: leave the tab alone
  rejectJudgedPage(tabId, url, decision, generation, reason);
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
  const verdict = msg.verdict === 'block' ? 'block' : 'allow';
  const reason = typeof msg.reason === 'string' ? msg.reason : '';
  console.info('[talysman][judge] verdict received', { requestId, url, verdict });

  setCachedVerdict(url, pending.judgeKey, verdict, reason);
  if (verdict === 'block') rejectJudgedPage(pending.tabId, pending.url, pending.decision, pending.generation, reason);
}

function sendJudgeRequest(tabId, url, page, decision, generation, judge) {
  while (pendingJudgeRequests.size >= MAX_PENDING_JUDGES) {
    const oldest = pendingJudgeRequests.keys().next().value;
    if (oldest === undefined) break;
    clearPendingJudgeRequest(oldest);
  }
  const requestId = generateRequestId();
  const entry = { tabId, url, generation, judgeKey: judgeKey(judge), decision, timeoutId: null };
  pendingJudgeRequests.set(requestId, entry);
  entry.timeoutId = setTimeout(() => {
    if (!pendingJudgeRequests.has(requestId)) return;
    pendingJudgeRequests.delete(requestId);
    console.warn('[talysman][judge] request timed out', { requestId });
    applyJudgeFallback(tabId, url, generation, decision, judge, "Couldn't verify in time");
  }, JUDGE_TIMEOUT_MS);

  const frame = {
    type: 'judge-request',
    requestId,
    url,
    title: page.title,
    content: page.content,
    ...(decision.site ? { context: { site: decision.site, feature: decision.feature } } : {}),
    ...legacyJudgeRequestFields(page.content), // LEGACY-COMPAT(v5)
  };
  try {
    if (port) {
      console.info('[talysman][judge] sending request', { requestId, tabId, url, contentLength: page.content.length });
      port.postMessage(frame);
    } else {
      console.warn('[talysman][judge] no native port available', { requestId });
    }
  } catch (e) {
    console.warn('[talysman][judge] request send failed', e && e.message);
  }
}

/** Extract a loaded page and ask the judge about it. `decision.action` is `judge`. */
async function judgePage(tabId, url, decision) {
  const judge = currentPolicy.judge;
  if (!judge) return;
  const generation = policyGeneration;
  const key = judgeKey(judge);

  const cached = getCachedVerdict(url, key);
  if (cached) {
    if (cached.verdict === 'block') rejectJudgedPage(tabId, url, decision, generation, cached.reason);
    return;
  }

  let extraction = null;
  try {
    const results = await browserApi.scripting.executeScript({
      target: { tabId },
      func: extractPageContent,
      args: [decision.contentSelector || null],
    });
    extraction = results && results[0] && results[0].result;
  } catch (e) {
    console.warn('[talysman][judge] content extraction failed', e && e.message);
  }

  // Content extraction is asynchronous. A focus/profile change invalidates the work.
  if (generation !== policyGeneration || !currentPolicy.active) return;
  if (!extraction) {
    applyJudgeFallback(tabId, url, generation, decision, judge, "Couldn't read the page");
    return;
  }

  const content = [extraction.description, extraction.headings, extraction.text]
    .filter(Boolean)
    .join(' — ')
    .slice(0, MAX_JUDGE_TEXT_LENGTH);
  const title = String(extraction.title || '').slice(0, MAX_JUDGE_TITLE_LENGTH);
  sendJudgeRequest(tabId, url, { title, content }, decision, generation, judge);
}

// ---------------------------------------------------------------------------------------------
// Navigation backstop
//
// DNR only sees requests that reach the network stack. A site's OWN service worker can answer a
// top-level navigation out of Cache Storage without issuing any request — Chromium runs the site's
// fetch handler before DNR, so a precached app shell (x.com/twitter is the canonical example) still
// paints even though every rule matches it and every XHR it fires is blocked. Back/forward cache
// restores and SPA route changes are the same blind spot. Firefox's request interception sits above
// the service worker, which is why the DNR redirect appeared to work there and not in Chrome.
//
// So every top-level navigation is re-decided here with the same engine the DNR rules were
// compiled from. This is also the only place `judge` decisions are enforced, since they depend on
// the page's content.
// ---------------------------------------------------------------------------------------------

/**
 * Decide a top-level navigation and act on it.
 * @param {'commit'|'complete'|'spa'} phase
 * @returns {boolean} true when the navigation was blocked (caller should stop here).
 */
function evaluateNavigation(tabId, url, phase) {
  if (!currentPolicy.active || typeof tabId !== 'number' || tabId < 0) return false;
  if (!url || !/^https?:\/\//i.test(url)) return false; // extension/browser-internal pages
  const decision = decide(currentPolicy, url);
  if (decision.action === 'block') {
    void redirectIfStillOnUrl(tabId, url, decision, policyGeneration);
    return true;
  }
  if (decision.action === 'judge') {
    if (phase === 'complete') void judgePage(tabId, url, decision);
    else if (phase === 'spa') debounceSpaJudge(tabId, url, decision);
  }
  return false;
}

function debounceSpaJudge(tabId, url, decision) {
  const existing = spaDebounceTimers.get(tabId);
  if (existing) clearTimeout(existing);
  spaDebounceTimers.set(
    tabId,
    setTimeout(() => {
      spaDebounceTimers.delete(tabId);
      void judgePage(tabId, url, decision);
    }, SPA_DEBOUNCE_MS),
  );
}

/**
 * Re-check every open tab. Catches pages already on screen when a policy starts applying, and
 * injects the site content script into tabs that predate this worker (manifest content scripts
 * only run on new page loads).
 */
async function enforcePolicyOnOpenTabs() {
  if (!currentPolicy.active) return;
  try {
    for (const tab of (await browserApi.tabs.query({})) || []) {
      if (typeof tab?.id !== 'number' || !tab.url) continue;
      // 'commit' re-checks blocks without judging: a policy push must not send every open tab
      // to the AI judge. Pages are judged as they're navigated to.
      if (evaluateNavigation(tab.id, tab.url, 'commit')) continue;
      const site = siteForUrl(tab.url);
      if (site && currentPolicy.sites[site.id]) {
        try {
          await browserApi.scripting.executeScript({ target: { tabId: tab.id }, files: ['site-content.js'] });
        } catch { /* The tab may close or navigate before injection. */ }
      }
    }
  } catch (e) {
    console.warn('[talysman] tab sweep failed', e && e.message);
  }
}

function siteForUrl(url) {
  try {
    return siteForHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

async function notifySiteContentScripts() {
  try {
    const message = { type: 'talysman:site-policy-updated', ...sitePolicyMessage() };
    for (const tab of await browserApi.tabs.query({})) {
      if (typeof tab.id === 'number' && siteForUrl(tab.url)) {
        Promise.resolve(browserApi.tabs.sendMessage(tab.id, message)).catch(() => {});
      }
    }
  } catch { /* A tab may close during the policy change. */ }
}

if (browserApi.webNavigation) {
  // Remember where each tab was headed, so its blocked page can offer to unlock exactly that.
  browserApi.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0 || !/^https?:/i.test(details.url)) return;
    attemptedUrlByTab.set(details.tabId, details.url);
  });
  if (browserApi.tabs && browserApi.tabs.onRemoved) {
    browserApi.tabs.onRemoved.addListener((tabId) => attemptedUrlByTab.delete(tabId));
  }

  // onCommitted fires before the document paints, including for service-worker-served and
  // bfcache-restored navigations that never touch the network.
  browserApi.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    evaluateNavigation(details.tabId, details.url, 'commit');
  });

  // The page is readable now; judge it if needed.
  browserApi.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    evaluateNavigation(details.tabId, details.url, 'complete');
  });

  browserApi.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    evaluateNavigation(details.tabId, details.url, 'spa');
  });
}

// Firefox for Android: the pairing code for the Talysman app, entered in the popup.
let androidPairingCode = null;
if (browserApi.storage && browserApi.storage.local) {
  browserApi.storage.local.get('androidPairingCode', (items) => {
    androidPairingCode = (items && items.androidPairingCode) || null;
    if (androidPairingCode && !port) connect();
  });
  browserApi.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.androidPairingCode) return;
    androidPairingCode = changes.androidPairingCode.newValue || null;
    if (port) port.disconnect();
    port = null;
    connect();
  });
}

// Register these listeners synchronously so Chrome wakes this worker when the profile starts or the
// extension updates. Top-level connect also covers any other event that revives the worker.
browserApi.runtime.onStartup.addListener(connect);
browserApi.runtime.onInstalled.addListener(connect);

connect();
heartbeat();
