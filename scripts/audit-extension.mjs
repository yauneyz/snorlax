#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PREMADE_RULESETS } from "../apps/extension/src/premade-rulesets.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "apps/extension");
const distDir = resolve(extensionDir, "dist");
const identities = readJson(
  resolve(root, "native/common/extension-identities.json"),
);
const expectedPermissions = [
  "declarativeNetRequest",
  "nativeMessaging",
  "scripting",
  // Firefox for Android: the pairing code for the Talysman app's loopback bridge.
  "storage",
  "tabs",
  "webNavigation",
];
const expectedHostPermissions = ["<all_urls>"];
const MAX_RULESET_BYTES = 5_000_000;
const MAX_STATIC_RULESETS = 50;
const MAX_ENABLED_STATIC_RULESETS = 10;
const expectedFiles = [
  "background.js",
  "blocked-logo.svg",
  "blocked.css",
  "blocked.html",
  "blocked.js",
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
  "icon.png",
  "manifest.json",
  "popup-view.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "premade-lists",
  "site-content.js",
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

function assertPremadeRulesets(manifest, resourcesDir, store) {
  const resources = manifest.declarative_net_request?.rule_resources;
  if (!Array.isArray(resources) || resources.length === 0) {
    fail(`${store}: premade static rulesets are required`);
  }
  if (resources.length > MAX_STATIC_RULESETS) {
    fail(`${store}: ${resources.length} rulesets exceed the ${MAX_STATIC_RULESETS} declared limit`);
  }
  // Any category combination can touch every packed container.
  if (resources.length > MAX_ENABLED_STATIC_RULESETS) {
    fail(`${store}: category mixtures can exceed ${MAX_ENABLED_STATIC_RULESETS} enabled rulesets`);
  }
  if (resources.some((resource) => resource.enabled !== false)) {
    fail(`${store}: premade rulesets must start disabled until the daemon pushes policy`);
  }

  const resourceIds = resources.map((resource) => resource.id);
  if (new Set(resourceIds).size !== resourceIds.length) fail(`${store}: duplicate ruleset ids`);
  if (JSON.stringify([...resourceIds].sort()) !== JSON.stringify(Object.keys(PREMADE_RULESETS.rulesets).sort())) {
    fail(`${store}: manifest rulesets do not match premade-rulesets.js`);
  }

  const expectedFiles = new Set();
  const actualIdsByRuleset = {};
  for (const resource of resources) {
    const relativePath = resource.path;
    if (!/^premade-lists\/premade\.\d+\.json$/.test(relativePath)) {
      fail(`${store}: invalid premade ruleset path ${relativePath}`);
    }
    expectedFiles.add(relativePath.slice('premade-lists/'.length));
    const filePath = resolve(resourcesDir, relativePath);
    const size = statSync(filePath, { throwIfNoEntry: false })?.size;
    if (typeof size !== 'number') fail(`${store}: missing ${relativePath}`);
    if (size >= MAX_RULESET_BYTES) {
      fail(`${store}: ${relativePath} is ${size} bytes; AMO requires files below 5MB`);
    }
    const rules = readJson(filePath);
    for (const rule of rules) {
      const domains = [
        ...(rule.condition?.requestDomains ?? []),
        ...(rule.condition?.excludedRequestDomains ?? []),
      ];
      if (domains.some((domain) => [...domain].some((character) => character.charCodeAt(0) > 127))) {
        fail(`${store}: ${relativePath} contains a non-ASCII DNR domain`);
      }
    }
    const ids = rules.map((rule) => rule.id);
    if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      fail(`${store}: ${relativePath} has invalid or duplicate rule ids`);
    }
    actualIdsByRuleset[resource.id] = ids;
    if (JSON.stringify(ids) !== JSON.stringify(PREMADE_RULESETS.rulesets[resource.id])) {
      fail(`${store}: ${resource.id} ids do not match premade-rulesets.js`);
    }
  }

  const files = readdirSync(resolve(resourcesDir, 'premade-lists')).filter((file) => file.endsWith('.json'));
  if (JSON.stringify(files.sort()) !== JSON.stringify([...expectedFiles].sort())) {
    fail(`${store}: packaged premade files do not exactly match the manifest`);
  }

  const assigned = Object.fromEntries(resourceIds.map((rulesetId) => [rulesetId, new Set()]));
  for (const [listId, byRuleset] of Object.entries(PREMADE_RULESETS.ruleIdsByList)) {
    if (Object.keys(byRuleset).length === 0) fail(`${store}: ${listId} has no generated rules`);
    for (const [rulesetId, ruleIds] of Object.entries(byRuleset)) {
      if (!assigned[rulesetId]) fail(`${store}: ${listId} references unknown ${rulesetId}`);
      for (const ruleId of ruleIds) {
        if (!actualIdsByRuleset[rulesetId].includes(ruleId)) {
          fail(`${store}: ${listId} references missing rule ${rulesetId}:${ruleId}`);
        }
        if (assigned[rulesetId].has(ruleId)) {
          fail(`${store}: ${rulesetId}:${ruleId} belongs to multiple categories`);
        }
        assigned[rulesetId].add(ruleId);
      }
    }
  }
  for (const rulesetId of resourceIds) {
    if (assigned[rulesetId].size !== actualIdsByRuleset[rulesetId].length) {
      fail(`${store}: ${rulesetId} contains rules with no category mapping`);
    }
  }
}

