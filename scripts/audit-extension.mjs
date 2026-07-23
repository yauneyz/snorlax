#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "apps/extension");
const distDir = resolve(extensionDir, "dist");
const identities = readJson(
  resolve(root, "native/common/extension-identities.json"),
);
const expectedPermissions = ["declarativeNetRequest", "nativeMessaging"];
const expectedHostPermissions = ["<all_urls>"];
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

function fail(message) {
  throw new Error(`Extension compliance audit failed: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertMinimalManifest(manifest, store, expectedKey = null) {
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
  if ("update_url" in manifest) {
    fail(`${store}: packages must not contain update_url`);
  }
  if (expectedKey !== null) {
    if (manifest.key !== expectedKey) {
      fail(`${store}: manifest key must match extension-identities.json`);
    }
  } else if ("key" in manifest) {
    fail(`${store}: package must not contain key`);
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

for (const [store, directory] of Object.entries({
  chrome: "chrome",
  edge: "edge",
  firefox: "firefox",
})) {
  const storeDir = resolve(distDir, directory);
  const files = readdirSync(storeDir).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    fail(`${store}: package files are ${files.join(", ")}`);
  }

  const manifest = readJson(resolve(storeDir, "manifest.json"));
  assertMinimalManifest(
    manifest,
    store,
    store === "chrome" ? identities.chromePublicKey : null,
  );
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
    if (gecko?.id !== identities.firefoxId) {
      fail(`firefox: expected Gecko ID ${identities.firefoxId}, got ${gecko?.id ?? "(missing)"}`);
    }
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

  const background = readFileSync(resolve(storeDir, "background.js"), "utf8");
  if (!background.includes("browserApi.runtime.onStartup.addListener(connect)")) {
    fail(`${store}: background must wake the native connection on browser startup`);
  }
}

const generatedIds = readJson(resolve(distDir, "ids.json"));
if (generatedIds.chrome !== identities.chromeStoreId) {
  fail("chrome: generated ID does not match extension-identities.json");
}
if (generatedIds.edgeDev !== identities.chromeStoreId) {
  fail("edge-dev: generated ID must use the native host's trusted Chrome development identity");
}
if (generatedIds.edgeStore !== (identities.edgeStoreId || null)) {
  fail("edge: generated store ID does not match extension-identities.json");
}

const edgeDevDir = resolve(distDir, "edge-dev");
const edgeDevFiles = readdirSync(edgeDevDir).sort();
if (JSON.stringify(edgeDevFiles) !== JSON.stringify(expectedFiles)) {
  fail(`edge-dev: package files are ${edgeDevFiles.join(", ")}`);
}
const edgeDevManifest = readJson(resolve(edgeDevDir, "manifest.json"));
assertMinimalManifest(edgeDevManifest, "edge-dev", identities.chromePublicKey);
if (edgeDevManifest.background?.service_worker !== "background.js") {
  fail("edge-dev: Chromium service worker background is required");
}

if (process.platform === "darwin") {
  if (generatedIds.safari !== "com.talysman.app.safari") {
    fail("safari: generated app bundle ID changed");
  }
  const safariDir = resolve(distDir, "safari");
  const safariFiles = readdirSync(safariDir).sort();
  if (JSON.stringify(safariFiles) !== JSON.stringify(expectedFiles)) {
    fail(`safari: package files are ${safariFiles.join(", ")}`);
  }
  const manifest = readJson(resolve(safariDir, "manifest.json"));
  const expectedSafariPermissions = [
    "declarativeNetRequestWithHostAccess",
    "nativeMessaging",
  ];
  if (
    JSON.stringify([...(manifest.permissions ?? [])].sort()) !==
    JSON.stringify(expectedSafariPermissions.sort())
  ) {
    fail(`safari: permissions must be exactly ${expectedSafariPermissions.join(", ")}`);
  }
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHostPermissions)) {
    fail("safari: redirect rules require <all_urls> host access");
  }
  if (
    JSON.stringify(manifest.background) !==
    JSON.stringify({ scripts: ["background.js"], persistent: false })
  ) {
    fail("safari: non-persistent background script is required");
  }
  if (
    !existsSync(resolve(distDir, "talysman-safari-" + manifest.version + ".zip")) ||
    !existsSync(resolve(distDir, "safari-appex/Talysman Safari Extension.appex"))
  ) {
    fail("safari: source ZIP or compiled app extension is missing");
  }
} else if (generatedIds.safari !== null) {
  fail("safari: non-macOS builds must omit Safari artifacts");
}

console.log("OK Extension compliance audit passed");
