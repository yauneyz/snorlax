#!/usr/bin/env node
// Refreshes all premade-blocklist category source files end-to-end: fetches every upstream
// source declared in scripts/blocklists/sources.mjs, parses it, normalizes it to registrable
// domains (with the curated overrides layer applied), merges multi-source categories, and
// writes native/engine/resources/premade-lists/<id>.txt — then regenerates the derived
// extension DNR rulesets and packages/shared metadata via generate-premade-lists.mjs.
//
// Usage: pnpm run update:blocklists [category-id ...]   (no args = all categories)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  BLOCKLIST_SCHEMA_VERSION,
  CATEGORIES,
  PARSER_VERSION,
  SOURCES,
} from './blocklists/sources.mjs';
import { parseSource } from './blocklists/parse.mjs';
import { composeCategory, normalizeCategory, loadOverrides } from './blocklists/normalize.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(repoRoot, 'native/engine/resources/premade-lists');
const OVERRIDES_DIR = path.join(SRC_DIR, 'overrides');
const PROVENANCE_PATH = path.join(SRC_DIR, 'provenance.json');

const requested = process.argv.slice(2);
const categories = requested.length
  ? CATEGORIES.filter((c) => requested.includes(c.id))
  : CATEGORIES;
const unknown = requested.filter((id) => !CATEGORIES.some((category) => category.id === id));
if (unknown.length > 0) throw new Error(`unknown blocklist categories: ${unknown.join(', ')}`);

const previousProvenance = existsSync(PROVENANCE_PATH)
  ? JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8'))
  : { categories: {} };
const provenance = {
  schemaVersion: BLOCKLIST_SCHEMA_VERSION,
  parserVersion: PARSER_VERSION,
  generatedAt: new Date().toISOString(),
  categories: { ...(previousProvenance.categories ?? {}) },
};
const parsedSources = new Map();
const outputs = [];

for (const category of categories) {
  console.log(`[${category.id}] fetching ${category.sources.length} source(s)...`);
  const sourceRecords = category.sources.map(({ source: sourceId, operation }) => {
    const source = SOURCES[sourceId];
    if (!source) throw new Error(`[${category.id}] unknown source: ${sourceId}`);
    let parsed = parsedSources.get(sourceId);
    if (!parsed) {
      const hostnames = parseSource(source);
      const domains = normalizeCategory([hostnames], { include: [], exclude: [] });
      parsed = {
        domains,
        rawHostCount: hostnames.length,
        normalizedSha256: createHash('sha256').update(domains.join('\n')).digest('hex'),
      };
      parsedSources.set(sourceId, parsed);
    }
    console.log(
      `[${category.id}]   ${source.id} -> ${parsed.rawHostCount} raw hosts, ${parsed.domains.length} domains`,
    );
    return {
      operation,
      domains: parsed.domains,
      provenance: {
        id: source.id,
        kind: source.kind,
        location: source.url ?? source.metaUrl,
        operation,
        rawHostCount: parsed.rawHostCount,
        domainCount: parsed.domains.length,
        normalizedSha256: parsed.normalizedSha256,
      },
    };
  });

  const overrides = loadOverrides(path.join(OVERRIDES_DIR, `${category.id}.json`));
  const domains = composeCategory(sourceRecords, overrides);

  const outPath = path.join(SRC_DIR, `${category.id}.txt`);
  outputs.push({ outPath, contents: domains.join('\n') + '\n' });
  console.log(`[${category.id}] prepared ${domains.length} registrable domains`);
  provenance.categories[category.id] = {
    domainCount: domains.length,
    sha256: createHash('sha256').update(domains.join('\n')).digest('hex'),
    sources: sourceRecords.map((record) => record.provenance),
  };
}

// Do not leave a half-refreshed repository when a later source download or parser fails.
for (const output of outputs) writeFileSync(output.outPath, output.contents);
writeFileSync(PROVENANCE_PATH, JSON.stringify(provenance, null, 2) + '\n');

console.log('\nRegenerating derived artifacts (extension DNR rulesets, shared metadata)...');
execFileSync('node', [path.join(repoRoot, 'scripts/generate-premade-lists.mjs')], {
  stdio: 'inherit',
});