const base = readJson(resolve(extensionDir, "manifest.json"));
assertMinimalManifest(base, "source");
assertPremadeRulesets(base, resolve(extensionDir, "resources"), "source");
const version = base.version;
if (typeof version !== "string" || version.length === 0) {
  fail("source: manifest version is required");
}

for (const [store, directory] of Object.entries({
  chrome: "chrome",
  edge: "edge",
  firefox: "firefox",
})) {
  const sourceArchive = resolve(
    distDir,
    `talysman-${store}-source-${version}.zip`,
  );
  if (!statSync(sourceArchive, { throwIfNoEntry: false })?.isFile()) {
    fail(`${store}: source archive is missing`);
  }

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
  assertPremadeRulesets(manifest, storeDir, store);
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
    "blocked.js",
    "popup.js",
    "popup-view.js",
    "popup.html",
    "popup.css",
    "site-content.js",
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
  // Packaged code contains no remote URL and no programmatic network client. The one exception is
  // Firefox's loopback socket to the Talysman Android app on the same phone (Firefox for Android
  // has no native messaging): exactly this URL, opened in exactly one place.
  let auditedText = packagedText;
  if (store === "firefox") {
    const loopbackUrl = "const LOOPBACK_URL = 'ws://127.0.0.1:47623';";
    const loopbackOpen = "new WebSocket(LOOPBACK_URL)";
    if (!packagedText.includes(loopbackUrl) || packagedText.split(loopbackOpen).length !== 2) {
      fail("firefox: the Android loopback socket must be the single `new WebSocket(LOOPBACK_URL)` to 127.0.0.1");
    }
    auditedText = packagedText.replace(loopbackUrl, "").replace(loopbackOpen, "");
  }
  for (const [label, pattern] of prohibitedCode) {
    if (pattern.test(auditedText)) fail(`${store}: unexpected ${label} in packaged code`);
  }
  if (/\bwss?:\/\//.test(auditedText)) fail(`${store}: unexpected WebSocket URL in packaged code`);

  // The bundles concatenate source modules into one scope (scripts/build-extension.mjs). A
  // repeated top-level function silently replaces the earlier one, so reject any collision.
  for (const bundle of ["background.js", "site-content.js"]) {
    const names = [...readFileSync(resolve(storeDir, bundle), "utf8").matchAll(
      /^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
    )].map((match) => match[1]);
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) fail(`${store}: ${bundle} declares ${duplicate} twice at top level`);
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

console.log("OK Extension compliance audit passed");
