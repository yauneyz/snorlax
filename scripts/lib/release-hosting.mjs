/**
 * Shared logic for publishing desktop installers to the public release-artifacts
 * S3 bucket. The web app's /api/desktop/download route redirects to
 * `${extension_hosting.public_s3_base_url}/app/<stable name>`, so installers are
 * uploaded under stable, unversioned keys that never change between releases.
 *
 * Pure functions only — the CLI wrapper (scripts/upload-release.mjs) does the I/O.
 */

export const PLATFORMS = ["win", "mac", "linux"];

// Stable object keys served by apps/web/src/app/api/desktop/download/route.ts.
// The basenames must stay in sync with that route's INSTALLERS map.
export const STABLE_INSTALLER_KEYS = {
  win: "app/Talysman-Setup.exe",
  mac: "app/Talysman.dmg",
  linux: "app/Talysman.deb",
};

export const UPDATE_METADATA_FILES = {
  win: "latest.yml",
  mac: "latest-mac.yml",
};

export const UPDATE_FEED_ROOT = "desktop";

// Versioned artifact names produced by electron-builder (see electron-builder.yml):
//   win   nsis  Talysman-Setup-<version>.exe
//   mac   dmg   Talysman-<version>[-<arch>].dmg
//   linux deb   Talysman-<version>-<arch>.deb (ships + installs the privileged daemon)
const SEMVER = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const ARTIFACT_PATTERNS = {
  win: new RegExp(`^Talysman-Setup-(${SEMVER})-(x64|arm64|ia32)\\.exe$`),
  mac: new RegExp(`^Talysman-(${SEMVER})-(x64|arm64|universal)\\.dmg$`),
  linux: new RegExp(`^Talysman-(${SEMVER})-(amd64|arm64)\\.deb$`),
};

const CONTENT_TYPES = {
  win: "application/octet-stream",
  mac: "application/x-apple-diskimage",
  linux: "application/vnd.debian.binary-package",
};

// Which platforms each build host is expected to publish: Linux cross-builds the
// Windows installer (electron-builder + wine), macOS only builds its own dmg, and
// Windows only builds its own installer.
const HOST_RELEASE_PLATFORMS = {
  linux: ["win", "linux"],
  darwin: ["mac"],
  win32: ["win"],
};

/** Platforms this host should upload, keyed by Node's process.platform. */
export function platformsForHost(nodePlatform) {
  return HOST_RELEASE_PLATFORMS[nodePlatform] ?? [];
}

// Root package.json scripts that produce each platform's installer.
export const BUILD_SCRIPTS = {
  win: "build:win",
  mac: "build:mac",
  linux: "build:linux",
};

// scripts/build.mjs requires each target to build on its own OS (the native Rust
// service is compiled per-host), so a host can only build the platform it runs on.
const BUILD_HOST = {
  win: "win32",
  mac: "darwin",
  linux: "linux",
};

/**
 * The subset of this host's release platforms it can actually build locally.
 * Anything else it publishes (e.g. the Windows installer from a Linux box) must be
 * staged into dist/ from a build done on the right OS.
 */
export function buildablePlatformsForHost(nodePlatform) {
  return platformsForHost(nodePlatform).filter(
    (platform) => BUILD_HOST[platform] === nodePlatform,
  );
}

/** Map a dist/ file name to its platform, or null if it is not a release installer. */
export function classifyArtifact(fileName) {
  for (const platform of PLATFORMS) {
    if (ARTIFACT_PATTERNS[platform].test(fileName)) return platform;
  }
  return null;
}

/**
 * Pick the newest installer per platform from a dist/ listing.
 *
 * @param {Array<{name: string, mtimeMs: number}>} files
 * @returns {Partial<Record<"win"|"mac"|"linux", {name: string, mtimeMs: number}>>}
 */
export function selectArtifacts(files) {
  const selected = {};
  for (const file of files) {
    const platform = classifyArtifact(file.name);
    if (!platform) continue;
    if (!selected[platform] || file.mtimeMs > selected[platform].mtimeMs) {
      selected[platform] = file;
    }
  }
  return selected;
}

