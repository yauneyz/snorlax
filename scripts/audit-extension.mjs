#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "apps/extension");
const distDir = resolve(extensionDir, "dist");
const expectedPermissions = ["declarativeNetRequest", "nativeMessaging"];
const expectedHostPermissions = ["<all_urls>"];

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
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHostPermissions)) {
    fail(`${store}: redirect rules require exactly ${expectedHostPermissions.join(", ")}`);
  }
  if ("optional_host_permissions" in manifest) {
    fail(`${store}: optional host permissions are not used`);
  }
  for (const key of ["key", "update_url"]) {
    if (key in manifest) fail(`${store}: store packages must not contain ${key}`);
  }
  if (!manifest.description?.toLowerCase().includes("companion")) {
    fail(`${store}: description must disclose the desktop companion dependency`);
  }
  if (manifest.action?.default_popup !== "popup.html") {
    fail(`${store}: action must expose the read-only status popup`);
  }
}

const base = readJson(resolve(extensionDir, "manifest.json"));
assertMinimalManifest(base, "source");

for (const store of ["chrome", "edge", "firefox"]) {
  const storeDir = resolve(distDir, store);
  const files = readdirSync(storeDir).sort();
  const expectedFiles = [
    "background.js",
    "blocked-logo.svg",
    "blocked.css",
    "blocked.html",
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
    "icon.png",
    "manifest.json",
    "popup-view.js",
    "popup.css",
    "popup.html",
    "popup.js",
  ];
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    fail(`${store}: package files are ${files.join(", ")}`);
  }

  const manifest = readJson(resolve(storeDir, "manifest.json"));
  assertMinimalManifest(manifest, store);
  const expectedActionIcons = { 16: "icon-16.png", 32: "icon-32.png" };
  if (JSON.stringify(manifest.action?.default_icon) !== JSON.stringify(expectedActionIcons)) {
    fail(`${store}: toolbar action must use the packaged Talysman icons`);
  }
  const accessible = manifest.web_accessible_resources?.[0];
  const expectedResources = ["blocked.html"];
  if (
    JSON.stringify(accessible?.resources) !== JSON.stringify(expectedResources) ||
    JSON.stringify(accessible?.matches) !== JSON.stringify(["<all_urls>"])
  ) {
    fail(`${store}: the local blocked page must be web accessible to redirect rules`);
  }
  if (store === "firefox") {
    const gecko = manifest.browser_specific_settings?.gecko;
    if (gecko?.id !== "talysman@talysman.app") fail("firefox: Gecko ID changed");
    if (JSON.stringify(gecko?.data_collection_permissions?.required) !== '["none"]') {
      fail('firefox: data_collection_permissions.required must be ["none"]');
    }
  }

  const packagedText = [
    "background.js",
    "blocked.html",
    "blocked.css",
    "popup.js",
    "popup-view.js",
    "popup.html",
    "popup.css",
  ]
    .map((file) => readFileSync(resolve(storeDir, file), "utf8"))
    .join("\n");
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
    if (pattern.test(packagedText)) fail(`${store}: unexpected ${label} in packaged code`);
  }
}

console.log("OK Extension compliance audit passed");
