#!/usr/bin/env node
/**
 * Full build orchestration (architecture §13):
 *   1. build native service (Rust) → stage binaries
 *   2. electron-vite build (main + preload + renderer)
 *   3. electron-builder (platform installer that registers/starts the service)
 *
 * Usage: node scripts/build.mjs --target win|linux|mac
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import toml from "@iarna/toml";

import {
  REQUIRED_PRODUCTION_DESKTOP_ENV,
  desktopEnvPairs,
  verifyDirectDesktopApiBaseUrl,
} from "./lib/desktop-environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const target = targetIdx !== -1 ? args[targetIdx + 1] : "win";
const cross = args.includes("--cross");

const TARGETS = {
  win: { hostPlatform: "win32", builderFlag: "--win", nativeTarget: "win" },
  linux: {
    hostPlatform: "linux",
    builderFlag: "--linux",
    nativeTarget: "linux",
  },
  mac: { hostPlatform: "darwin", builderFlag: "--mac", nativeTarget: "mac" },
};

function run(cmd, cmdArgs, cwd = root) {
  console.log(`\n› ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function desktopElectronVersion() {
  const pkg = resolve(root, "apps/desktop/node_modules/electron/package.json");
  return JSON.parse(readFileSync(pkg, "utf8")).version;
}

function packageVersion(path) {
  return JSON.parse(readFileSync(path, "utf8")).version;
}

function cargoVersion(path) {
  const source = readFileSync(path, "utf8");
  const packageBlock =
    source.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  const version = packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error(`Cannot read [package].version from ${path}`);
  return version;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1);
  return trimmed;
}

function loadBuildEnvironment() {
  const mode =
    process.env.APP_ENV === "production" ? "production" : "development";
  const path = resolve(root, `.env.${mode}`);
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = unquoteEnvValue(match[2]);
      }
    }
  }

  const credentialsPath = [
    resolve(root, ".credentials"),
    resolve(root, "../indigo/.credentials"),
  ].find((candidate) => existsSync(candidate));
  if (credentialsPath) {
    const credentials = toml.parse(readFileSync(credentialsPath, "utf8"));
    const credentialMode = mode === "production" ? "prod" : "dev";
    for (const [name, value] of desktopEnvPairs(credentials, credentialMode)) {
      if (!process.env[name] && value) {
        process.env[name] = value;
      }
    }
  }
}

function validateReleaseInputs(target) {
  const version = packageVersion(resolve(root, "package.json"));
  const desktopVersion = packageVersion(
    resolve(root, "apps/desktop/package.json"),
  );
  const nativeVersion = cargoVersion(
    resolve(
      root,
      `native/${target === "win" ? "windows" : target === "mac" ? "macos" : "linux"}/Cargo.toml`,
    ),
  );
  const mismatches = [
    ["apps/desktop/package.json", desktopVersion],
    [
      `native/${target === "win" ? "windows" : target === "mac" ? "macos" : "linux"}/Cargo.toml`,
      nativeVersion,
    ],
  ].filter(([, candidate]) => candidate !== version);
  if (mismatches.length > 0) {
    throw new Error(
      `Release version ${version} is inconsistent: ${mismatches.map(([path, candidate]) => `${path}=${candidate}`).join(", ")}. Run pnpm release:version -- ${version}.`,
    );
  }
  if (process.env.APP_ENV === "production") {
    const missingEnvironment = REQUIRED_PRODUCTION_DESKTOP_ENV.filter(
      (name) => !process.env[name],
    );
    if (missingEnvironment.length === 0) return;
    throw new Error(
      `Production desktop configuration is missing: ${missingEnvironment.join(", ")}. ` +
        "Fill the public values in .env.production or configure .credentials.",
    );
  }
}

const cfg = TARGETS[target];
if (!cfg) {
  console.error(
    `Unsupported build target "${target}". Expected one of: ${Object.keys(TARGETS).join(", ")}`,
  );
  process.exit(1);
}

loadBuildEnvironment();
validateReleaseInputs(target);
if (process.env.APP_ENV === "production") {
  await verifyDirectDesktopApiBaseUrl(process.env.API_BASE_URL);
}

const crossWindowsFromLinux =
  cross && target === "win" && process.platform === "linux";
if (process.platform !== cfg.hostPlatform && !crossWindowsFromLinux) {
  console.error(
    `build --target ${target} must run on ${cfg.hostPlatform} (current host is ${process.platform}).`,
  );
  process.exit(1);
}

// 1. Native service.
run("node", [
  "scripts/build-native.mjs",
  "--target",
  cfg.nativeTarget,
  ...(crossWindowsFromLinux ? ["--cross"] : []),
]);

// 1b. Browser extensions. Safari support is intentionally excluded for now.
run("node", ["scripts/build-extension.mjs"]);
run("node", ["scripts/audit-extension.mjs"]);

// 2. Electron bundles.
run("pnpm", ["--filter", "@talysman/desktop", "build"]);

// Windows has no Authenticode certificate yet, so electron-builder.yml's
// forceCodeSigning is dropped for Windows when no certificate is configured: the build
// produces an unsigned NSIS installer instead of failing. As soon as WIN_CSC_LINK (or
// CSC_LINK) is set the flag stays on, so a misconfigured cert still fails closed rather
// than silently shipping unsigned. macOS is never relaxed — an unsigned/un-notarized
// mac build is hard-blocked by Gatekeeper, so it must never be produced by accident.
const winSigningConfigured = Boolean(
  process.env.WIN_CSC_LINK || process.env.CSC_LINK,
);
const allowUnsignedWin = target === "win" && !winSigningConfigured;
if (allowUnsignedWin) {
  console.warn(
    "\nWARNING No Windows signing certificate (WIN_CSC_LINK/CSC_LINK unset):\n" +
      "        building an UNSIGNED installer. Windows SmartScreen will warn\n" +
      "        users on download and install.\n",
  );
}

// 3. Package + NSIS installer.
run("pnpm", [
  "exec",
  "electron-builder",
  cfg.builderFlag,
  ...(crossWindowsFromLinux ? ["--x64"] : []),
  "--config",
  "electron-builder.yml",
  `--config.electronVersion=${desktopElectronVersion()}`,
  ...(allowUnsignedWin ? ["--config.forceCodeSigning=false"] : []),
]);

console.log("\nOK Build complete. Installer is in dist/.");
