#!/usr/bin/env node
/**
 * Full build orchestration (architecture §13):
 *   1. build native service (Rust) → stage binaries
 *   2. electron-vite build (main + preload + renderer)
 *   3. electron-builder (NSIS installer that registers/starts the service)
 *
 * Usage: node scripts/build.mjs --target win
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const targetIdx = args.indexOf('--target');
const target = targetIdx !== -1 ? args[targetIdx + 1] : 'win';

function run(cmd, cmdArgs, cwd = root) {
  console.log(`\n› ${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function desktopElectronVersion() {
  const pkg = resolve(root, 'apps/desktop/node_modules/electron/package.json');
  return JSON.parse(readFileSync(pkg, 'utf8')).version;
}

if (target !== 'win') {
  console.error(`Only --target win is supported in this build (got "${target}"). macOS is a later phase.`);
  process.exit(1);
}

// 1. Native service.
run('node', ['scripts/build-native-win.mjs']);

// 2. Electron bundles.
run('pnpm', ['--filter', '@focuslock/desktop', 'build']);

// 3. Package + NSIS installer.
run('pnpm', [
  'exec',
  'electron-builder',
  '--win',
  '--config',
  'electron-builder.yml',
  `--config.electronVersion=${desktopElectronVersion()}`,
]);

console.log('\n✓ Build complete. Installer is in dist/.');
