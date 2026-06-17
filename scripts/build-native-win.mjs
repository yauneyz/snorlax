#!/usr/bin/env node
/**
 * Build the native Windows service (Rust) and copy the binaries into the Electron app's
 * resources so electron-builder can embed them (architecture §13).
 *
 *   cargo build --release  →  copy {svc,svcctl,recover}.exe + WinDivert.dll + WinDivert64.sys
 *                             → apps/desktop/resources/bin/win/
 *
 * The enforcement engine links WinDivert; the build needs WINDIVERT_PATH set to the vendored
 * library folder, and the matching dll + signed driver must ship next to focuslock-svc.exe
 * (WinDivert.dll loads WinDivert64.sys from its own directory at runtime).
 *
 * Must run on Windows with the MSVC toolchain + VS Build Tools installed.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = resolve(root, 'native/windows');
const outDir = resolve(root, 'apps/desktop/resources/bin/win');
const windivertDir = resolve(crate, 'vendor/windivert');

if (process.platform !== 'win32') {
  console.error('build-native-win.mjs must run on Windows (the service links Win32/WFP/WinDivert).');
  process.exit(1);
}

console.log('› cargo build --release');
execFileSync('cargo', ['build', '--release'], {
  cwd: crate,
  stdio: 'inherit',
  env: { ...process.env, WINDIVERT_PATH: windivertDir },
});

mkdirSync(outDir, { recursive: true });

const targetDir = resolve(crate, 'target/release');
for (const exe of [
  'focuslock-svc.exe',
  'focuslock-svcctl.exe',
  'focuslock-recover.exe',
  'focuslock-natmsg.exe', // browser native-messaging host (bridges the extension ⇄ service)
]) {
  const src = resolve(targetDir, exe);
  if (!existsSync(src)) {
    console.error(`Expected binary missing: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, resolve(outDir, exe));
  console.log(`  copied ${exe}`);
}

// WinDivert user library + signed driver, shipped alongside the service exe.
for (const lib of ['WinDivert.dll', 'WinDivert64.sys']) {
  const src = resolve(windivertDir, lib);
  if (!existsSync(src)) {
    console.error(`Expected WinDivert file missing: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, resolve(outDir, lib));
  console.log(`  copied ${lib}`);
}

console.log('✓ native binaries + WinDivert staged in resources/bin/win');
