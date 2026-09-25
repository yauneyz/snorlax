#!/usr/bin/env node
// Regenerates the derived artifacts for the built-in "premade blocklists" feature from the
// checked-in source domain lists at native/engine/resources/premade-lists/*.txt.
//
// Normally invoked via scripts/update-blocklists.mjs (which refreshes the .txt files first).
// Can also be run standalone to just re-derive artifacts from whatever .txt files are already
// on disk, without re-fetching anything upstream.
//
// Produces:
//   - apps/extension/resources/premade-lists/premade.<part>.json (packed static DNR rulesets)
//   - apps/extension/manifest.json                             (declarative_net_request.rule_resources)
//   - apps/extension/src/premade-rulesets.js                   (list id -> static rule ids)
//   - packages/shared/src/premadeLists.ts                      (id/label/description/domainCount)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CATEGORIES } from './blocklists/sources.mjs';
import { toRegistrableDomain } from './blocklists/normalize.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LISTS = CATEGORIES.map(({ id, label, description, exemptDomains = [] }) => ({
  id,
  label,
  description,
  exemptDomains,
}));

const SRC_DIR = path.join(repoRoot, 'native/engine/resources/premade-lists');
const EXT_OUT_DIR = path.join(repoRoot, 'apps/extension/resources/premade-lists');
const SHARED_OUT = path.join(repoRoot, 'packages/shared/src/premadeLists.ts');
const MANIFEST_OUT = path.join(repoRoot, 'apps/extension/manifest.json');
const RULESETS_JS_OUT = path.join(repoRoot, 'apps/extension/src/premade-rulesets.js');
const RUST_IDS_OUT = path.join(repoRoot, 'native/engine/src/premade_list_ids.rs');

const CHUNK_SIZE = 1000;
const BLOCK_PRIORITY = 1;

// AMO analyzes every non-binary file and rejects files at 5MB. Pack category rule pairs into a
// small number of shared containers below that ceiling. Individual rules are toggled at runtime,
// which lets arbitrary category mixtures use a fixed number of enabled static rulesets.
const MAX_RULESET_BYTES = 4_500_000;
const MAX_STATIC_RULESETS = 50;
const MAX_ENABLED_STATIC_RULESETS = 10;

