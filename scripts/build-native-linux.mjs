#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

execFileSync('node', ['scripts/build-native.mjs', '--target', 'linux'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
