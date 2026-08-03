#!/usr/bin/env node
/**
 * Set the browser extension to one SemVer, independent of the desktop release version.
 *
 * The extension ships on its own cadence because the browser stores reject a re-upload of an
 * already-published version, so it is not bumped by scripts/set-version.mjs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedVersion = process.argv.slice(2).find((arg) => arg !== "--");
const releaseTypes = new Set(["major", "minor", "patch"]);
const usage =
  "Usage: pnpm bump:extension -- <major|minor|patch>\n   or: pnpm bump:extension -- <semver>";

// manifest.json is authoritative: build-extension.mjs and release-extension.mjs both read it.
const manifests = ["apps/extension/manifest.json", "apps/extension/package.json"];
const versionPattern = /^(  "version": )"([^"]+)"/m;

function readVersion(relative) {
  const match = versionPattern.exec(readFileSync(resolve(root, relative), "utf8"));
  if (!match) throw new Error(`Could not read a top-level version from ${relative}`);
  return match[2];
}

function incrementVersion(version, releaseType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(
      `Cannot ${releaseType}-bump non-stable version ${version}; set the next version explicitly instead.`,
    );
  }

  let [, major, minor, patch] = match.map(Number);
  if (releaseType === "major") [major, minor, patch] = [major + 1, 0, 0];
  if (releaseType === "minor") [minor, patch] = [minor + 1, 0];
  if (releaseType === "patch") patch += 1;
  return `${major}.${minor}.${patch}`;
}

if (!requestedVersion) {
  console.error(usage);
  process.exit(2);
}

const [manifestRelative, packageRelative] = manifests;
const currentVersion = readVersion(manifestRelative);
const packageVersion = readVersion(packageRelative);
if (packageVersion !== currentVersion) {
  console.warn(
    `warning: ${packageRelative} was ${packageVersion} while ${manifestRelative} was ${currentVersion}; bumping from the manifest.`,
  );
}

const version = releaseTypes.has(requestedVersion)
  ? incrementVersion(currentVersion, requestedVersion)
  : requestedVersion;

// Store manifests accept only dot-separated integers, so prerelease suffixes are rejected here
// even though the desktop version scheme allows them.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    `Extension versions must be <major>.<minor>.<patch> with no prerelease suffix; got ${version}.\n${usage}`,
  );
  process.exit(2);
}

for (const relative of manifests) {
  const path = resolve(root, relative);
  const source = readFileSync(path, "utf8");
  const next = source.replace(versionPattern, `$1"${version}"`);
  if (next !== source) writeFileSync(path, next);
  console.log(`${next === source ? "already current" : "updated"} ${relative}`);
}

console.log(`Talysman extension version is now ${version}.`);
