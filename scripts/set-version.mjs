#!/usr/bin/env node
/** Set the desktop application and all privileged service packages to one SemVer. */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedVersion = process.argv.slice(2).find((arg) => arg !== "--");
const releaseTypes = new Set(["major", "minor", "patch"]);
const usage =
  "Usage: pnpm release:bump -- <major|minor|patch>\n   or: pnpm release:version -- <semver>";

const jsonPackages = ["package.json", "apps/desktop/package.json"];
const nativeRoot = resolve(root, "native");
const cargoManifests = readdirSync(nativeRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(resolve(nativeRoot, entry.name, "Cargo.toml")),
  )
  .map((entry) => `native/${entry.name}/Cargo.toml`)
  .sort();

function cargoPackage(source, relative) {
  const packageBlock = source.match(
    /^\[package\][ \t]*\r?\n([\s\S]*?)(?=^\[[^\r\n]+\][ \t]*\r?$|(?![\s\S]))/m,
  )?.[1];
  const name = packageBlock?.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const version = packageBlock?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!name || !version) {
    throw new Error(`Could not read [package] name/version from ${relative}`);
  }
  return { name, version };
}

function localLockPackageVersion(source, packageName) {
  const matches = source
    .split(/(?=^\[\[package\]\]\s*$)/m)
    .filter(
      (block) =>
        block.startsWith("[[package]]") &&
        block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1] === packageName &&
        !/^source\s*=/m.test(block),
    );
  if (matches.length > 1) {
    throw new Error(`Found multiple local ${packageName} entries in a Cargo.lock`);
  }
  return matches[0]?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? null;
}

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
  console.error(usage);
  process.exit(2);
}

const version = releaseTypes.has(requestedVersion)
  ? incrementVersion(currentVersion(), requestedVersion)
  : requestedVersion;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(usage);
  process.exit(2);
}

for (const relative of jsonPackages) {
  const path = resolve(root, relative);
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.version = version;
  const source = readFileSync(path, "utf8");
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (next !== source) writeFileSync(path, next);
  console.log(`${next === source ? "already current" : "updated"} ${relative}`);
}

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

const localPackageNames = cargoManifests.map((relative) =>
  cargoPackage(readFileSync(resolve(root, relative), "utf8"), relative).name,
);

// `cargo metadata --no-deps` does not refresh local package versions in Cargo.lock. Update only the
// repository's path packages, offline, so third-party dependency versions cannot drift during a
// release bump.
for (const relative of cargoManifests) {
  const lockRelative = relative.replace("Cargo.toml", "Cargo.lock");
  const lockPath = resolve(root, lockRelative);
  if (!existsSync(lockPath)) throw new Error(`Missing ${lockRelative}`);

  const lockSource = readFileSync(lockPath, "utf8");
  const packagesInLock = localPackageNames.filter(
    (packageName) => localLockPackageVersion(lockSource, packageName) !== null,
  );
  const ownPackage = cargoPackage(
    readFileSync(resolve(root, relative), "utf8"),
    relative,
  ).name;
  if (!packagesInLock.includes(ownPackage)) {
    throw new Error(`${lockRelative} does not contain local package ${ownPackage}`);
  }

  execFileSync(
    "cargo",
    [
      "update",
      "--offline",
      "--manifest-path",
      resolve(root, relative),
      ...packagesInLock.flatMap((packageName) => ["--package", packageName]),
    ],
    { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
  );
  console.log(`refreshed ${lockRelative}`);
}

// Refuse to report success unless every release-bearing package and every local lock entry agrees.
for (const relative of jsonPackages) {
  const actual = JSON.parse(readFileSync(resolve(root, relative), "utf8")).version;
  if (actual !== version) throw new Error(`${relative} is ${actual}; expected ${version}`);
}
for (const relative of cargoManifests) {
  const manifestPackage = cargoPackage(
    readFileSync(resolve(root, relative), "utf8"),
    relative,
  );
  if (manifestPackage.version !== version) {
    throw new Error(`${relative} is ${manifestPackage.version}; expected ${version}`);
  }

  const lockRelative = relative.replace("Cargo.toml", "Cargo.lock");
  const lockSource = readFileSync(resolve(root, lockRelative), "utf8");
  for (const packageName of localPackageNames) {
    const lockedVersion = localLockPackageVersion(lockSource, packageName);
    if (lockedVersion !== null && lockedVersion !== version) {
      throw new Error(
        `${lockRelative} has ${packageName} ${lockedVersion}; expected ${version}`,
      );
    }
  }
}

console.log(`Talysman desktop release version is now ${version}.`);
