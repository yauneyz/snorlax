#!/usr/bin/env node
/**
 * Prepare browser-store extension release artifacts.
 *
 * Store distribution is the consumer release channel:
 *   - Chrome Web Store signs, hosts, and updates the Chrome package.
 *   - Microsoft Edge Add-ons signs, hosts, and updates the Edge package.
 *   - Firefox AMO signs, hosts, and updates the Firefox package.
 *
 * Store packages must not contain custom update_url values. Chrome includes the Web Store public
 * key so the upload ZIP and Load-unpacked directory have the same item ID.
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
const identities = JSON.parse(
  readFileSync(resolve(root, "native/common/extension-identities.json"), "utf8"),
);
const FIREFOX_ID = identities.firefoxId;

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
  if (store === "chrome") {
    if (manifest.key !== identities.chromePublicKey) {
      fail("chrome: manifest key must match extension-identities.json");
    }
  } else if ("key" in manifest) {
    fail(`${store}: store manifest must not contain key`);
  }
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
      chrome: identities.chromeStoreId,
      edge: identities.edgeStoreId || "not assigned yet",
      firefox: FIREFOX_ID,
    },
    releaseNotes: [
      "Upload each zip to its matching browser store.",
      "Do not add custom update_url values to store manifests.",
      "The Chrome ZIP and dist/chrome directory are the same keyed package for upload and Load unpacked.",
      "Store item IDs are assigned before review; record them in native/common/extension-identities.json before building the reviewer desktop installer.",
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
  console.log(`Chrome Web Store ID: ${identities.chromeStoreId}`);
  console.log(`Edge Add-ons ID: ${identities.edgeStoreId || "not assigned yet"}`);
}

main();
