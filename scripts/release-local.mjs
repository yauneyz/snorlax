#!/usr/bin/env node
/**
 * Local NixOS release for the Talysman/snorlax desktop app.
 *
 * Mirrors the Thinky `release.js --no-upload` flow: build the Linux artifacts with
 * the repo's own toolchain, add the AppImage to /nix/store, and write+stage
 * ~/nixos-config/pkgs/snorlax/release.nix so the next `nixos-rebuild` picks up the
 * new version. pkgs/snorlax/default.nix wraps that AppImage via appimageTools.
 *
 * The AppImage is strictly local-to-NixOS; the public release chain only ever
 * publishes the deb (see scripts/upload-release.mjs), which this script runs last.
 *
 * Usage:
 *   pnpm run release:local             # build + install into /nix/store + stage release.nix + upload to S3
 *   pnpm run release:local --dry-run   # print intent, no nix-store/git/S3 writes
 *   pnpm run release:local --no-upload # skip publishing installers to S3
 *
 * Note: the privileged daemon is NOT shipped via this AppImage on NixOS — it is built
 * from native/linux by pkgs/snorlax-daemon and started by a declarative systemd unit.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const nixSnorlaxDir = join(homedir(), 'nixos-config/pkgs/snorlax');
const stableAppImage = join(distDir, 'snorlax.AppImage');
const dryRun = process.argv.slice(2).includes('--dry-run');
const noUpload = process.argv.slice(2).includes('--no-upload');
const localConfigDir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'talysman');
const localKeyDir = join(localConfigDir, 'keys');
const localPrivateKeyPath = join(localKeyDir, 'local-entitlement-ed25519-private.pem');
const localEntitlementPath = join(localConfigDir, 'local-entitlement.json');
const localEntitlementDays = 365;

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

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;

  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function localUserName() {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? '';
  }
}

function ensureLocalEntitlementKey() {
  if (existsSync(localPrivateKeyPath)) {
    const privateKey = createPrivateKey(readFileSync(localPrivateKeyPath, 'utf8'));
    const publicKey = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    return { privateKey, publicKey };
  }

  const { privateKey } = generateKeyPairSync('ed25519');
  if (!dryRun) {
    mkdirSync(localKeyDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      localPrivateKeyPath,
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
      { mode: 0o600 },
    );
    chmodSync(localPrivateKeyPath, 0o600);
    console.log(`🔐 Created local entitlement signing key at ${localPrivateKeyPath}`);
  }

  const publicKey = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  return { privateKey, publicKey };
}

function writeLocalEntitlementLicense(privateKey, version) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + localEntitlementDays * 24 * 60 * 60 * 1000);
  const payload = {
    version: 1,
    plan: 'pro',
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    reason: 'release-local',
    hostname: hostname(),
    user: localUserName(),
  };
  const signature = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKey).toString(
    'base64url',
  );
  const license = { ...payload, signature };

  if (dryRun) {
    console.log(
      `🧪 [DRY RUN] would write signed local entitlement for ${payload.user}@${payload.hostname}`,
    );
    return;
  }

  mkdirSync(localConfigDir, { recursive: true, mode: 0o700 });
  writeFileSync(localEntitlementPath, `${JSON.stringify(license, null, 2)}\n`, { mode: 0o600 });
  chmodSync(localEntitlementPath, 0o600);
  console.log(
    `🎟️  Wrote local Pro entitlement for ${payload.user}@${payload.hostname} ` +
      `(expires ${expiresAt.toISOString().slice(0, 10)})`,
  );
  console.log(`   ${localEntitlementPath}`);
  console.log(`   app version ${version}`);
}

function buildAppImage() {
  const buildStartedAt = Date.now();

  // Reuse the standard orchestration (native Rust + extension + electron + electron-builder).
  if (rustToolchainAvailable()) {
    run('pnpm', ['run', 'build:linux']);
  } else if (commandAvailable('nix')) {
    console.log('\n🧰 Rust toolchain not found; building with nixpkgs#cargo and nixpkgs#rustc');
    run('nix', ['shell', 'nixpkgs#cargo', 'nixpkgs#rustc', '-c', 'pnpm', 'run', 'build:linux']);
  } else {
    throw new Error('cargo is required to build the native Linux service. Install Rust or run on a system with nix.');
  }

  // Only accept AppImages written by this build — a leftover artifact from before a
  // rename (e.g. FocusLock-*.AppImage) must never be released again.
  const built = readdirSync(distDir)
    .filter((f) => f.endsWith('.AppImage') && f !== 'snorlax.AppImage')
    .map((f) => ({ name: f, mtimeMs: statSync(join(distDir, f)).mtimeMs }))
    .filter((f) => f.mtimeMs >= buildStartedAt)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (built.length === 0) {
    throw new Error(
      `No fresh *.AppImage produced in ${distDir} — check the AppImage target in electron-builder.yml (stale artifacts are ignored)`,
    );
  }
  // Stable name so the Nix store key doesn't depend on the version string.
  copyFileSync(join(distDir, built[0].name), stableAppImage);
  console.log(`\n📋 Copied ${built[0].name} → snorlax.AppImage`);
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
const localEntitlementKey = ensureLocalEntitlementKey();
process.env.LOCAL_ENTITLEMENT_PUBLIC_KEY = localEntitlementKey.publicKey;
console.log('🔏 Embedding local entitlement public key for release-local builds');
buildAppImage();
writeLocalEntitlementLicense(localEntitlementKey.privateKey, version);
installIntoNixStore(version);
if (noUpload) {
  console.log('⏭️  Skipping S3 upload (--no-upload)');
} else {
  // Publish the installer so /download links resolve; verifies the public URL after upload.
  run('node', [
    'scripts/upload-release.mjs',
    '--require',
    'linux',
    ...(dryRun ? ['--dry-run'] : []),
  ]);
}
console.log('\n🎉 Done.');
