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

// Versioned artifact names produced by electron-builder (see electron-builder.yml):
//   win   nsis  Talysman-Setup-<version>.exe
//   mac   dmg   Talysman-<version>[-<arch>].dmg
//   linux deb   Talysman-<version>-<arch>.deb (ships + installs the privileged daemon)
const ARTIFACT_PATTERNS = {
  win: /^Talysman-Setup-\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\.exe$/,
  mac: /^Talysman-\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\.dmg$/,
  linux: /^Talysman-\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?-[0-9A-Za-z_]+\.deb$/,
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

/** Public download URL for an object key, tolerating a trailing slash on the base. */
export function publicUrlFor(baseUrl, key) {
  return `${baseUrl.replace(/\/+$/, "")}/${key}`;
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
  if (!hosting.public_s3_base_url) missing.push("extension_hosting.public_s3_base_url");
  if (missing.length > 0) {
    throw new Error(`.credentials is missing required fields: ${missing.join(", ")}`);
  }
  for (const value of [aws.access_key_id, aws.secret_access_key]) {
    if (value.includes("...")) {
      throw new Error(".credentials still contains placeholder AWS keys — fill in real values.");
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