export function contentTypeFor(platform) {
  const type = CONTENT_TYPES[platform];
  if (!type) throw new Error(`Unknown platform: ${platform}`);
  return type;
}

export function contentTypeForFile(fileName) {
  if (fileName.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (fileName.endsWith(".zip")) return "application/zip";
  if (fileName.endsWith(".dmg")) return CONTENT_TYPES.mac;
  if (fileName.endsWith(".deb")) return CONTENT_TYPES.linux;
  return "application/octet-stream";
}

export function artifactIdentity(fileName) {
  for (const platform of PLATFORMS) {
    const match = fileName.match(ARTIFACT_PATTERNS[platform]);
    if (!match) continue;
    const rawArch = match[2];
    return {
      platform,
      version: match[1],
      arch: rawArch === "amd64" ? "x64" : rawArch,
    };
  }
  return null;
}

export function updateFeedPrefix(platform, arch) {
  if (!(platform in UPDATE_METADATA_FILES)) {
    throw new Error(`No electron-updater feed for platform: ${platform}`);
  }
  if (!/^[0-9A-Za-z_-]+$/.test(arch))
    throw new Error(`Invalid architecture: ${arch}`);
  return `${UPDATE_FEED_ROOT}/${platform}/${arch}`;
}

/** Extract relative artifact names from electron-builder's YAML without accepting remote URLs. */
export function metadataArtifactNames(source) {
  const names = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-\s+url|path):\s*(.+?)\s*$/);
    if (!match) continue;
    const value = match[1].replace(/^['"]|['"]$/g, "");
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(value) ||
      value.includes("/") ||
      value.includes("\\")
    ) {
      throw new Error(
        `Update metadata must use a relative basename, got: ${value}`,
      );
    }
    names.add(value);
  }
  return [...names];
}

/** Public download URL for an object key, tolerating a trailing slash on the base. */
export function publicUrlFor(baseUrl, key) {
  return `${baseUrl.replace(/\/+$/, "")}/${key}`;
}

/**
 * Resolve the APT signing identity, preferring the environment (CI sets
 * APT_SIGNING_KEY_ID / APT_SIGNING_KEY_PASSPHRASE) and falling back to the
 * `[apt]` section of a parsed .credentials TOML for local releases.
 *
 * @returns {{keyId: string, passphrase: string|undefined}|null} null when neither source is configured.
 */
export function aptSigningFromCredentials(credentials, env = process.env) {
  const apt = credentials?.apt ?? {};
  const keyId = env.APT_SIGNING_KEY_ID || apt.signing_key_id || "";
  if (!keyId) return null;
  const passphrase =
    env.APT_SIGNING_KEY_PASSPHRASE || apt.signing_passphrase || "";
  return { keyId, passphrase: passphrase || undefined };
}

/**
 * Extract and validate the hosting/upload settings from a parsed .credentials TOML.
 * Throws with a field-level message when something needed for uploads is missing.
 */
export function hostingFromCredentials(credentials) {
  const aws = credentials?.aws ?? {};
  const hosting = credentials?.extension_hosting ?? {};
  const missing = [];
  if (!aws.region) missing.push("aws.region");
  if (!aws.access_key_id) missing.push("aws.access_key_id");
  if (!aws.secret_access_key) missing.push("aws.secret_access_key");
  if (!hosting.bucket) missing.push("extension_hosting.bucket");
  if (!hosting.public_s3_base_url)
    missing.push("extension_hosting.public_s3_base_url");
  if (missing.length > 0) {
    throw new Error(
      `.credentials is missing required fields: ${missing.join(", ")}`,
    );
  }
  for (const value of [aws.access_key_id, aws.secret_access_key]) {
    if (value.includes("...")) {
      throw new Error(
        ".credentials still contains placeholder AWS keys — fill in real values.",
      );
    }
  }
  return {
    region: aws.region,
    accessKeyId: aws.access_key_id,
    secretAccessKey: aws.secret_access_key,
    bucket: hosting.bucket,
    publicBaseUrl: hosting.public_s3_base_url,
  };
}
