import { universalSnapshot, universalMatchingNodes } from './universal-dom.js';

const universalApi = globalThis.chrome || globalThis.browser;
// DEBUG(universal): temporary instrumentation.
const universalDebug = (...args) => console.info('[talysman:universal]', ...args);
let universalEnabled = false;
let universalEpoch = 0;
let universalTimer = null;
let universalObserver = null;
let universalBusy = false;
let universalDirty = false;
let universalLastContent = '';
let universalUrl = location.href;
let universalRetryAt = 0;
let universalFailures = 0;
let universalLearned = [];
let universalRegionIds = [];
const universalHidden = new Map();
const universalMarker = `data-talysman-universal-${Math.random().toString(36).slice(2)}`;
let universalStyle = null;

function universalRestore() {
  for (const node of universalHidden.keys()) node.removeAttribute(universalMarker);
  universalHidden.clear();
  universalStyle?.remove();
  universalStyle = null;
}

function universalApply() {
  const wanted = new Set(universalLearned.flatMap(universalMatchingNodes));
  for (const node of universalHidden.keys()) {
    if (!wanted.has(node)) {
      node.removeAttribute(universalMarker);
      universalHidden.delete(node);
    }
  }
  if (wanted.size && !universalStyle?.isConnected) {
    universalStyle = document.createElement('style');
    universalStyle.textContent = `[${universalMarker}] { display: none !important; }`;
    (document.head || document.documentElement).appendChild(universalStyle);
  }
  for (const node of wanted) {
    if (!node.hasAttribute(universalMarker)) node.setAttribute(universalMarker, '');
    universalHidden.set(node, true);
  }
}

function universalSchedule() {
  if (!universalEnabled || universalTimer !== null) return;
  // One bounded scan after a burst; do not wait for infinite-scroll pages to become fully idle.
  universalTimer = setTimeout(() => {
    universalTimer = null;
    void universalScan();
  }, Math.max(500, universalRetryAt - Date.now()));
}

async function universalScan() {
  if (!universalEnabled || document.readyState !== 'complete') { universalDebug('scan skipped', { enabled: universalEnabled, readyState: document.readyState }); return; }
  if (location.href !== universalUrl) {
    universalUrl = location.href;
    universalEpoch++;
    universalLearned = [];
    universalLastContent = '';
    universalRestore();
    // Background rechecks precedence for every SPA route.
  }
  universalApply();
  if (universalBusy) { universalDirty = true; return; }
  if (document.visibilityState === 'hidden') { universalDebug('scan skipped: hidden'); return; }
  const snapshot = universalSnapshot(document);
  universalDebug('snapshot', { nodes: snapshot.nodes.length, chars: snapshot.content.length, same: snapshot.content === universalLastContent });
  if (snapshot.content === universalLastContent) {
    universalLearned = universalRegionIds.filter((id) => snapshot.nodes[id]).map((id) => snapshot.nodes[id]);
    universalApply();
    return;
  }
  if (snapshot.nodes.length === 0) return;
  const epoch = universalEpoch;
  const url = location.href;
  universalBusy = true;
  try {
    universalDebug('classify ->', url);
    const started = Date.now();
    const reply = await universalApi.runtime.sendMessage({ type: 'talysman:universal-classify', url, content: snapshot.content });
    universalDebug('classify <-', reply, `${Date.now() - started}ms`, { epochOk: epoch === universalEpoch, urlNow: location.href });
    if (!universalEnabled || epoch !== universalEpoch || url !== location.href) return;
    if (reply?.disabled) {
      universalSetEnabled(false);
      return;
    }
    if (!Array.isArray(reply?.regions)) throw new Error('Classification unavailable');
    if (universalSnapshot(document).content !== snapshot.content) { universalDebug('result discarded: DOM changed during classification'); universalDirty = true; return; }
    universalFailures = 0;
    universalRetryAt = 0;
    universalLastContent = snapshot.content;
    universalRegionIds = reply.regions;
    universalLearned = reply.regions.filter((id) => Number.isInteger(id) && snapshot.nodes[id]).map((id) => snapshot.nodes[id]);
    universalApply();
    universalDebug('applied', { regions: reply.regions, learned: universalLearned.length, hidden: universalHidden.size });
  } catch (error) {
    universalDebug('classify failed', String(error));
    universalFailures++;
    universalRetryAt = Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(universalFailures - 1, 5));
    universalDirty = true;
  } finally {
    universalBusy = false;
    if (universalDirty) { universalDirty = false; universalSchedule(); }
  }
}

function universalSetEnabled(enabled) {
  universalDebug('setEnabled', enabled, location.href);
  if (enabled === universalEnabled) return;
  universalEnabled = enabled;
  universalEpoch++;
  universalLastContent = '';
  universalLearned = [];
  universalRetryAt = 0;
  universalFailures = 0;
  if (!enabled) {
    clearTimeout(universalTimer);
    universalTimer = null;
    universalObserver?.disconnect();
    universalObserver = null;
    universalRestore();
    return;
  }
  universalObserver = new MutationObserver(universalSchedule);
  universalObserver.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, characterData: true,
    attributeFilter: ['class', 'id', 'role', 'aria-label', 'hidden', 'aria-hidden', 'data-testid'],
  });
  universalSchedule();
}

universalApi.runtime.onMessage.addListener((message) => {
  if (message?.type === 'talysman:universal-policy') universalSetEnabled(message.enabled === true);
  if (message?.type === 'talysman:universal-navigate') universalSchedule();
});
document.addEventListener('visibilitychange', universalSchedule);
window.addEventListener('pageshow', universalSchedule);
window.addEventListener('load', universalSchedule, { once: true });
// document_start may precede the root element.
function universalStart() {
  universalApi.runtime.sendMessage({ type: 'talysman:universal-policy' })
    .then((reply) => universalSetEnabled(reply?.enabled === true)).catch(() => {});
}
if (document.documentElement) universalStart();
else document.addEventListener('DOMContentLoaded', universalStart, { once: true });
