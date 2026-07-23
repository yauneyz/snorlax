#!/usr/bin/env node
/**
 * Build browser-store deliverables from the shared extension source.
 *
 * Output:
 *   apps/extension/dist/chrome/                         Chrome upload + Load-unpacked build
 *   apps/extension/dist/edge/                           Edge Add-ons upload + unpacked inspection
 *   apps/extension/dist/edge-dev/                       stable-ID Edge Load-unpacked build
 *   apps/extension/dist/firefox/                        unpacked Firefox build
 *   apps/extension/dist/talysman-chrome-<version>.zip  Chrome Web Store upload
 *   apps/extension/dist/talysman-edge-<version>.zip    Edge Add-ons upload
 *   apps/extension/dist/talysman-firefox-<version>.zip Firefox AMO upload
 *
 * The stores sign, host, and update the published packages. Store update URLs and store-assigned
 * Chromium update URLs therefore do not belong in these manifests. The Chrome package has the Web
 * Store public manifest `key` from native/common/extension-identities.json, so its ZIP and unpacked
 * directory both use the store ID. Firefox keeps its authored Gecko ID.
 */

import crypto from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = resolve(root, "apps/extension");
const srcDir = resolve(extDir, "src");
const distDir = resolve(extDir, "dist");
const identitiesPath = resolve(
  root,
  "native/common/extension-identities.json",
);
// The stores render the 128px icon; take it straight from the brand kit rather than reusing the
// desktop app's resource, which is sized for window/tray use.
const iconFiles = {
  "icon-16.png": resolve(root, "assets/brand/generated/linux/16x16.png"),
  "icon-32.png": resolve(root, "assets/brand/generated/linux/32x32.png"),
  "icon-48.png": resolve(root, "assets/brand/generated/linux/48x48.png"),
  "icon.png": resolve(root, "assets/brand/generated/linux/128x128.png"),
};
const blockedLogoPath = resolve(root, "assets/brand/source/talysman-mark.svg");
const manifestIcons = {
  16: "icon-16.png",
  32: "icon-32.png",
  48: "icon-48.png",
  128: "icon.png",
};
const extensionFiles = [
  "blocked.html",
  "blocked.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "popup-view.js",
];

const identities = JSON.parse(readFileSync(identitiesPath, "utf8"));
const FIREFOX_ID = identities.firefoxId;

function chromiumId(spkiDer) {
  const hash = crypto.createHash("sha256").update(spkiDer).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0x0f));
  }
  return id;
}

function chromeIdentity() {
  const manifestKey = identities.chromePublicKey;
  const expectedId = identities.chromeStoreId;
  if (typeof manifestKey !== "string" || typeof expectedId !== "string") {
    throw new Error(
      `${relative(root, identitiesPath)} must define chromePublicKey and chromeStoreId`,
    );
  }
  const spkiDer = Buffer.from(manifestKey, "base64");
  crypto.createPublicKey({ key: spkiDer, type: "spki", format: "der" });
  const actualId = chromiumId(spkiDer);
  if (actualId !== expectedId) {
    throw new Error(
      `Chrome Web Store public key derives ${actualId}, but extension-identities.json declares ${expectedId}`,
    );
  }
  return { manifestKey, id: actualId };
}

function bundledBackground() {
  const rules = readFileSync(resolve(srcDir, "rules.js"), "utf8").replace(
    /^export\s+/gm,
    "",
  );
  const background = readFileSync(
    resolve(srcDir, "background.js"),
    "utf8",
  ).replace(/^\s*import\s+\{[^}]*\}\s+from\s+['"]\.\/rules\.js['"];?\s*$/m, "");
  return (
    "// Built by scripts/build-extension.mjs — rules.js + background.js bundled.\n\n" +
    rules +
    "\n" +
    background
  );
}

function storeNeutralManifest(base) {
  const manifest = structuredClone(base);
  delete manifest.background;
  delete manifest.browser_specific_settings;
  delete manifest.update_url;
  delete manifest.key;
  manifest.icons = manifestIcons;
  manifest.action = {
    ...manifest.action,
    // Explicit action icons prevent browsers from falling back to a generic toolbar glyph.
    default_icon: {
      16: manifestIcons[16],
      32: manifestIcons[32],
    },
  };
  return manifest;
}

function stageStore(name, manifest, background) {
  const outputDir = resolve(distDir, name);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    resolve(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  writeFileSync(resolve(outputDir, "background.js"), background);
  for (const [name, source] of Object.entries(iconFiles)) {
    copyFileSync(source, resolve(outputDir, name));
  }
  copyFileSync(blockedLogoPath, resolve(outputDir, "blocked-logo.svg"));
  for (const file of extensionFiles) {
    copyFileSync(resolve(srcDir, file), resolve(outputDir, file));
  }
  return outputDir;
}

function listFiles(dir, base = dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...listFiles(path, base));
    if (stat.isFile())
      files.push({ path, name: relative(base, path).replace(/\\/g, "/") });
  }
  return files;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

/** Write a portable, uncompressed ZIP. Store packages are small, so compression adds no value. */
function zipDirectory(sourceDir, outputPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of listFiles(sourceDir)) {
    const name = Buffer.from(file.name);
    const data = readFileSync(file.path);
    const crc = crc32(data);
    const local = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0x21),
      uint32(crc),
      uint32(data.length),
      uint32(data.length),
      uint16(name.length),
      uint16(0),
      name,
      data,
    ]);
    localParts.push(local);
    centralParts.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(0x031e),
        uint16(20),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0x21),
        uint32(crc),
        uint32(data.length),
        uint32(data.length),
        uint16(name.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(centralParts.length),
    uint16(centralParts.length),
    uint32(central.length),
    uint32(offset),
    uint16(0),
  ]);
  writeFileSync(outputPath, Buffer.concat([...localParts, central, end]));
}

