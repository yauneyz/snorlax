#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Embed the unsigned Safari app extension before electron-builder signs the nested macOS bundle. */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const source = resolve(
    root,
    "apps/extension/dist/safari-appex/Talysman Safari Extension.appex",
  );
  if (!existsSync(source)) {
    throw new Error(
      "Safari app extension is missing. Run pnpm build:extension on macOS before packaging Talysman.",
    );
  }

  const appName = context.packager.appInfo.productFilename;
  const pluginsDir = resolve(context.appOutDir, `${appName}.app/Contents/PlugIns`);
  const destination = resolve(pluginsDir, "Talysman Safari Extension.appex");
  mkdirSync(pluginsDir, { recursive: true });
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  console.log(`Embedded Safari Web Extension: ${destination}`);
}
