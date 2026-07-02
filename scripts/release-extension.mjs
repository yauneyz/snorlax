#!/usr/bin/env node
/**
 * Prepare browser-store extension release artifacts.
 *
 * Store distribution is the consumer release channel:
 *   - Chrome Web Store signs, hosts, and updates the Chrome package.
 *   - Microsoft Edge Add-ons signs, hosts, and updates the Edge package.
 *   - Firefox AMO signs, hosts, and updates the Firefox package.
 *
 * Store packages must not contain custom update_url or key values.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = resolve(root, "apps/extension");
const distDir = resolve(extDir, "dist");
const releaseDir = resolve(extDir, "release");
const storeDir = resolve(releaseDir, "store");
const FIREFOX_ID = "talysman@talysman.app";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status ?? 1}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertFile(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) fail(`Missing release artifact: ${relative(root, path)}`);
}

function assertStoreManifest(store, manifest) {
  if ("update_url" in manifest) fail(`${store}: store manifest must not contain update_url`);
  if ("key" in manifest) fail(`${store}: store manifest must not contain key`);
  if (store === "firefox") {
    const geckoId = manifest.browser_specific_settings?.gecko?.id;
    if (geckoId !== FIREFOX_ID) {
      fail(`firefox: expected Gecko ID ${FIREFOX_ID}, got ${geckoId ?? "(missing)"}`);
    }
  }
}

function main() {
  run("node", ["scripts/build-extension.mjs"]);
  run("node", ["scripts/audit-extension.mjs"]);

  const baseManifest = readJson(resolve(extDir, "manifest.json"));
  const version = baseManifest.version;
  if (typeof version !== "string" || version.length === 0) {
    fail("apps/extension/manifest.json must contain a version");
  }

  const stores = [
    {
      name: "chrome",
      artifact: resolve(distDir, `talysman-chrome-${version}.zip`),
      manifest: resolve(distDir, "chrome", "manifest.json"),
      destination: resolve(storeDir, `talysman-chrome-${version}.zip`),
      uploadTarget: "Chrome Web Store",
    },
    {
      name: "edge",
      artifact: resolve(distDir, `talysman-edge-${version}.zip`),
      manifest: resolve(distDir, "edge", "manifest.json"),
      destination: resolve(storeDir, `talysman-edge-${version}.zip`),
      uploadTarget: "Microsoft Edge Add-ons",
    },
    {
      name: "firefox",
      artifact: resolve(distDir, `talysman-firefox-${version}.zip`),
      manifest: resolve(distDir, "firefox", "manifest.json"),
      destination: resolve(storeDir, `talysman-firefox-${version}.zip`),
      uploadTarget: "Firefox AMO",
    },
  ];

  for (const store of stores) {
    assertFile(store.artifact);
    assertStoreManifest(store.name, readJson(store.manifest));
  }

  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(storeDir, { recursive: true });

  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    artifacts: Object.fromEntries(
      stores.map((store) => {
        copyFileSync(store.artifact, store.destination);
        return [store.name, relative(extDir, store.destination).replace(/\\/g, "/")];
      }),
    ),
    identities: {
      chrome: "assigned by Chrome Web Store after first upload",
      edge: "assigned by Microsoft Edge Add-ons after first upload",
      firefox: FIREFOX_ID,
    },
    releaseNotes: [
      "Upload each zip to its matching browser store.",
      "Do not add custom update_url or key values to store manifests.",
      "After first Chrome and Edge publication, wire the assigned IDs into native/windows/src/enforce/extension_policy.rs.",
    ],
  };
  writeFileSync(
    resolve(releaseDir, "store-submission.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log("\nOK Store submission artifacts prepared:");
  for (const store of stores) {
    console.log(
      `  ${store.name.padEnd(7)} ${relative(root, store.destination)} -> ${store.uploadTarget}`,
    );
  }
  console.log(`\nFirefox Gecko ID: ${FIREFOX_ID}`);
  console.log("Chrome and Edge IDs are assigned by their stores after first upload.");
}

main();
