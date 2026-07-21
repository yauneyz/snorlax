#!/usr/bin/env node
/** Publish a small signed APT repository to the existing release-artifacts bucket. */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import toml from "@iarna/toml";
import {
  artifactIdentity,
  hostingFromCredentials,
  publicUrlFor,
} from "./lib/release-hosting.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const retain = 2;
const signingKey = process.env.APT_SIGNING_KEY_ID;

function commandAvailable(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

for (const command of ["aws", "dpkg-scanpackages", "gpg"]) {
  if (!commandAvailable(command))
    throw new Error(`${command} is required to publish the APT repository.`);
}
if (!signingKey)
  throw new Error(
    "APT_SIGNING_KEY_ID must identify the GPG key used to sign the repository.",
  );

const credentialsPath = [
  join(root, ".credentials"),
  resolve(root, "..", "indigo", ".credentials"),
].find((candidate) => existsSync(candidate));
const hosting =
  process.env.RELEASE_ARTIFACTS_BUCKET && process.env.RELEASE_PUBLIC_BASE_URL
    ? {
        region:
          process.env.AWS_REGION ??
          process.env.AWS_DEFAULT_REGION ??
          "us-east-1",
        bucket: process.env.RELEASE_ARTIFACTS_BUCKET,
        publicBaseUrl: process.env.RELEASE_PUBLIC_BASE_URL,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : credentialsPath
      ? hostingFromCredentials(
          toml.parse(readFileSync(credentialsPath, "utf8")),
        )
      : (() => {
          throw new Error(
            "Missing .credentials or RELEASE_ARTIFACTS_BUCKET/RELEASE_PUBLIC_BASE_URL",
          );
        })();
const awsEnv = { ...process.env, AWS_DEFAULT_REGION: hosting.region };
if (hosting.accessKeyId) awsEnv.AWS_ACCESS_KEY_ID = hosting.accessKeyId;
if (hosting.secretAccessKey)
  awsEnv.AWS_SECRET_ACCESS_KEY = hosting.secretAccessKey;

function aws(args, capture = false) {
  return execFileSync("aws", args, {
    env: awsEnv,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function upload(path, key, cacheControl) {
  console.log(`upload ${basename(path)} -> s3://${hosting.bucket}/${key}`);
  aws([
    "s3",
    "cp",
    path,
    `s3://${hosting.bucket}/${key}`,
    "--content-type",
    key.endsWith(".gz")
      ? "application/gzip"
      : key.endsWith("InRelease") || key.endsWith("Release")
        ? "text/plain; charset=utf-8"
        : "application/octet-stream",
    "--cache-control",
    cacheControl,
    "--metadata",
    `sha256=${digest(path)}`,
    "--checksum-algorithm",
    "SHA256",
    "--no-progress",
  ]);
}

function listPool() {
  const raw = aws(
    [
      "s3api",
      "list-objects-v2",
      "--bucket",
      hosting.bucket,
      "--prefix",
      "apt/pool/main/t/talysman/",
      "--output",
      "json",
    ],
    true,
  );
  return JSON.parse(raw).Contents ?? [];
}

function packageIdentityFromKey(key) {
  return artifactIdentity(key.split("/").pop() ?? "");
}

const candidates = readdirSync(distDir)
  .map((name) => ({ name, identity: artifactIdentity(name) }))
  .filter((item) => item.identity?.platform === "linux");
if (candidates.length === 0)
  throw new Error(`No Talysman DEB found in ${distDir}`);
const current = candidates.sort(
  (a, b) =>
    statSync(join(distDir, b.name)).mtimeMs -
    statSync(join(distDir, a.name)).mtimeMs,
)[0];
const architecture =
  current.identity.arch === "x64" ? "amd64" : current.identity.arch;

const workspace = mkdtempSync(join(tmpdir(), "talysman-apt-"));
try {
  const poolDir = join(workspace, "pool/main/t/talysman");
  const packagesDir = join(
    workspace,
    `dists/stable/main/binary-${architecture}`,
  );
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(packagesDir, { recursive: true });
  copyFileSync(join(distDir, current.name), join(poolDir, current.name));

  const existing = listPool()
    .map((object) => ({
      ...object,
      identity: packageIdentityFromKey(object.Key),
    }))
    .filter(
      (object) =>
        object.identity?.arch === current.identity.arch &&
        object.identity.version !== current.identity.version,
    )
    .sort((a, b) => Date.parse(b.LastModified) - Date.parse(a.LastModified))
    .slice(0, retain - 1);
  for (const object of existing) {
    aws([
      "s3",
      "cp",
      `s3://${hosting.bucket}/${object.Key}`,
      join(poolDir, basename(object.Key)),
      "--no-progress",
    ]);
  }

  const packages = execFileSync(
    "dpkg-scanpackages",
    ["--multiversion", "pool/main/t/talysman"],
    { cwd: workspace, encoding: "utf8" },
  );
  const packagesPath = join(packagesDir, "Packages");
  const packagesGzPath = `${packagesPath}.gz`;
  writeFileSync(packagesPath, packages);
  writeFileSync(packagesGzPath, gzipSync(packages, { level: 9 }));

  const releaseEntries = [packagesPath, packagesGzPath].map((path) => {
    const relative = path.slice(`${join(workspace, "dists/stable")}/`.length);
    return ` ${digest(path)} ${statSync(path).size} ${relative}`;
  });
  const releasePath = join(workspace, "dists/stable/Release");
  writeFileSync(
    releasePath,
    [
      "Origin: Talysman",
      "Label: Talysman",
      "Suite: stable",
      "Codename: stable",
      `Date: ${new Date().toUTCString()}`,
      `Architectures: ${architecture}`,
      "Components: main",
      "Acquire-By-Hash: yes",
      "Description: Talysman desktop application repository",
      "SHA256:",
      ...releaseEntries,
      "",
    ].join("\n"),
  );

  const gpgArgs = ["--batch", "--yes", "--local-user", signingKey];
  if (process.env.APT_SIGNING_KEY_PASSPHRASE) {
    gpgArgs.push(
      "--pinentry-mode",
      "loopback",
      "--passphrase",
      process.env.APT_SIGNING_KEY_PASSPHRASE,
    );
  }
  execFileSync("gpg", [
    ...gpgArgs,
    "--clearsign",
    "--output",
    join(workspace, "dists/stable/InRelease"),
    releasePath,
  ]);
  const keyringPath = join(workspace, "talysman-archive-keyring.gpg");
  const publicKey = execFileSync("gpg", ["--batch", "--export", signingKey]);
  writeFileSync(keyringPath, publicKey);

  const poolKey = `apt/pool/main/t/talysman/${current.name}`;
  upload(
    join(poolDir, current.name),
    poolKey,
    "public,max-age=31536000,immutable",
  );
  upload(
    keyringPath,
    "apt/talysman-archive-keyring.gpg",
    "no-cache,max-age=0,must-revalidate",
  );

  // APT clients holding the previous InRelease fetch these content-addressed indexes, so the
  // canonical Packages files can change without producing a checksum race during promotion.
  const byHashPublications = [packagesPath, packagesGzPath].map((path) => ({
    path,
    key: `apt/dists/stable/main/binary-${architecture}/by-hash/SHA256/${digest(path)}`,
  }));
  for (const publication of byHashPublications) {
    upload(
      publication.path,
      publication.key,
      "public,max-age=31536000,immutable",
    );
  }
  upload(
    packagesPath,
    `apt/dists/stable/main/binary-${architecture}/Packages`,
    "no-cache,max-age=0,must-revalidate",
  );
  upload(
    packagesGzPath,
    `apt/dists/stable/main/binary-${architecture}/Packages.gz`,
    "no-cache,max-age=0,must-revalidate",
  );
  upload(
    releasePath,
    "apt/dists/stable/Release",
    "no-cache,max-age=0,must-revalidate",
  );
  // InRelease is the signed mutable pointer and is promoted last.
  upload(
    join(workspace, "dists/stable/InRelease"),
    "apt/dists/stable/InRelease",
    "no-cache,max-age=0,must-revalidate",
  );

  for (const key of [
    poolKey,
    ...byHashPublications.map(({ key }) => key),
    "apt/dists/stable/InRelease",
  ]) {
    const response = await fetch(
      `${publicUrlFor(hosting.publicBaseUrl, key)}?verify=${Date.now()}`,
      { method: "HEAD", cache: "no-store" },
    );
    if (!response.ok)
      throw new Error(
        `${key} is not publicly readable (HTTP ${response.status})`,
      );
  }

  const keep = new Set([
    current.identity.version,
    ...existing.map((item) => item.identity.version),
  ]);
  for (const object of listPool()) {
    const identity = packageIdentityFromKey(object.Key);
    if (
      identity &&
      identity.arch === current.identity.arch &&
      !keep.has(identity.version)
    ) {
      console.log(`prune old APT package s3://${hosting.bucket}/${object.Key}`);
      aws([
        "s3api",
        "delete-object",
        "--bucket",
        hosting.bucket,
        "--key",
        object.Key,
      ]);
    }
  }

  const byHashPrefix = `apt/dists/stable/main/binary-${architecture}/by-hash/SHA256/`;
  const currentByHash = new Set(byHashPublications.map(({ key }) => key));
  const byHashObjects =
    JSON.parse(
      aws(
        [
          "s3api",
          "list-objects-v2",
          "--bucket",
          hosting.bucket,
          "--prefix",
          byHashPrefix,
          "--output",
          "json",
        ],
        true,
      ),
    ).Contents ?? [];
  const keepByHash = new Set([
    ...currentByHash,
    ...byHashObjects
      .filter((object) => !currentByHash.has(object.Key))
      .sort((a, b) => Date.parse(b.LastModified) - Date.parse(a.LastModified))
      .slice(0, 2)
      .map((object) => object.Key),
  ]);
  for (const object of byHashObjects) {
    if (!keepByHash.has(object.Key)) {
      console.log(`prune old APT index s3://${hosting.bucket}/${object.Key}`);
      aws([
        "s3api",
        "delete-object",
        "--bucket",
        hosting.bucket,
        "--key",
        object.Key,
      ]);
    }
  }
  console.log(
    `APT stable now publishes ${[...keep].join(", ")} for ${architecture}.`,
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
