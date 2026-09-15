#!/usr/bin/env node
// Refreshes all premade-blocklist category source files end-to-end: fetches every upstream
// source declared in scripts/blocklists/sources.mjs, parses it, normalizes it to registrable
// domains (with the curated overrides layer applied), merges multi-source categories, and
// writes native/common/resources/premade-lists/<id>.txt — then regenerates the derived
// extension DNR rulesets and packages/shared metadata via generate-premade-lists.mjs.
//
// Usage: pnpm run update:blocklists [category-id ...]   (no args = all categories)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { CATEGORIES } from './blocklists/sources.mjs';
import { parseSource } from './blocklists/parse.mjs';
import { normalizeCategory, loadOverrides } from './blocklists/normalize.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(repoRoot, 'native/common/resources/premade-lists');
const OVERRIDES_DIR = path.join(SRC_DIR, 'overrides');

const requested = process.argv.slice(2);
const categories = requested.length
  ? CATEGORIES.filter((c) => requested.includes(c.id))
  : CATEGORIES;

for (const category of categories) {
  console.log(`[${category.id}] fetching ${category.sources.length} source(s)...`);
  const rawHostnameLists = category.sources.map((source) => {
    const hostnames = parseSource(source);
    console.log(`[${category.id}]   ${source.url ?? source.metaUrl} -> ${hostnames.length} raw hosts`);
    return hostnames;
  });

  const overrides = loadOverrides(path.join(OVERRIDES_DIR, `${category.id}.json`));
  const domains = normalizeCategory(rawHostnameLists, overrides);

  const outPath = path.join(SRC_DIR, `${category.id}.txt`);
  writeFileSync(outPath, domains.join('\n') + '\n');
  console.log(`[${category.id}] wrote ${domains.length} registrable domains -> ${outPath}`);
}

console.log('\nRegenerating derived artifacts (extension DNR rulesets, shared metadata)...');
execFileSync('node', [path.join(repoRoot, 'scripts/generate-premade-lists.mjs')], {
  stdio: 'inherit',
});