function loadDomains(id) {
  const raw = readFileSync(path.join(SRC_DIR, `${id}.txt`), 'utf8');
  const domains = raw
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (new Set(domains).size !== domains.length) throw new Error(`${id}.txt contains duplicates`);
  if (domains.some((domain, index) => index > 0 && domains[index - 1] > domain)) {
    throw new Error(`${id}.txt must be sorted`);
  }
  for (const domain of domains) {
    if (toRegistrableDomain(domain) !== domain) {
      throw new Error(`${id}.txt contains a non-canonical or shared-hosting domain: ${domain}`);
    }
  }
  return domains;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Build a static DNR ruleset for one premade list. Two rules per chunk: a block rule (all
 * resource types) and a main_frame redirect rule to the local blocked page, carrying a
 * list-specific `reason` so the page can say *which* built-in list caused the block — mirrors
 * `blockedPageUrl(reason)` in apps/extension/src/background.js.
 */
function buildRulePairs(list, domains) {
  const reason = `Blocked by the built-in "${list.label}" list`;
  const redirectPath = `/blocked.html?reason=${encodeURIComponent(reason)}`;
  const chunks = chunk(domains, CHUNK_SIZE);
  const pairs = [];
  const excludedRequestDomains = list.exemptDomains ?? [];
  for (const requestDomains of chunks) {
    // DNR already matches sub-domains of every `requestDomains` entry, so the apex alone covers
    // `www.` and everything else under it. (Listing the `www.` variant explicitly, as this
    // generator used to, doubled the emitted bytes for exactly zero extra coverage.)
    // Omitting `resourceTypes` matches every type EXCEPT main_frame (same trick buildRules() uses
    // in apps/extension/src/rules.js). Listing main_frame here instead would tie with the redirect
    // rule below at equal priority, and DNR breaks same-priority ties by action type -- block wins
    // over redirect -- so every top-level navigation got a generic browser error page instead of
    // blocked.html.
    const commonCondition = {
      requestDomains,
      ...(excludedRequestDomains.length > 0 ? { excludedRequestDomains } : {}),
    };
    const block = {
      priority: BLOCK_PRIORITY,
      action: { type: 'block' },
      condition: commonCondition,
    };
    const redirect = {
      priority: BLOCK_PRIORITY,
      action: { type: 'redirect', redirect: { extensionPath: redirectPath } },
      condition: { ...commonCondition, resourceTypes: ['main_frame'] },
    };
    pairs.push({ listId: list.id, rules: [block, redirect] });
  }
  return pairs;
}

/**
 * Pack rule pairs from every category into the fewest serialized JSON documents that fit. IDs are
 * local to a ruleset and pairs stay together. Byte counts use the actual UTF-8 serialization.
 */
function packRulePairs(pairs) {
  const parts = [];
  let current = { rules: [], listRuleIds: {}, bytes: 2 };

  const addPair = (pair) => {
    const firstId = current.rules.length + 1;
    const rules = pair.rules.map((rule, index) => ({ id: firstId + index, ...rule }));
    const serialized = rules.map((rule) => JSON.stringify(rule));
    const addedBytes = Buffer.byteLength(serialized.join(',')) + (current.rules.length > 0 ? 1 : 0);
    if (current.rules.length > 0 && current.bytes + addedBytes > MAX_RULESET_BYTES) return false;
    if (current.rules.length === 0 && current.bytes + addedBytes > MAX_RULESET_BYTES) {
      throw new Error(`${pair.listId}: one DNR rule pair exceeds ${MAX_RULESET_BYTES} bytes`);
    }
    current.rules.push(...rules);
    current.bytes += addedBytes;
    (current.listRuleIds[pair.listId] ??= []).push(...rules.map((rule) => rule.id));
    return true;
  };

  for (const pair of pairs) {
    if (!addPair(pair)) {
      parts.push(current);
      current = { rules: [], listRuleIds: {}, bytes: 2 };
      addPair(pair);
    }
  }
  if (current.rules.length > 0) parts.push(current);
  return parts;
}

mkdirSync(EXT_OUT_DIR, { recursive: true });
// Part counts shift as upstream lists grow and shrink. Only remove generated rulesets so a future
// hand-maintained resource in this directory cannot be erased accidentally.
for (const file of readdirSync(EXT_OUT_DIR)) {
  if (/^(?:premade|[a-z0-9-]+)\.\d+\.json$/.test(file)) rmSync(path.join(EXT_OUT_DIR, file));
}

const meta = [];
const allPairs = [];
const domainCounts = new Map();
for (const list of LISTS) {
  const domains = loadDomains(list.id);
  domainCounts.set(list.id, domains.length);
  allPairs.push(...buildRulePairs(list, domains));
  meta.push({ id: list.id, label: list.label, description: list.description, domainCount: domains.length });
}

const parts = packRulePairs(allPairs);
if (parts.length > MAX_STATIC_RULESETS || parts.length > MAX_ENABLED_STATIC_RULESETS) {
  throw new Error(
    `generated ${parts.length} rulesets; limits are ${MAX_STATIC_RULESETS} declared and ` +
      `${MAX_ENABLED_STATIC_RULESETS} enabled`,
  );
}

const ruleResources = [];
const rulesets = {};
const ruleIdsByList = Object.fromEntries(LISTS.map((list) => [list.id, {}]));
parts.forEach((part, index) => {
    const fileName = `premade.${index + 1}.json`;
    const rulesetId = `premade-${index + 1}`;
    const serialized = JSON.stringify(part.rules);
    const bytes = Buffer.byteLength(serialized);
    if (bytes > MAX_RULESET_BYTES) throw new Error(`${fileName} is ${bytes} bytes`);
    writeFileSync(path.join(EXT_OUT_DIR, fileName), serialized);
    ruleResources.push({ id: rulesetId, enabled: false, path: `premade-lists/${fileName}` });
    rulesets[rulesetId] = part.rules.map((rule) => rule.id);
    for (const [listId, ruleIds] of Object.entries(part.listRuleIds)) {
      ruleIdsByList[listId][rulesetId] = ruleIds;
    }
    console.log(`${fileName}: ${part.rules.length} rules, ${bytes} bytes`);
});

for (const list of LISTS) {
  console.log(
    `${list.id}: ${domainCounts.get(list.id)} domains, ` +
      `${Object.values(ruleIdsByList[list.id]).flat().length} DNR rules`,
  );
}

const manifest = JSON.parse(readFileSync(MANIFEST_OUT, 'utf8'));
manifest.declarative_net_request = { rule_resources: ruleResources };
writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${MANIFEST_OUT} (${ruleResources.length} static rulesets)`);

writeFileSync(
  RULESETS_JS_OUT,
  [
    '// Generated by scripts/generate-premade-lists.mjs — do not edit by hand.',
    '//',
    '// Rules from every category are packed into shared files below AMO\'s 5MB parser limit.',
    '// The worker keeps those few containers enabled and toggles their individual rule ids.',
    '',
    'export const PREMADE_RULESETS = ' + JSON.stringify({ rulesets, ruleIdsByList }, null, 2) + ';',
    '',
  ].join('\n'),
);
console.log(`wrote ${RULESETS_JS_OUT}`);

const idUnion = LISTS.map((l) => `'${l.id}'`).join(' | ');
const tsLines = [
  '// Generated by scripts/generate-premade-lists.mjs — do not edit by hand.',
  '',
  `export type PremadeListId = ${idUnion};`,
  '',
  'export interface PremadeListMeta {',
  '  id: PremadeListId;',
  '  label: string;',
  '  description: string;',
  '  domainCount: number;',
  '}',
  '',
  'export const PREMADE_LISTS: PremadeListMeta[] = ' + JSON.stringify(meta, null, 2) + ';',
  '',
];
writeFileSync(SHARED_OUT, tsLines.join('\n'));
console.log(`wrote ${SHARED_OUT}`);

function rustVariant(id) {
  return id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
}

const rustVariants = LISTS.map((list) => rustVariant(list.id));
if (new Set(rustVariants).size !== rustVariants.length) {
  throw new Error('blocklist ids produce duplicate Rust enum variants');
}

const rustLines = [
  '// Generated by scripts/generate-premade-lists.mjs — do not edit by hand.',
  '',
  '#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq, Hash)]',
  '#[cfg_attr(feature = "ts", derive(ts_rs::TS))]',
  'pub enum PremadeListId {',
  ...LISTS.flatMap((list) => [`    #[serde(rename = "${list.id}")]`, `    ${rustVariant(list.id)},`]),
  '}',
  '',
  `pub(crate) const PREMADE_LIST_COUNT: usize = ${LISTS.length};`,
  '',
  'impl PremadeListId {',
  '    pub(crate) const fn as_index(self) -> usize {',
  '        match self {',
  ...LISTS.map((list, index) => `            Self::${rustVariant(list.id)} => ${index},`),
  '        }',
  '    }',
  '}',
  '',
  '/// Builds without the `premade` feature (Android without the VPN sinkhole) embed no lists.',
  '#[cfg(not(feature = "premade"))]',
  'pub(crate) fn premade_list_source(_id: PremadeListId) -> &\'static str {',
  '    ""',
  '}',
  '',
  '#[cfg(feature = "premade")]',
  'pub(crate) fn premade_list_source(id: PremadeListId) -> &\'static str {',
  '    match id {',
  ...LISTS.map(
    (list) =>
      `        PremadeListId::${rustVariant(list.id)} => include_str!("../resources/premade-lists/${list.id}.txt"),`,
  ),
  '    }',
  '}',
  '',
  'pub(crate) fn premade_list_exemptions(id: PremadeListId) -> &\'static [&\'static str] {',
  '    match id {',
  ...LISTS.map(
    (list) =>
      `        PremadeListId::${rustVariant(list.id)} => &[${(list.exemptDomains ?? []).map((domain) => `"${domain}"`).join(', ')}],`,
  ),
  '    }',
  '}',
  '',
];
writeFileSync(RUST_IDS_OUT, rustLines.join('\n'));
console.log(`wrote ${RUST_IDS_OUT}`);
