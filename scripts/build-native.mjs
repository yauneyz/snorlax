#!/usr/bin/env node
/**
 * Build and stage the native backend for one desktop platform.
 *
 * Every target stages its artifacts twice:
 *   - resources/bin/<target>/ for inspection/debugging
 *   - resources/bin/current/ for electron-builder packaging
 *
 * Electron Builder stays target-agnostic and always embeds resources/bin/current.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const targetIdx = args.indexOf('--target');
const target = targetIdx !== -1 ? args[targetIdx + 1] : platformTarget(process.platform);

const TARGETS = {
  win: {
    hostPlatform: 'win32',
    crate: 'native/windows',
    outName: 'win',
    cargoEnv(crate) {
      return { ...process.env, WINDIVERT_PATH: resolve(crate, 'vendor/windivert') };
    },
    artifacts: [
      'talysman-svc.exe',
      'talysman-svcctl.exe',
      'talysman-recover.exe',
      'talysman-natmsg.exe',
    ],
    extraFiles(crate) {
      return [
        resolve(crate, 'vendor/windivert/WinDivert.dll'),
        resolve(crate, 'vendor/windivert/WinDivert64.sys'),
      ];
    },
  },
  linux: {
    hostPlatform: 'linux',
    crate: 'native/linux',
    outName: 'linux',
    cargoEnv() {
      return process.env;
    },
    artifacts: ['talysman-svc', 'talysman-svcctl', 'talysman-recover', 'talysman-natmsg'],
    extraFiles(crate) {
      return [
        resolve(crate, 'installer/after-install.sh'),
        resolve(crate, 'installer/before-remove.sh'),
        resolve(crate, 'installer/after-remove.sh'),
      ];
    },
  },
  mac: {
    hostPlatform: 'darwin',
    crate: 'native/macos',
    outName: 'mac',
    cargoEnv() {
      return process.env;
    },
    artifacts: ['talysman-svc', 'talysman-svcctl', 'talysman-recover', 'talysman-natmsg'],
    extraFiles() {
      return [];
    },
  },
};

function platformTarget(platform) {
  if (platform === 'win32') return 'win';
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'mac';
  return platform;
}

function run(cmd, cmdArgs, cwd = root, env = process.env) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env, shell: process.platform === 'win32' });
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    console.error(`Expected ${label} missing: ${path}`);
    process.exit(1);
  }
}

function copyIntoDirs(src, dirs) {
  const name = src.split(/[\\/]/).pop();
  for (const dir of dirs) {
    copyFileSync(src, resolve(dir, name));
  }
  console.log(`  copied ${name}`);
}

const cfg = TARGETS[target];
if (!cfg) {
  console.error(`Unsupported native target "${target}". Expected one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

if (process.platform !== cfg.hostPlatform) {
  console.error(
    `build-native --target ${target} must run on ${cfg.hostPlatform} (current host is ${process.platform}).`,
  );
  process.exit(1);
}

const crate = resolve(root, cfg.crate);
assertExists(crate, 'native crate');

console.log(`Building native ${target} backend`);
run('cargo', ['build', '--release'], crate, cfg.cargoEnv(crate));

const targetDir = resolve(crate, 'target/release');
const platformOutDir = resolve(root, 'apps/desktop/resources/bin', cfg.outName);
const currentOutDir = resolve(root, 'apps/desktop/resources/bin/current');
rmSync(currentOutDir, { recursive: true, force: true });
mkdirSync(platformOutDir, { recursive: true });
mkdirSync(currentOutDir, { recursive: true });

for (const artifact of cfg.artifacts) {
  const src = resolve(targetDir, artifact);
  assertExists(src, 'native artifact');
  copyIntoDirs(src, [platformOutDir, currentOutDir]);
}

for (const extra of cfg.extraFiles(crate)) {
  assertExists(extra, 'native support file');
  copyIntoDirs(extra, [platformOutDir, currentOutDir]);
}

const staged = readdirSync(currentOutDir);
console.log(`\nOK native ${target} artifacts staged in resources/bin/current:`);
for (const name of staged) console.log(`  - ${name}`);
