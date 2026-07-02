#!/usr/bin/env node
/**
 * Local NixOS release for the Talysman/snorlax desktop app.
 *
 * Mirrors the Thinky `release.js --no-upload` flow: build the Linux AppImage with
 * the repo's own toolchain, add it to /nix/store, and write+stage
 * ~/nixos-config/pkgs/snorlax/release.nix so the next `nixos-rebuild` picks up the
 * new version. pkgs/snorlax/default.nix wraps that AppImage via appimageTools.
 *
 * Usage:
 *   pnpm run release:local            # build + install into /nix/store + stage release.nix
 *   pnpm run release:local --dry-run  # print intent, no nix-store/git writes
 *
 * Note: the privileged daemon is NOT shipped via this AppImage on NixOS — it is built
 * from native/linux by pkgs/snorlax-daemon and started by a declarative systemd unit.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const nixSnorlaxDir = join(homedir(), 'nixos-config/pkgs/snorlax');
const stableAppImage = join(distDir, 'snorlax.AppImage');
const dryRun = process.argv.slice(2).includes('--dry-run');

function run(cmd, args, opts = {}) {
  console.log(`\n› ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
}

function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts }).trim();
}

function commandAvailable(cmd, args = ['--version']) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'ignore' });
  return result.status === 0;
}

function rustToolchainAvailable() {
  return commandAvailable('cargo') && commandAvailable('rustc');
}

function packageVersion() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

function buildAppImage() {
  // Reuse the standard orchestration (native Rust + extension + electron + electron-builder).
  if (rustToolchainAvailable()) {
    run('pnpm', ['run', 'build:linux']);
  } else if (commandAvailable('nix')) {
    console.log('\n🧰 Rust toolchain not found; building with nixpkgs#cargo and nixpkgs#rustc');
    run('nix', ['shell', 'nixpkgs#cargo', 'nixpkgs#rustc', '-c', 'pnpm', 'run', 'build:linux']);
  } else {
    throw new Error('cargo is required to build the native Linux service. Install Rust or run on a system with nix.');
  }

  const built = readdirSync(distDir).filter(
    (f) => f.endsWith('.AppImage') && f !== 'snorlax.AppImage',
  );
  if (built.length === 0) {
    throw new Error(`No *.AppImage produced in ${distDir} — check the AppImage target in electron-builder.yml`);
  }
  // Stable name so the Nix store key doesn't depend on the version string.
  copyFileSync(join(distDir, built[0]), stableAppImage);
  console.log(`\n📋 Copied ${built[0]} → snorlax.AppImage`);
}

function installIntoNixStore(version) {
  if (!existsSync(nixSnorlaxDir)) {
    throw new Error(`${nixSnorlaxDir} not found — create pkgs/snorlax in nixos-config first`);
  }
  if (dryRun) {
    console.log('🧪 [DRY RUN] would nix-store --add-fixed + write release.nix');
    return;
  }

  const storePath = capture('nix-store', ['--add-fixed', 'sha256', stableAppImage]);
  const sha256 = capture('nix-hash', ['--type', 'sha256', '--flat', '--base32', stableAppImage]);

  const releaseNix = join(nixSnorlaxDir, 'release.nix');
  const body =
    `{\n` +
    `  version = "${version}";\n` +
    `  storePath = builtins.fetchurl {\n` +
    `    url = "file://${storePath}";\n` +
    `    sha256 = "${sha256}";\n` +
    `  };\n` +
    `}\n`;
  writeFileSync(releaseNix, body);
  console.log(`📥 Wrote ${releaseNix}`);
  console.log(`   storePath = ${storePath}`);

  const repoRoot = capture('git', ['rev-parse', '--show-toplevel'], { cwd: nixSnorlaxDir });
  run('git', ['add', '-f', relative(repoRoot, releaseNix)], { cwd: repoRoot });
  const visible = capture('nix', ['eval', '--raw', '.#snorlax.version'], { cwd: repoRoot });
  if (visible !== version) {
    throw new Error(`flake sees snorlax ${visible}, expected ${version}`);
  }
  console.log(`✅ Nix flake sees snorlax ${visible} — run 'rebuild' to activate`);
}

const version = packageVersion();
console.log(`🏷️  snorlax local release: v${version}${dryRun ? ' (dry run)' : ''}`);
buildAppImage();
installIntoNixStore(version);
console.log('\n🎉 Done.');
