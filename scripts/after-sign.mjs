#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
}
