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
import {
  assertLiveStripeRelease,
  desktopStripeReleaseIssues,
} from "./lib/stripe-mode.mjs";
import {
  TRUSTED_SIGNING_ACCOUNT,
  TRUSTED_SIGNING_CERTIFICATE_PROFILE,
  TRUSTED_SIGNING_ENDPOINT,
  windowsSigningAvailable,
} from "./lib/windows-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const target = targetIdx !== -1 ? args[targetIdx + 1] : "win";
const cross = args.includes("--cross");
// Set by scripts/release-local.mjs: a production build that stays on this NixOS host.
const isLocalRelease = process.env.LOCAL_RELEASE_BUILD === "true";

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
    // Only a production build that will actually be published gets live Stripe keys.
    const stripeTarget =
      credentialMode === "prod" && !isLocalRelease ? "production" : "development";
    for (const [name, value] of desktopEnvPairs(credentials, credentialMode, {
      stripeTarget,
    })) {
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
  if (process.env.APP_ENV !== "production") return;

  const missingEnvironment = REQUIRED_PRODUCTION_DESKTOP_ENV.filter(
    (name) => !process.env[name],
  );
  if (missingEnvironment.length > 0) {
    throw new Error(
      `Production desktop configuration is missing: ${missingEnvironment.join(", ")}. ` +
        "Fill the public values in .env.production or configure .credentials.",
    );
  }

  // A published installer must point at live Stripe. release:local is the one production
  // build that never leaves this machine, so it stays on test.
  if (isLocalRelease) {
    console.log(
      `\nrelease:local build — Stripe stays in ${process.env.STRIPE_MODE ?? "test"} mode (nothing is published).`,
    );
    return;
  }
  assertLiveStripeRelease(desktopStripeReleaseIssues(process.env), {
    surface: `the published ${target} desktop installer`,
  });
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

// Windows has no Authenticode certificate configured by default, so electron-builder.yml's
// forceCodeSigning is dropped for Windows when nothing is configured: the build produces an
// unsigned NSIS installer instead of failing. As soon as either the legacy CSC_LINK cert path
// or the AZURE_* Trusted Signing vars are set, the flag stays on, so a misconfigured cert still
// fails closed rather than silently shipping unsigned. macOS is never relaxed — an
// unsigned/un-notarized mac build is hard-blocked by Gatekeeper, so it must never be produced
// by accident.
//
// azureSignOptions is intentionally never declared in electron-builder.yml itself: unlike the
// signtool/CSC_LINK path (which gracefully no-ops when unconfigured), a configured-but-
// unauthenticated Azure signer throws and crashes the build. It's only ever passed here, as a
// --config override, when windowsSigningAvailable() confirms full credentials are present.
const azureSigningConfigured = windowsSigningAvailable();
const winSigningConfigured =
  azureSigningConfigured || Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK);
const allowUnsignedWin = target === "win" && !winSigningConfigured;
if (allowUnsignedWin) {
  console.warn(
    "\nWARNING No Windows signing certificate (WIN_CSC_LINK/CSC_LINK/AZURE_* unset):\n" +
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
  ...(azureSigningConfigured
    ? [
        `--config.win.azureSignOptions.publisherName=${process.env.AZURE_SIGNING_PUBLISHER_NAME}`,
        `--config.win.azureSignOptions.endpoint=${TRUSTED_SIGNING_ENDPOINT}`,
        `--config.win.azureSignOptions.certificateProfileName=${TRUSTED_SIGNING_CERTIFICATE_PROFILE}`,
        `--config.win.azureSignOptions.codeSigningAccountName=${TRUSTED_SIGNING_ACCOUNT}`,
      ]
    : []),
]);

console.log("\nOK Build complete. Installer is in dist/.");
