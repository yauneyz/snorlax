#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

/** Apply the Safari-only socket entitlements, then repair and verify the enclosing app signature. */
export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = resolve(context.appOutDir, `${appName}.app`);
  const appexPath = resolve(
    appPath,
    "Contents/PlugIns/Talysman Safari Extension.appex",
  );
  if (!existsSync(appexPath)) {
    throw new Error(`Embedded Safari app extension is missing: ${appexPath}`);
  }

  const identity = signingIdentity(appPath);
  const entitlements = resolve(
    root,
    "apps/extension/safari/SafariExtension.entitlements",
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
      "--entitlements",
      entitlements,
      appexPath,
    ],
    { stdio: "inherit" },
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
  console.log("Signed and verified the Safari Web Extension inside Talysman.app");
}
