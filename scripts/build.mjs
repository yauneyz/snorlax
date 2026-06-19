#!/usr/bin/env node
/**
 * Full build orchestration (architecture §13):
 *   1. build native service (Rust) → stage binaries
 *   2. electron-vite build (main + preload + renderer)
 *   3. electron-builder (platform installer that registers/starts the service)
 *
 * Usage: node scripts/build.mjs --target win|linux|mac
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const targetIdx = args.indexOf('--target');
const target = targetIdx !== -1 ? args[targetIdx + 1] : 'win';

const TARGETS = {
  win: { hostPlatform: 'win32', builderFlag: '--win', nativeTarget: 'win' },
  linux: { hostPlatform: 'linux', builderFlag: '--linux', nativeTarget: 'linux' },
  mac: { hostPlatform: 'darwin', builderFlag: '--mac', nativeTarget: 'mac' },
};

function run(cmd, cmdArgs, cwd = root) {
  console.log(`\n› ${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function desktopElectronVersion() {
  const pkg = resolve(root, 'apps/desktop/node_modules/electron/package.json');
  return JSON.parse(readFileSync(pkg, 'utf8')).version;
}

const cfg = TARGETS[target];
if (!cfg) {
  console.error(`Unsupported build target "${target}". Expected one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

if (process.platform !== cfg.hostPlatform) {
  console.error(
    `build --target ${target} must run on ${cfg.hostPlatform} (current host is ${process.platform}).`,
  );
  process.exit(1);
}

// 1. Native service.
run('node', ['scripts/build-native.mjs', '--target', cfg.nativeTarget]);

// 1b. Browser extension (unpacked builds per engine, staged into resources).
run('node', ['scripts/build-extension.mjs']);

// 2. Electron bundles.
run('pnpm', ['--filter', '@focuslock/desktop', 'build']);

// 3. Package + NSIS installer.
run('pnpm', [
  'exec',
  'electron-builder',
  cfg.builderFlag,
  '--config',
  'electron-builder.yml',
  `--config.electronVersion=${desktopElectronVersion()}`,
]);

console.log('\nOK Build complete. Installer is in dist/.');
