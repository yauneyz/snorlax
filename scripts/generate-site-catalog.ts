#!/usr/bin/env tsx
// Regenerates the site-catalog artifacts from packages/shared/src/sites:
//   - apps/extension/src/site-catalog.js          (runtime catalog for the engine and blocked page)
//   - native/engine/resources/site-catalog.json   (daemon subset: hosts, network domains, features)
//   - apps/extension/manifest.json                (content_scripts matches)
// Run with `pnpm generate:sites` after editing a site module.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extensionCatalogModule,
  manifestWithContentScripts,
  nativeCatalogJson,
  validateCatalog,
} from './lib/site-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

validateCatalog();

const outputs: [string, string][] = [
  ['apps/extension/src/site-catalog.js', extensionCatalogModule()],
  ['native/engine/resources/site-catalog.json', nativeCatalogJson()],
];
const manifestPath = path.join(root, 'apps/extension/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
outputs.push(['apps/extension/manifest.json', JSON.stringify(manifestWithContentScripts(manifest), null, 2) + '\n']);

for (const [file, contents] of outputs) {
  writeFileSync(path.join(root, file), contents);
  console.log(`wrote ${file}`);
}
