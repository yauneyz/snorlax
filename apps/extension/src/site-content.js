// Content script for every catalog site (see manifest content_scripts, generated from the
// catalog). The background owns policy; this script applies the site rules inside the page:
//   - hides the elements of blocked features (the catalog's `elements`),
//   - hides links whose navigation would be blocked, and
//   - stops in-page (SPA) navigation to them before the site can swap content in.
// It contains no per-site code. The build bundles it with site-catalog.js and site-engine.js and
// wraps the bundle so a second injection into the same page is a no-op.

import { SITE_CATALOG } from './site-catalog.js';
import { classifyUrl, siteDecision, siteForHostname } from './site-engine.js';

const contentApi = globalThis.chrome || globalThis.browser;
const contentSite = siteForHostname(location.hostname);
let siteState = null; // { active: true, sites: { [id]: { features } } } while this site has rules
let siteObserver = null;
let siteStyle = null;
let cleanQueued = false;

/** One stylesheet hiding every element whose feature is blocked, scoped to its route features. */
function stylesheetFor(features) {
  const rules = ['[data-talysman-site-hidden] { display: none !important; }'];
  for (const element of SITE_CATALOG[contentSite.id].elements) {
    if (features[element.feature] !== 'block') continue;
    const scopes = element.on ? element.on.map((feature) => `:root[data-talysman-feature="${feature}"] `) : [''];
    for (const scope of scopes) rules.push(`${scope}:is(${element.selector}) { display: none !important; }`);
  }
  return rules.join('\n');
}

function navigationBlocked(href) {
  if (!siteState) return false;
  const decision = siteDecision(siteState, href, location.href);
  return !!decision && decision.action === 'block';
}

function clean() {
  cleanQueued = false;
  if (!siteState) return;
  const current = classifyUrl(location.href);
  document.documentElement.setAttribute('data-talysman-feature', current ? current.feature : '');
  for (const anchor of document.querySelectorAll('a[href]')) {
    if (anchor.dataset.talysmanSiteChecked === anchor.href) continue;
    anchor.dataset.talysmanSiteChecked = anchor.href;
    if (navigationBlocked(anchor.href)) anchor.setAttribute('data-talysman-site-hidden', '');
    else anchor.removeAttribute('data-talysman-site-hidden');
  }
}

function queueClean() {
  if (cleanQueued) return;
  cleanQueued = true;
  setTimeout(clean, 40);
}

function teardown() {
  siteObserver?.disconnect();
  siteObserver = null;
  siteStyle?.remove();
  siteStyle = null;
  document.documentElement.removeAttribute('data-talysman-feature');
  document.querySelectorAll('[data-talysman-site-checked]').forEach((anchor) => {
    anchor.removeAttribute('data-talysman-site-hidden');
    anchor.removeAttribute('data-talysman-site-checked');
  });
}

/** @param {{ active?: boolean, sites?: Record<string, { features: Record<string, string> }> }} policy */
function applySitePolicy(policy) {
  const rule = policy && policy.active && policy.sites ? policy.sites[contentSite.id] : null;
  if (!rule) {
    siteState = null;
    teardown();
    return;
  }
  siteState = { active: true, sites: { [contentSite.id]: rule } };
  if (!siteStyle) {
    siteStyle = document.createElement('style');
    (document.head || document.documentElement).appendChild(siteStyle);
  }
  siteStyle.textContent = stylesheetFor(rule.features);
  // Links are re-evaluated against the new rules.
  document.querySelectorAll('[data-talysman-site-checked]').forEach((anchor) => anchor.removeAttribute('data-talysman-site-checked'));
  if (!siteObserver) {
    siteObserver = new MutationObserver(queueClean);
    siteObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }
  queueClean();
}

if (contentSite) {
  document.addEventListener('click', (event) => {
    if (!siteState) return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || !navigationBlocked(anchor.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    contentApi.runtime.sendMessage({ type: 'talysman:site-denied', url: anchor.href });
  }, true);

  contentApi.runtime.onMessage.addListener((message) => {
    if (message?.type === 'talysman:site-policy-updated') applySitePolicy(message);
  });
  contentApi.runtime.sendMessage({ type: 'talysman:site-policy' }, (policy) => {
    if (contentApi.runtime.lastError) return;
    applySitePolicy(policy);
  });
}