const base = JSON.parse(readFileSync(resolve(extDir, "manifest.json"), "utf8"));
const version = base.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("apps/extension/manifest.json must contain a version");
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const background = bundledBackground();
const chromiumManifest = {
  ...storeNeutralManifest(base),
  background: { service_worker: "background.js" },
};
const { manifestKey: chromeSideloadKey, id: chromeSideloadId } =
  chromeIdentity();
const chromeManifest = {
  ...chromiumManifest,
  key: chromeSideloadKey,
};
const firefoxManifest = storeNeutralManifest(base);
delete firefoxManifest.minimum_chrome_version;
firefoxManifest.browser_specific_settings = {
  gecko: {
    id: FIREFOX_ID,
    strict_min_version: "115.0",
    // Required for new AMO submissions. Talysman does not collect or transmit data for storage
    // or processing outside the extension and the user's local companion application.
    data_collection_permissions: { required: ["none"] },
  },
};
firefoxManifest.background = { scripts: ["background.js"] };

const stores = [
  { name: "chrome", manifest: chromeManifest },
  { name: "edge", manifest: chromiumManifest },
  { name: "firefox", manifest: firefoxManifest },
];

// A key-free unpacked extension gets a path-derived ID. That ID is unsuitable for native
// messaging because every developer checkout would need a different allowed_origins entry. Edge
// accepts Chromium's manifest key when loading an unpacked extension, so use the already-trusted
// Chrome identity for local Edge testing. The Edge Add-ons upload remains key-free and receives its
// production identity from Microsoft.
const edgeDevDir = stageStore("edge-dev", chromeManifest, background);

const artifacts = [];
for (const store of stores) {
  const unpackedDir = stageStore(store.name, store.manifest, background);
  const zipPath = resolve(distDir, `talysman-${store.name}-${version}.zip`);
  zipDirectory(unpackedDir, zipPath);
  artifacts.push({ ...store, unpackedDir, zipPath });
}

writeFileSync(
  resolve(distDir, "ids.json"),
  JSON.stringify(
    {
      chrome: chromeSideloadId,
      edgeDev: chromeSideloadId,
      edgeStore: identities.edgeStoreId || null,
      firefox: FIREFOX_ID,
      safari: null,
    },
    null,
    2,
  ) + "\n",
);

console.log("\nOK Browser store packages built:");
for (const artifact of artifacts) {
  console.log(
    `  ${artifact.name.padEnd(7)} ${relative(root, artifact.zipPath)}`,
  );
}
console.log("\nUnpacked builds for local inspection:");
for (const artifact of artifacts) {
  console.log(
    `  ${artifact.name.padEnd(7)} ${relative(root, artifact.unpackedDir)}`,
  );
}
console.log(
  `  ${"edge-dev".padEnd(7)} ${relative(root, edgeDevDir)} (Load unpacked; stable native-messaging ID)`,
);
console.log(`\nChrome ID (upload + Load unpacked): ${chromeSideloadId}`);
console.log(`Edge development ID: ${chromeSideloadId}`);
console.log(`Firefox Gecko ID: ${FIREFOX_ID}`);
console.log(`Chrome Web Store ID: ${identities.chromeStoreId}`);
console.log(
  `Edge Add-ons ID: ${identities.edgeStoreId || "not assigned yet"}`,
);
