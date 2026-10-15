#!/usr/bin/env node
/**
 * Build, publish, and verify desktop releases.
 *
 * Website installers retain stable aliases under app/ (one per package kind: Linux publishes
 * deb, rpm and pacman). Updater feeds use versioned, immutable artifacts under
 * desktop/<os>/<arch>/ with the latest*.yml pointer uploaded last. Two generations are retained by default so a client holding the immediately previous
 * metadata never races deletion during promotion.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import toml from "@iarna/toml";

import { appleReleaseEnvironment } from "./lib/apple-release.mjs";
import { windowsReleaseEnvironment } from "./lib/windows-release.mjs";
import {
  assertLiveStripeRelease,
  desktopStripeReleaseIssues,
  liveStripeCredentialIssues,
} from "./lib/stripe-mode.mjs";
import {
  BUILD_SCRIPTS,
  INSTALLERS,
  INSTALLER_KINDS,
  PLATFORMS,
  STABLE_INSTALLER_KEYS,
  UPDATE_METADATA_FILES,
  aptSigningFromCredentials,
  artifactIdentity,
  buildablePlatformsForHost,
  contentTypeForFile,
  hostingFromCredentials,
  metadataArtifactNames,
  platformsForHost,
  publicUrlFor,
  kindsForPlatform,
  selectArtifacts,
  updateFeedPrefixes,
} from "./lib/release-hosting.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verifyOnly = args.includes("--verify-only");
const noBuild = args.includes("--no-build");
const requireFlagIndex = args.indexOf("--require");
const retainFlagIndex = args.indexOf("--retain");
const retainedGenerations = Number(
  retainFlagIndex === -1 ? 2 : args[retainFlagIndex + 1],
);
const requiredPlatforms =
  requireFlagIndex === -1
    ? []
    : (args[requireFlagIndex + 1] ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

if (
  !Number.isInteger(retainedGenerations) ||
  retainedGenerations < 1 ||
  retainedGenerations > 5
) {
  throw new Error("--retain must be an integer between 1 and 5");
}
for (const platform of requiredPlatforms) {
  if (!PLATFORMS.includes(platform))
    throw new Error(`Unknown platform in --require: ${platform}`);
}

const credentialsCandidates = [
  join(root, ".credentials"),
  resolve(root, "..", "indigo", ".credentials"),
];

function localCredentials() {
  const source = credentialsCandidates.find((candidate) => existsSync(candidate));
  return source ? toml.parse(readFileSync(source, "utf8")) : null;
}

function loadHosting() {
  if (
    process.env.RELEASE_ARTIFACTS_BUCKET &&
    process.env.RELEASE_PUBLIC_BASE_URL
  ) {
    return {
      region:
        process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
      bucket: process.env.RELEASE_ARTIFACTS_BUCKET,
      publicBaseUrl: process.env.RELEASE_PUBLIC_BASE_URL,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }
  const source = credentialsCandidates.find((candidate) =>
    existsSync(candidate),
  );
  if (!source)
    throw new Error(
      `Missing .credentials. Checked:\n${credentialsCandidates.join("\n")}`,
    );
  return hostingFromCredentials(toml.parse(readFileSync(source, "utf8")));
}

/**
 * Publishing is a production target, so it needs a complete live Stripe configuration.
 * Installers built here are already gated by scripts/build.mjs; this also covers
 * --no-build uploads of artifacts staged earlier.
 */
function assertLiveStripeForPublish() {
  const source = credentialsCandidates.find((candidate) => existsSync(candidate));
  const issues = source
    ? liveStripeCredentialIssues(toml.parse(readFileSync(source, "utf8")).stripe ?? {})
    : desktopStripeReleaseIssues(process.env);
  assertLiveStripeRelease(issues, { surface: "published desktop release artifacts" });
}

function awsEnvironment(hosting) {
  const env = { ...process.env, AWS_DEFAULT_REGION: hosting.region };
  if (hosting.accessKeyId) env.AWS_ACCESS_KEY_ID = hosting.accessKeyId;
  if (hosting.secretAccessKey)
    env.AWS_SECRET_ACCESS_KEY = hosting.secretAccessKey;
  return env;
}

