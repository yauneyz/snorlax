#!/usr/bin/env node
/**
 * Upload desktop installers from dist/ to the public release-artifacts S3 bucket
 * and verify they are downloadable at the URLs the website redirects to.
 *
 * The web app's /api/desktop/download route 302s to
 * `${extension_hosting.public_s3_base_url}/app/<stable name>`, so each versioned
 * electron-builder artifact (e.g. Talysman-0.1.0-x86_64.AppImage) is uploaded to
 * its stable key (app/Talysman.AppImage). Credentials come from the monorepo
 * `.credentials` TOML; nothing is read from the shell environment.
 *
 * Each host only publishes the platforms it is responsible for building: Linux uploads
 * the Windows installer and the Linux deb, macOS uploads the dmg, Windows uploads its
 * own installer (see platformsForHost).
 *
 * Usage:
 *   node scripts/upload-release.mjs                    # upload this host's installers from dist/
 *   node scripts/upload-release.mjs --require linux    # fail if these platforms are not uploaded
 *   node scripts/upload-release.mjs --verify-only      # no upload; HEAD the public URLs
 *   node scripts/upload-release.mjs --dry-run          # print intent, no writes
 *
 * Requires the `aws` CLI (uploads shell out to `aws s3 cp`).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import toml from "@iarna/toml";

import {
  PLATFORMS,
  STABLE_INSTALLER_KEYS,
  contentTypeFor,
  hostingFromCredentials,
  platformsForHost,
  publicUrlFor,
  selectArtifacts,
} from "./lib/release-hosting.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verifyOnly = args.includes("--verify-only");
const requireFlagIndex = args.indexOf("--require");
const requiredPlatforms =
  requireFlagIndex === -1
    ? []
    : (args[requireFlagIndex + 1] ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

for (const platform of requiredPlatforms) {
  if (!PLATFORMS.includes(platform)) {
    console.error(`Unknown platform in --require: ${platform} (expected ${PLATFORMS.join(", ")})`);
    process.exit(1);
  }
}

// Same lookup order as scripts/sync-env.ts.
const credentialsCandidates = [
  join(root, ".credentials"),
  resolve(root, "..", "indigo", ".credentials"),
];

function loadHosting() {
  const source = credentialsCandidates.find((candidate) => existsSync(candidate));
  if (!source) {
    console.error(`Missing .credentials. Checked:\n${credentialsCandidates.join("\n")}`);
    process.exit(1);
  }
  try {
    return hostingFromCredentials(toml.parse(readFileSync(source, "utf8")));
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}

function assertAwsCliAvailable() {
  const result = spawnSync("aws", ["--version"], { stdio: "ignore" });
  if (result.status !== 0) {
    console.error("The `aws` CLI is required to upload release artifacts but was not found.");
    process.exit(1);
  }
}

function upload(hosting, platform, artifact) {
  const key = STABLE_INSTALLER_KEYS[platform];
  const source = join(distDir, artifact.name);
  const sizeMb = (statSync(source).size / (1024 * 1024)).toFixed(1);
  console.log(`⬆️  ${platform}: ${artifact.name} (${sizeMb} MB) → s3://${hosting.bucket}/${key}`);
  if (dryRun) return;

  execFileSync(
    "aws",
    [
      "s3",
      "cp",
      source,
      `s3://${hosting.bucket}/${key}`,
      "--region",
      hosting.region,
      "--content-type",
      contentTypeFor(platform),
      "--no-progress",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: hosting.accessKeyId,
        AWS_SECRET_ACCESS_KEY: hosting.secretAccessKey,
      },
    },
  );
}

/** HEAD a public URL; returns { ok, status, contentLength }. */
async function checkUrl(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return {
      ok: response.ok,
      status: response.status,
      contentLength: Number(response.headers.get("content-length") ?? 0),
    };
  } catch (error) {
    return { ok: false, status: 0, error: String(error) };
  }
}

async function verify(hosting, uploaded) {
  let failed = false;
  for (const platform of PLATFORMS) {
    const url = publicUrlFor(hosting.publicBaseUrl, STABLE_INSTALLER_KEYS[platform]);
    const result = await checkUrl(url);
    const required = requiredPlatforms.includes(platform) || platform in uploaded;

    if (result.ok) {
      const expectedSize = uploaded[platform]
        ? statSync(join(distDir, uploaded[platform].name)).size
        : null;
      if (expectedSize !== null && result.contentLength !== expectedSize) {
        console.error(
          `❌ ${platform}: ${url} is live but has ${result.contentLength} bytes, expected ${expectedSize}`,
        );
        failed = true;
      } else {
        console.log(`✅ ${platform}: ${url} (HTTP ${result.status}, ${result.contentLength} bytes)`);
      }
    } else if (required) {
      console.error(`❌ ${platform}: ${url} is not downloadable (HTTP ${result.status})`);
      failed = true;
    } else {
      console.warn(`⚠️  ${platform}: not published yet (HTTP ${result.status}) — ${url}`);
    }
  }
  return !failed;
}

async function main() {
  const hosting = loadHosting();

  let uploaded = {};
  if (!verifyOnly) {
    assertAwsCliAvailable();
    const files = existsSync(distDir)
      ? readdirSync(distDir).map((name) => ({
          name,
          mtimeMs: statSync(join(distDir, name)).mtimeMs,
        }))
      : [];
    // Only publish what this host is responsible for building (e.g. a mac dmg lying
    // around in dist/ on a Linux box is stale and must not be re-released from here).
    const hostPlatforms = platformsForHost(process.platform);
    const artifacts = Object.fromEntries(
      Object.entries(selectArtifacts(files)).filter(([platform]) => {
        if (hostPlatforms.includes(platform)) return true;
        console.warn(`⚠️  Skipping ${platform} installer: not built on ${process.platform} hosts`);
        return false;
      }),
    );

    const missing = requiredPlatforms.filter((platform) => !(platform in artifacts));
    if (missing.length > 0) {
      console.error(
        `Missing required installer(s) in dist/: ${missing.join(", ")}. ` +
          `Run the matching pnpm build:<target> first.`,
      );
      process.exit(1);
    }
    if (Object.keys(artifacts).length === 0) {
      console.error(`No installers found in ${distDir}. Run pnpm build:win|mac|linux first.`);
      process.exit(1);
    }

    for (const [platform, artifact] of Object.entries(artifacts)) {
      upload(hosting, platform, artifact);
    }
    uploaded = artifacts;
  }

  if (dryRun) {
    console.log("🧪 [DRY RUN] skipping download verification");
    return;
  }

  console.log("\n🔎 Verifying public download URLs…");
  const ok = await verify(hosting, uploaded);
  if (!ok) process.exit(1);
  console.log("🎉 Release artifacts are live.");
}

await main();
