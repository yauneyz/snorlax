#!/usr/bin/env node
/**
 * Build the native Windows service (Rust) and copy the binaries into the Electron app's
 * resources so electron-builder can embed them (architecture §13).
 *
 *   cargo build --release  →  copy {svc,svcctl,recover}.exe → apps/desktop/resources/bin/win/
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

if (process.platform !== 'win32') {
  console.error('build-native-win.mjs must run on Windows (the service links Win32/WFP).');
  process.exit(1);
}

console.log('› cargo build --release');
execFileSync('cargo', ['build', '--release'], { cwd: crate, stdio: 'inherit' });

mkdirSync(outDir, { recursive: true });
const targetDir = resolve(crate, 'target/release');
for (const exe of ['focuslock-svc.exe', 'focuslock-svcctl.exe', 'focuslock-recover.exe']) {
  const src = resolve(targetDir, exe);
  if (!existsSync(src)) {
    console.error(`Expected binary missing: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, resolve(outDir, exe));
  console.log(`  copied ${exe}`);
}
console.log('✓ native binaries staged in resources/bin/win');
