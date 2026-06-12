#!/usr/bin/env node
/**
 * Dev loop (architecture §13). Runs electron-vite dev (HMR for renderer, live-reload for
 * main/preload). The Electron app auto-falls back to the in-process mock service if the
 * native service pipe isn't reachable, so this works even on WSL / without elevation.
 *
 * To exercise REAL enforcement in dev, separately run the native service in console mode
 * from an elevated terminal (see build-guide.md):
 *   cargo run --manifest-path native/windows/Cargo.toml --bin focuslock-svc -- --console
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, 'apps/desktop');

process.env.APP_ENV ??= 'development';

const child = spawn('pnpm', ['--filter', '@focuslock/desktop', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