function runAws(hosting, commandArgs, options = {}) {
  return execFileSync("aws", commandArgs, {
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: awsEnvironment(hosting),
  });
}

function buildHostInstallers(platforms, env = process.env) {
  for (const platform of platforms) {
    if (dryRun) {
      console.log(`[dry run] would run pnpm ${BUILD_SCRIPTS[platform]}`);
    } else {
      execFileSync("pnpm", ["run", BUILD_SCRIPTS[platform]], {
        cwd: root,
        env,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
    }
  }
}

function assertAwsCliAvailable() {
  if (spawnSync("aws", ["--version"], { stdio: "ignore" }).status !== 0) {
    throw new Error("The aws CLI is required to publish release artifacts.");
  }
}

function assertAptPublishingReady() {
  const source = credentialsCandidates.find((candidate) =>
    existsSync(candidate),
  );
  const signing = aptSigningFromCredentials(
    source ? toml.parse(readFileSync(source, "utf8")) : null,
  );
  if (!signing) {
    throw new Error(
      "APT_SIGNING_KEY_ID (or [apt].signing_key_id in .credentials) is required: Linux release:upload also promotes the signed APT repository.",
    );
  }
  const signingKey = signing.keyId;
  for (const command of ["dpkg-scanpackages", "gpg"]) {
    if (spawnSync(command, ["--version"], { stdio: "ignore" }).status !== 0) {
      throw new Error(`${command} is required for a Linux production release.`);
    }
  }
  if (
    spawnSync("gpg", ["--batch", "--list-secret-keys", signingKey], {
      stdio: "ignore",
    }).status !== 0
  ) {
    throw new Error(
      `APT signing key ${signingKey} is not available in the GPG secret keyring.`,
    );
  }
}

function publishAptRepository() {
  console.log("promote signed APT repository");
  execFileSync(process.execPath, [join(root, "scripts/publish-apt-repo.mjs")], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function uploadFile(hosting, source, key, { cacheControl }) {
  const sizeMb = (statSync(source).size / (1024 * 1024)).toFixed(1);
  console.log(
    `upload ${source.replace(`${distDir}/`, "")} (${sizeMb} MB) -> s3://${hosting.bucket}/${key}`,
  );
  if (dryRun) return;
  runAws(hosting, [
    "s3",
    "cp",
    source,
    `s3://${hosting.bucket}/${key}`,
    "--region",
    hosting.region,
    "--content-type",
    contentTypeForFile(source),
    "--cache-control",
    cacheControl,
    "--metadata",
    `sha256=${sha256(source)}`,
    "--checksum-algorithm",
    "SHA256",
    "--no-progress",
  ]);
}

async function checkUrl(url, expectedSize = null) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    return {
      ok:
        response.ok &&
        (expectedSize === null || contentLength === expectedSize),
      status: response.status,
      contentLength,
    };
  } catch (error) {
    return { ok: false, status: 0, contentLength: 0, error: String(error) };
  }
}

async function verifyObject(hosting, key, source = null) {
  const url = `${publicUrlFor(hosting.publicBaseUrl, key)}?verify=${Date.now()}`;
  const expectedSize = source ? statSync(source).size : null;
  const result = await checkUrl(url, expectedSize);
  if (!result.ok) {
    throw new Error(
      `${key} failed verification (HTTP ${result.status}, ${result.contentLength} bytes)`,
    );
  }
  console.log(`verified ${key} (${result.contentLength} bytes)`);
}

function metadataVersion(source) {
  return source.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1] ?? null;
}

/** Publishes one platform's feed (and its legacy mirrors); returns one publication per prefix. */
async function publishUpdateFeed(hosting, platform, installer) {
  const metadataName = UPDATE_METADATA_FILES[platform];
  if (!metadataName) return [];
  const identity = artifactIdentity(installer.name);
  if (!identity)
    throw new Error(`Cannot derive update identity from ${installer.name}`);

  const metadataPath = join(distDir, metadataName);
  if (!existsSync(metadataPath))
    throw new Error(`${metadataName} was not generated for ${installer.name}`);
  const metadata = readFileSync(metadataPath, "utf8");
  if (metadataVersion(metadata) !== identity.version) {
    throw new Error(`${metadataName} does not describe ${identity.version}`);
  }

  const referenced = metadataArtifactNames(metadata);
  if (referenced.length === 0)
    throw new Error(`${metadataName} contains no update artifacts`);
  const artifactNames = new Set(referenced);
  for (const name of referenced) {
    if (existsSync(join(distDir, `${name}.blockmap`)))
      artifactNames.add(`${name}.blockmap`);
  }
  for (const name of artifactNames) {
    if (!existsSync(join(distDir, name)))
      throw new Error(`${metadataName} references missing ${name}`);
  }

  const publications = [];
  for (const prefix of updateFeedPrefixes(platform, identity.arch)) {
    for (const name of artifactNames) {
      uploadFile(hosting, join(distDir, name), `${prefix}/${name}`, {
        cacheControl: "public,max-age=31536000,immutable",
      });
    }
    // The mutable pointer is deliberately last.
    uploadFile(hosting, metadataPath, `${prefix}/${metadataName}`, {
      cacheControl: "no-cache,max-age=0,must-revalidate",
    });

    if (!dryRun) {
      for (const name of artifactNames)
        await verifyObject(hosting, `${prefix}/${name}`, join(distDir, name));
      await verifyObject(hosting, `${prefix}/${metadataName}`, metadataPath);
    }
    publications.push({ prefix, platform, version: identity.version, metadataName });
  }
  return publications;
}

function versionFromUpdateKey(key) {
  const basename =
    key
      .split("/")
      .pop()
      ?.replace(/\.blockmap$/, "") ?? "";
  return (
    basename.match(
      /^Talysman(?:-Setup)?-(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)-/,
    )?.[1] ?? null
  );
}

function listPrefix(hosting, prefix) {
  const output = runAws(
    hosting,
    [
      "s3api",
      "list-objects-v2",
      "--bucket",
      hosting.bucket,
      "--prefix",
      `${prefix}/`,
      "--output",
      "json",
    ],
    { capture: true },
  );
  return JSON.parse(output).Contents ?? [];
}

function pruneUpdateFeed(hosting, publication) {
  if (dryRun) return;
  const objects = listPrefix(hosting, publication.prefix);
  const generations = new Map();
  for (const object of objects) {
    const version = versionFromUpdateKey(object.Key);
    if (!version) continue;
    const timestamp = Date.parse(object.LastModified ?? "") || 0;
    generations.set(
      version,
      Math.max(generations.get(version) ?? 0, timestamp),
    );
  }
  const keep = new Set(
    [...generations.entries()]
      .sort((a, b) =>
        a[0] === publication.version
          ? -1
          : b[0] === publication.version
            ? 1
            : b[1] - a[1],
      )
      .slice(0, retainedGenerations)
      .map(([version]) => version),
  );
  for (const object of objects) {
    const version = versionFromUpdateKey(object.Key);
    if (!version || keep.has(version)) continue;
    console.log(
      `prune old update artifact s3://${hosting.bucket}/${object.Key}`,
    );
    runAws(hosting, [
      "s3api",
      "delete-object",
      "--bucket",
      hosting.bucket,
      "--key",
      object.Key,
    ]);
  }
  console.log(
    `retained ${[...keep].join(", ") || publication.version} under ${publication.prefix}`,
  );
}

function uploadStableInstaller(hosting, kind, artifact) {
  uploadFile(
    hosting,
    join(distDir, artifact.name),
    STABLE_INSTALLER_KEYS[kind],
    {
      cacheControl: "no-cache,max-age=0,must-revalidate",
    },
  );
}

async function verifyStableInstallers(hosting, uploaded) {
  for (const kind of INSTALLER_KINDS) {
    const artifact = uploaded[kind];
    const required =
      requiredPlatforms.includes(INSTALLERS[kind].platform) || Boolean(artifact);
    const source = artifact ? join(distDir, artifact.name) : null;
    const result = await checkUrl(
      `${publicUrlFor(hosting.publicBaseUrl, STABLE_INSTALLER_KEYS[kind])}?verify=${Date.now()}`,
      source ? statSync(source).size : null,
    );
    if (!result.ok && required)
      throw new Error(
        `${kind} stable installer is unavailable (HTTP ${result.status})`,
      );
    console.log(
      result.ok
        ? `verified ${kind} stable installer`
        : `${kind} is not published yet`,
    );
  }
}

async function verifyExistingFeeds(hosting) {
  const objects = listPrefix(hosting, "desktop");
  for (const object of objects.filter((item) =>
    Object.values(UPDATE_METADATA_FILES).some((name) =>
      item.Key.endsWith(`/${name}`),
    ),
  )) {
    await verifyObject(hosting, object.Key);
    const response = await fetch(
      `${publicUrlFor(hosting.publicBaseUrl, object.Key)}?verify=${Date.now()}`,
      { cache: "no-store" },
    );
    const metadata = await response.text();
    const prefix = object.Key.slice(0, object.Key.lastIndexOf("/"));
    for (const name of metadataArtifactNames(metadata))
      await verifyObject(hosting, `${prefix}/${name}`);
  }
}

async function main() {
  const hosting = loadHosting();
  assertAwsCliAvailable();
  if (verifyOnly) {
    await verifyStableInstallers(hosting, {});
    await verifyExistingFeeds(hosting);
    return;
  }

  assertLiveStripeForPublish();

  const hostPlatforms = platformsForHost(process.platform);
  if (hostPlatforms.length === 0)
    throw new Error(`No release platforms configured for ${process.platform}`);
  const buildable = buildablePlatformsForHost(process.platform);
  const buildEnvironment = buildable.includes("mac")
    ? appleReleaseEnvironment({
        root,
        credentials: localCredentials(),
        env: process.env,
      })
    : buildable.includes("win")
      ? windowsReleaseEnvironment({ credentials: localCredentials(), env: process.env })
      : process.env;
  if (!noBuild) buildHostInstallers(buildable, buildEnvironment);
  const files = existsSync(distDir)
    ? readdirSync(distDir).map((name) => ({
        name,
        mtimeMs: statSync(join(distDir, name)).mtimeMs,
      }))
    : [];
  const selected = selectArtifacts(files);
  const selectedPlatforms =
    requiredPlatforms.length > 0 ? requiredPlatforms : buildable;
  // Keyed by package kind (win, mac, deb, rpm, pacman).
  const artifacts = Object.fromEntries(
    Object.entries(selected).filter(([kind]) =>
      selectedPlatforms.includes(INSTALLERS[kind].platform),
    ),
  );
  const expected = new Set(
    noBuild || dryRun
      ? requiredPlatforms
      : [...buildable, ...requiredPlatforms],
  );
  // A platform is only complete with every one of its package kinds (Linux: deb, rpm, pacman).
  const missing = [...expected]
    .flatMap((platform) => kindsForPlatform(platform))
    .filter((kind) => !(kind in artifacts));
  if (missing.length > 0)
    throw new Error(
      `Missing required installers in dist/: ${missing.join(", ")}`,
    );
  if (Object.keys(artifacts).length === 0)
    throw new Error(`No installers found in ${distDir}`);

  const publishApt = process.platform === "linux" && Boolean(artifacts.deb);
  if (publishApt) {
    if (dryRun)
      console.log("[dry run] would promote the signed APT repository");
    else assertAptPublishingReady();
  }

  // One feed per platform: Linux's latest-linux.yml already lists the deb, rpm and pacman files.
  const publications = [];
  for (const platform of PLATFORMS) {
    const kind = kindsForPlatform(platform).find((candidate) => artifacts[candidate]);
    if (!kind) continue;
    publications.push(...(await publishUpdateFeed(hosting, platform, artifacts[kind])));
  }
  // The signed APT repository is the deb's update channel. Promote it before changing the
  // website's stable aliases, so one release:upload command completes the whole Linux release.
  if (publishApt && !dryRun) publishAptRepository();
  for (const [kind, artifact] of Object.entries(artifacts))
    uploadStableInstaller(hosting, kind, artifact);

  if (dryRun) return;
  await verifyStableInstallers(hosting, artifacts);
  // Pruning happens only after both the updater pointer and website alias are verified live.
  for (const publication of publications) pruneUpdateFeed(hosting, publication);
  console.log(
    "Release artifacts are live and old updater generations are bounded.",
  );
}

await main();
