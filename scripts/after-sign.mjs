#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function signingIdentity(appPath) {
  const result = spawnSync("codesign", ["-dvvv", appPath], {
    encoding: "utf8",
  });
  const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const authority = details.match(/^Authority=(.+)$/m)?.[1]?.trim();
  if (!authority) {
    throw new Error(`Cannot determine the signing identity for ${appPath}`);
  }
  return authority;
}

function codesign(identity, targetPath, entitlements) {
  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      identity,
      "--timestamp",
      "--options",
      "runtime",
      ...(entitlements ? ["--entitlements", entitlements] : []),
      targetPath,
    ],
    { stdio: "inherit" },
  );
}

/**
 * notarytool auth args, in the same precedence electron-builder's own MacTargetHelper uses:
 * keychain profile, then App Store Connect API key, then Apple ID + app-specific password.
 * Reads process.env directly since this hook is loaded in-process by electron-builder, which
 * already has the credentials resolved by scripts/lib/apple-release.mjs on the environment.
 */
function notarytoolAuthArgs(env) {
  if (env.APPLE_KEYCHAIN_PROFILE) {
    const args = ["--keychain-profile", env.APPLE_KEYCHAIN_PROFILE];
    if (env.APPLE_KEYCHAIN) args.push("--keychain", env.APPLE_KEYCHAIN);
    return args;
  }
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return ["--key", env.APPLE_API_KEY, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER];
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return ["--apple-id", env.APPLE_ID, "--password", env.APPLE_APP_SPECIFIC_PASSWORD, "--team-id", env.APPLE_TEAM_ID];
  }
  return null;
}

/**
 * Notarize and staple the fully-sealed app. This has to run after every other signing step in
 * this file (native binaries + the outer app's final re-sign above) rather than relying on
 * electron-builder's own `mac.notarize` option, which submits and staples *before* the
 * `afterSign` hook runs. Re-signing an app after it's been stapled changes its CDHash and
 * orphans the ticket: codesign still reports "Notarization Ticket=stapled" (the blob is still
 * physically embedded) but it no longer matches the current signature, so Gatekeeper (spctl) and
 * `stapler validate` both correctly reject it. electron-builder.yml sets `mac.notarize: false`
 * so this is the only notarization pass, and it happens last.
 */
function notarizeAndStaple(appPath) {
  const authArgs = notarytoolAuthArgs(process.env);
  if (!authArgs) {
    throw new Error(
      "No notarization credentials found on the environment (APPLE_KEYCHAIN_PROFILE, " +
        "APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/" +
        "APPLE_TEAM_ID). mac.notarize is disabled in electron-builder.yml, so afterSign must " +
        "notarize itself -- see apple-notarization.md.",
    );
  }

  const zipDir = mkdtempSync(join(tmpdir(), "talysman-notarize-"));
  const zipPath = join(zipDir, "Talysman.zip");
  try {
    console.log("Submitting app for notarization...");
    execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, zipPath], {
      stdio: "inherit",
    });
    execFileSync(
      "xcrun",
      ["notarytool", "submit", zipPath, ...authArgs, "--wait"],
      { stdio: "inherit" },
    );
    console.log("Notarization successful; stapling ticket...");
    execFileSync("xcrun", ["stapler", "staple", appPath], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "validate", appPath], { stdio: "inherit" });
  } finally {
    rmSync(zipDir, { recursive: true, force: true });
  }
}

/**
 * Sign every nested executable electron-builder doesn't already know about, then repair and
 * verify the enclosing app's seal. Two things live under here: the (currently unembedded)
 * Safari extension, and the talysman-svc/svcctl/recover/natmsg binaries scripts/build-native.mjs
 * stages into Contents/Resources/bin — those ship unsigned otherwise, which notarization rejects.
 */
export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = resolve(context.appOutDir, `${appName}.app`);
  const identity = signingIdentity(appPath);

  // Safari packaging is currently disabled (build.mjs excludes it), so the appex is normally
  // absent. Sign it when present so this hook is ready the moment Safari support returns.
  const appexPath = resolve(
    appPath,
    "Contents/PlugIns/Talysman Safari Extension.appex",
  );
  if (existsSync(appexPath)) {
    codesign(
      identity,
      appexPath,
      resolve(root, "apps/extension/safari/SafariExtension.entitlements"),
    );
  }

  const binDir = resolve(appPath, "Contents/Resources/bin");
  const nativeBinaries = existsSync(binDir) ? readdirSync(binDir) : [];
  for (const name of nativeBinaries) {
    codesign(identity, resolve(binDir, name));
  }
  console.log(
    `Signed ${nativeBinaries.length} native service binaries in Contents/Resources/bin`,
  );

  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      identity,
      "--timestamp",
      "--options",
      "runtime",
      "--preserve-metadata=identifier,entitlements,requirements",
      appPath,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { stdio: "inherit" },
  );
  console.log("Signed and verified nested macOS components inside Talysman.app");

  notarizeAndStaple(appPath);
}
