#!/usr/bin/env node
/** Set the desktop application and all privileged service packages to one SemVer. */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedVersion = process.argv.slice(2).find((arg) => arg !== "--");
const releaseTypes = new Set(["major", "minor", "patch"]);

function currentVersion() {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
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
  console.error(
    "Usage: npm run release:bump -- <major|minor|patch>\n   or: pnpm release:version -- <semver>",
  );
  process.exit(2);
}

const version = releaseTypes.has(requestedVersion)
  ? incrementVersion(currentVersion(), requestedVersion)
  : requestedVersion;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(
    "Usage: npm run release:bump -- <major|minor|patch>\n   or: pnpm release:version -- <semver>",
  );
  process.exit(2);
}

for (const relative of ["package.json", "apps/desktop/package.json"]) {
  const path = resolve(root, relative);
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.version = version;
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`updated ${relative}`);
}

const cargoManifests = [
  "native/common/Cargo.toml",
  "native/windows/Cargo.toml",
  "native/linux/Cargo.toml",
  "native/macos/Cargo.toml",
];
for (const relative of cargoManifests) {
  const path = resolve(root, relative);
  const source = readFileSync(path, "utf8");
  const versionPattern = /(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m;
  if (!versionPattern.test(source))
    throw new Error(`Could not update [package].version in ${relative}`);
  const next = source.replace(versionPattern, `$1"${version}"`);
  if (next !== source) writeFileSync(path, next);
  console.log(`${next === source ? "already current" : "updated"} ${relative}`);
}

// Cargo records local package versions in each crate's lockfile. Refresh metadata now so the
// versioning command leaves a fully committable tree and release uploads remain read-only.
for (const relative of cargoManifests) {
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      resolve(root, relative),
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`refreshed ${relative.replace("Cargo.toml", "Cargo.lock")}`);
}

console.log(`Talysman desktop release version is now ${version}.`);
