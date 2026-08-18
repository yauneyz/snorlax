#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  signNativeWindowsBinaries,
  windowsSigningAvailable,
} from "./lib/windows-release.mjs";

/**
 * electron-builder's own Windows signing pass (app-builder-lib's WinPackager.signApp) only
 * signs the top-level app exe plus files under resources/app.asar.unpacked and
 * resources/swiftshader — it never walks resources/bin, where scripts/build-native.mjs stages
 * talysman-svc/svcctl/recover/natmsg.exe via extraResources. Sign those explicitly here, before
 * the NSIS installer bundles them.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const binDir = resolve(context.appOutDir, "resources/bin");
  const binaries = existsSync(binDir)
    ? readdirSync(binDir).filter((name) => name.endsWith(".exe"))
    : [];
  if (binaries.length === 0) return;

  if (!windowsSigningAvailable()) {
    console.warn(
      "\nWARNING No Azure Trusted Signing credentials configured: native service binaries " +
        `in resources/bin (${binaries.join(", ")}) will ship unsigned.\n`,
    );
    return;
  }

  console.log(
    `\nSigning ${binaries.length} native service binaries via Azure Trusted Signing`,
  );
  await signNativeWindowsBinaries(binaries.map((name) => resolve(binDir, name)));
}
