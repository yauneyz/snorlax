#!/usr/bin/env node
/**
 * Build the three browser-store deliverables from the shared extension source.
 *
 * Output:
 *   apps/extension/dist/chrome/                         unpacked Chrome build
 *   apps/extension/dist/edge/                           unpacked Edge build
 *   apps/extension/dist/firefox/                        unpacked Firefox build
 *   apps/extension/dist/talysman-chrome-<version>.zip  Chrome Web Store upload
 *   apps/extension/dist/talysman-edge-<version>.zip    Edge Add-ons upload
 *   apps/extension/dist/talysman-firefox-<version>.zip Firefox AMO upload
 *
 * The stores sign, host, and update the published packages. Store update URLs and store-assigned
 * Chromium IDs therefore do not belong in these manifests. Firefox keeps its authored Gecko ID.
 */

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
const iconPath = resolve(root, "apps/desktop/resources/icon.png");

// This is authored by us and remains stable across AMO versions.
const FIREFOX_ID = "talysman@talysman.app";

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
  manifest.icons = { 128: "icon.png" };
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
  copyFileSync(iconPath, resolve(outputDir, "icon.png"));
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
  { name: "chrome", manifest: chromiumManifest },
  { name: "edge", manifest: chromiumManifest },
  { name: "firefox", manifest: firefoxManifest },
];

const artifacts = [];
for (const store of stores) {
  const unpackedDir = stageStore(store.name, store.manifest, background);
  const zipPath = resolve(distDir, `talysman-${store.name}-${version}.zip`);
  zipDirectory(unpackedDir, zipPath);
  artifacts.push({ ...store, unpackedDir, zipPath });
}

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
console.log(`\nFirefox Gecko ID: ${FIREFOX_ID}`);
console.log(
  "Chrome and Edge IDs are assigned by their stores after the first upload.",
);
