#!/usr/bin/env node
/**
 * Enforces packages/shared/src/palette.json as the only editable UI color source.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { PALETTE_PATH, REPO_ROOT, readPalette } from './lib/palette.mjs';

const SOURCE_ROOTS = [
  'apps/desktop/src',
  'apps/web/src',
  'apps/extension/src',
  'apps/android/app/src',
  'packages',
  'native',
  'scripts',
  'tests',
  'assets/brand/scripts',
].map((path) => resolve(REPO_ROOT, path));
const SOURCE_FILES = [resolve(REPO_ROOT, 'apps/desktop/tailwind.config.js')];
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.kt',
  '.kts',
  '.mjs',
  '.rs',
  '.svg',
  '.ts',
  '.tsx',
  '.xml',
]);
const EXCLUDED = new Set([
  PALETTE_PATH,
  resolve(REPO_ROOT, 'scripts/check-palette.mjs'),
  resolve(REPO_ROOT, 'scripts/lib/palette.mjs'),
  // Standalone vectors are derived artifacts regenerated from the canonical palette.
  resolve(REPO_ROOT, 'apps/web/src/app/icon.svg'),
]);

function filesUnder(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (['build', 'dist', 'generated', 'node_modules', 'out', 'target'].includes(name)) continue;
    const path = resolve(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else if (TEXT_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

readPalette();

const files = [...new Set([...SOURCE_ROOTS.flatMap(filesUnder), ...SOURCE_FILES])]
  .filter((path) => !EXCLUDED.has(path));

const literalPattern =
  /#[0-9a-f]{3,8}\b|rgba?\(\s*\d+\s*[, ]\s*\d+\s*[, ]\s*\d+|Color\(0x[0-9a-f]+\)/gi;
const failures = [];
for (const path of files) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const matches = line.match(literalPattern);
    if (matches) failures.push(`${relative(REPO_ROOT, path)}:${index + 1}: ${matches.join(', ')}`);
  });
}

if (failures.length > 0) {
  console.error('Hardcoded UI colors must come from packages/shared/src/palette.json:');
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`palette check passed (${files.length} source files)`);
}
