// LEGACY-COMPAT(v5): talk to native hosts that predate site rules and the unified judge.
//
// A v4 native host (released before protocol 5) sends `softBlockedSites` + `intent`, expects
// `softBlockCapability` in hello/heartbeat frames, reads `extractedText` from judge requests, and
// answers with `judge-result { relevant }`. Everything needed to keep working with one lives in
// this file. To drop support: delete this file, its entry in scripts/build-extension.mjs, and the
// one-line call sites tagged LEGACY-COMPAT(v5) in background.js.

import { SITE_CATALOG } from './site-catalog.js';

/** Sent alongside `siteCapability` so v4 hosts count this extension as soft-block capable. */
export const LEGACY_HELLO_FIELDS = { softBlockCapability: 1 };

/** A v4 state frame has no `sites` key. Upgrade it to the current shape; pass others through. */
export function upgradeLegacyStateFrame(frame) {
  if (!frame || typeof frame !== 'object' || 'sites' in frame) return frame;
  const sites = {};
  for (const id of Array.isArray(frame.softBlockedSites) ? frame.softBlockedSites : []) {
    if (SITE_CATALOG[id]) sites[id] = { features: {} };
  }
  const upgraded = { ...frame, sites, judge: null };
  const positive = frame.intent && typeof frame.intent.positive === 'string' ? frame.intent.positive.trim() : '';
  if (positive) {
    upgraded.judge = {
      tasks: [{ id: 'task-1', title: positive }],
      avoid: frame.intent.negative ? [String(frame.intent.negative)] : [],
      fallback: frame.defaultAction === 'block' ? 'block' : 'allow',
    };
    upgraded.defaultAction = 'judge';
  }
  delete upgraded.softBlockedSites;
  delete upgraded.intent;
  return upgraded;
}

// v4 daemons reject `extractedText` longer than 4000 *bytes*.
const LEGACY_MAX_EXTRACTED_TEXT_BYTES = 4000;

/** v4 hosts read the page text from `extractedText`, capped in UTF-8 bytes. */
export function legacyJudgeRequestFields(content) {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length <= LEGACY_MAX_EXTRACTED_TEXT_BYTES) return { extractedText: content };
  // Decoding a cut mid-character yields a trailing U+FFFD; drop it.
  const cut = new TextDecoder().decode(bytes.slice(0, LEGACY_MAX_EXTRACTED_TEXT_BYTES)).replace(/\uFFFD$/, '');
  return { extractedText: cut };
}

/** v4 hosts answer `{ relevant }` instead of `{ verdict }`. */
export function upgradeLegacyJudgeResult(msg) {
  if (!msg || typeof msg.verdict === 'string' || typeof msg.relevant !== 'boolean') return msg;
  return { ...msg, verdict: msg.relevant ? 'allow' : 'block' };
}
