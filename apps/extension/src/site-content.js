// Content script for every catalog site (see manifest content_scripts, generated from the
// catalog). The background owns policy; this script applies the site rules inside the page.
// Site rules never block a page — they hide things on it:
//   - the elements of blocked features (the catalog's `elements`), wherever they appear, and
//   - on a page the AI judge rejected, the elements of that page's own (judged) feature.
// Media inside a hidden element is paused, so a hidden video can't keep playing.
// It contains no per-site code. The build bundles it with site-catalog.js and site-engine.js and
// wraps the bundle so a second injection into the same page is a no-op.

import { SITE_CATALOG } from './site-catalog.js';
import { classifyUrl, siteForHostname } from './site-engine.js';

const contentApi = globalThis.chrome || globalThis.browser;
const contentSite = siteForHostname(location.hostname);
let siteRule = null; // { features } while this site has rules
let judgedBlockedUrl = null; // the page the AI judge rejected, while the tab is still on it
let hiddenSelector = ''; // every selector the stylesheet currently hides, for pausing media
let siteObserver = null;
let siteStyle = null;
let syncQueued = false;

function scopedSelectors(element, scopes) {
  return scopes.map((scope) => `${scope}:is(${element.selector})`);
}

/**
 * Every selector to hide under `features`: blocked features everywhere they're scoped to, and
 * judged features on their own pages once the judge has rejected the page.
 */
function hiddenSelectors(features) {
  const out = [];
  const pageScope = (feature, extra = '') => `:root[data-talysman-feature="${feature}"]${extra} `;
  for (const element of SITE_CATALOG[contentSite.id].elements) {
    const action = features[element.feature];
    if (action === 'block') {
      out.push(...scopedSelectors(element, element.on ? element.on.map((feature) => pageScope(feature)) : ['']));
    } else if (action === 'judge' && (!element.on || element.on.includes(element.feature))) {
      out.push(...scopedSelectors(element, [pageScope(element.feature, '[data-talysman-judged="block"]')]));
    }
  }
  return out;
}

function pageKey(href) {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

function pauseHiddenMedia(root = document) {
  if (!hiddenSelector) return;
  for (const media of root.querySelectorAll('video, audio')) {
    if (!media.paused && media.closest(hiddenSelector)) media.pause();
  }
}

/** Track the current route (SPA navigations change it without a reload) and the judge verdict. */
function sync() {
  syncQueued = false;
  if (!siteRule) return;
  const root = document.documentElement;
  const current = classifyUrl(location.href);
  const feature = current ? current.feature : '';
  if (root.getAttribute('data-talysman-feature') !== feature) root.setAttribute('data-talysman-feature', feature);
  if (judgedBlockedUrl && judgedBlockedUrl === pageKey(location.href)) root.setAttribute('data-talysman-judged', 'block');
  else {
    judgedBlockedUrl = null;
    root.removeAttribute('data-talysman-judged');
  }
  pauseHiddenMedia();
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(sync, 40);
}

function teardown() {
  siteObserver?.disconnect();
  siteObserver = null;
  siteStyle?.remove();
  siteStyle = null;
  hiddenSelector = '';
  judgedBlockedUrl = null;
  document.documentElement.removeAttribute('data-talysman-feature');
  document.documentElement.removeAttribute('data-talysman-judged');
}

/** @param {{ active?: boolean, sites?: Record<string, { features: Record<string, string> }> }} policy */
function applySitePolicy(policy) {
  const rule = policy && policy.active && policy.sites ? policy.sites[contentSite.id] : null;
  if (!rule) {
    siteRule = null;
    teardown();
    return;
  }
  siteRule = rule;
  const selectors = hiddenSelectors(rule.features);
  hiddenSelector = selectors.join(', ');
  if (!siteStyle) {
    siteStyle = document.createElement('style');
    (document.head || document.documentElement).appendChild(siteStyle);
  }
  siteStyle.textContent = selectors.map((selector) => `${selector} { display: none !important; }`).join('\n');
  if (!siteObserver) {
    siteObserver = new MutationObserver(queueSync);
    siteObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  sync();
}

if (contentSite) {
  // Media that starts after the page settles (autoplay, a click the page proxies) is caught here.
  document.addEventListener('play', (event) => {
    const media = event.target;
    if (hiddenSelector && media instanceof HTMLMediaElement && media.closest(hiddenSelector)) media.pause();
  }, true);

  contentApi.runtime.onMessage.addListener((message) => {
    if (message?.type === 'talysman:site-policy-updated') applySitePolicy(message);
    if (message?.type === 'talysman:site-judged' && typeof message.url === 'string') {
      judgedBlockedUrl = message.verdict === 'block' ? pageKey(message.url) : null;
      sync();
    }
  });
  contentApi.runtime.sendMessage({ type: 'talysman:site-policy' }, (policy) => {
    if (contentApi.runtime.lastError) return;
    applySitePolicy(policy);
  });
}
