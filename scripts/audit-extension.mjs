#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "apps/extension");
const distDir = resolve(extensionDir, "dist");
const expectedPermissions = ["declarativeNetRequest", "nativeMessaging"];

function fail(message) {
  throw new Error(`Extension compliance audit failed: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertMinimalManifest(manifest, store) {
  if (manifest.manifest_version !== 3) fail(`${store}: Manifest V3 is required`);
  const actual = [...(manifest.permissions ?? [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expectedPermissions].sort())) {
    fail(`${store}: permissions must be exactly ${expectedPermissions.join(", ")}`);
  }
  if ("host_permissions" in manifest || "optional_host_permissions" in manifest) {
    fail(`${store}: block-only DNR must not request host permissions`);
  }
  for (const key of ["key", "update_url"]) {
    if (key in manifest) fail(`${store}: store packages must not contain ${key}`);
  }
  if (!manifest.description?.toLowerCase().includes("companion")) {
    fail(`${store}: description must disclose the desktop companion dependency`);
  }
}

const base = readJson(resolve(extensionDir, "manifest.json"));
assertMinimalManifest(base, "source");

for (const store of ["chrome", "edge", "firefox"]) {
  const storeDir = resolve(distDir, store);
  const files = readdirSync(storeDir).sort();
  const expectedFiles = ["background.js", "icon.png", "manifest.json"];
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    fail(`${store}: package files are ${files.join(", ")}`);
  }

  const manifest = readJson(resolve(storeDir, "manifest.json"));
  assertMinimalManifest(manifest, store);
  if (store === "firefox") {
    const gecko = manifest.browser_specific_settings?.gecko;
    if (gecko?.id !== "focuslock@focuslock.app") fail("firefox: Gecko ID changed");
    if (JSON.stringify(gecko?.data_collection_permissions?.required) !== '["none"]') {
      fail('firefox: data_collection_permissions.required must be ["none"]');
    }
  }

  const background = readFileSync(resolve(storeDir, "background.js"), "utf8");
  const prohibitedCode = [
    ["eval", /\beval\s*\(/],
    ["Function constructor", /\bnew\s+Function\b/],
    ["remote script loader", /\bimportScripts\s*\(/],
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["sendBeacon", /\bsendBeacon\b/],
    ["remote URL", /\bhttps?:\/\//],
  ];
  for (const [label, pattern] of prohibitedCode) {
    if (pattern.test(background)) fail(`${store}: unexpected ${label} in background code`);
  }
}

console.log("OK Extension compliance audit passed");
