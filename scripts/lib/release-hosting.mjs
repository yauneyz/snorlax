/**
 * Shared logic for publishing desktop installers to the public release-artifacts
 * S3 bucket. The web app's /api/desktop/download route redirects to
 * `${extension_hosting.public_s3_base_url}/app/<stable name>`, so installers are
 * uploaded under stable, unversioned keys that never change between releases.
 *
 * Pure functions only — the CLI wrapper (scripts/upload-release.mjs) does the I/O.
 */

export const PLATFORMS = ["win", "mac", "linux"];

/**
 * Every public installer, keyed by package kind. Linux ships three package formats; each kind
 * maps back to the analytics/build platform it belongs to.
 *
 * `stableKey` is served by apps/web/src/app/api/desktop/download/route.ts; the basenames must
 * stay in sync with that route's INSTALLERS map.
 *
 * Versioned artifact names produced by electron-builder (see electron-builder.yml):
 *   win     nsis    Talysman-Setup-<version>-x64.exe
 *   mac     dmg     Talysman-<version>-universal.dmg
 *   deb     deb     Talysman-<version>-amd64.deb
 *   rpm     rpm     Talysman-<version>-x86_64.rpm
 *   pacman  pacman  Talysman-<version>-x64.pacman
 * Each Linux package ships the privileged daemon and installs it from native/linux/installer.
 */
const SEMVER = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const LINUX_ARCH = "(amd64|x86_64|x64|arm64|aarch64)";
export const INSTALLERS = {
  win: {
    platform: "win",
    stableKey: "app/Talysman-Setup.exe",
    pattern: new RegExp(`^Talysman-Setup-(${SEMVER})-(x64|arm64|ia32)\\.exe$`),
    contentType: "application/octet-stream",
  },
  mac: {
    platform: "mac",
    stableKey: "app/Talysman.dmg",
    pattern: new RegExp(`^Talysman-(${SEMVER})-(x64|arm64|universal)\\.dmg$`),
    contentType: "application/x-apple-diskimage",
  },
  deb: {
    platform: "linux",
    stableKey: "app/Talysman.deb",
    pattern: new RegExp(`^Talysman-(${SEMVER})-${LINUX_ARCH}\\.deb$`),
    contentType: "application/vnd.debian.binary-package",
  },
  rpm: {
    platform: "linux",
    stableKey: "app/Talysman.rpm",
    pattern: new RegExp(`^Talysman-(${SEMVER})-${LINUX_ARCH}\\.rpm$`),
    contentType: "application/x-rpm",
  },
  pacman: {
    platform: "linux",
    stableKey: "app/Talysman.pacman",
    pattern: new RegExp(`^Talysman-(${SEMVER})-${LINUX_ARCH}\\.pacman$`),
    contentType: "application/octet-stream",
  },
};

export const INSTALLER_KINDS = Object.keys(INSTALLERS);

/** Package kinds a platform publishes, e.g. linux -> deb, rpm, pacman. */
export function kindsForPlatform(platform) {
  return INSTALLER_KINDS.filter((kind) => INSTALLERS[kind].platform === platform);
}

// Stable object keys, by package kind.
export const STABLE_INSTALLER_KEYS = Object.fromEntries(
  INSTALLER_KINDS.map((kind) => [kind, INSTALLERS[kind].stableKey]),
);

// electron-updater channel files. deb installs update through the signed APT repository, but
// rpm and pacman installs have no repository and update from latest-linux.yml instead.
export const UPDATE_METADATA_FILES = {
  win: "latest.yml",
  mac: "latest-mac.yml",
  linux: "latest-linux.yml",
};

/**
 * Extra feed directories a platform's feed is mirrored into. Installs before the universal mac
 * build were arm64-only and poll desktop/mac/arm64; the universal zip serves them just as well.
 */
export const UPDATE_FEED_MIRRORS = {
  "mac/universal": ["mac/arm64"],
};

export const UPDATE_FEED_ROOT = "desktop";

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

/** Map a dist/ file name to its package kind, or null if it is not a release installer. */
export function classifyArtifact(fileName) {
  for (const kind of INSTALLER_KINDS) {
    if (INSTALLERS[kind].pattern.test(fileName)) return kind;
  }
  return null;
}

/**
 * Pick the newest installer per package kind from a dist/ listing.
 *
 * @param {Array<{name: string, mtimeMs: number}>} files
 * @returns {Partial<Record<keyof typeof INSTALLERS, {name: string, mtimeMs: number}>>}
 */
export function selectArtifacts(files) {
  const selected = {};
  for (const file of files) {
    const kind = classifyArtifact(file.name);
    if (!kind) continue;
    if (!selected[kind] || file.mtimeMs > selected[kind].mtimeMs) {
      selected[kind] = file;
    }
  }
  return selected;
}

export function contentTypeFor(kind) {
  const type = INSTALLERS[kind]?.contentType;
  if (!type) throw new Error(`Unknown installer kind: ${kind}`);
  return type;
}

export function contentTypeForFile(fileName) {
  if (fileName.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (fileName.endsWith(".zip")) return "application/zip";
  const kind = classifyArtifact(fileName);
  if (kind) return INSTALLERS[kind].contentType;
  if (fileName.endsWith(".dmg")) return INSTALLERS.mac.contentType;
  if (fileName.endsWith(".deb")) return INSTALLERS.deb.contentType;
  if (fileName.endsWith(".rpm")) return INSTALLERS.rpm.contentType;
  return "application/octet-stream";
}

const NORMALIZED_ARCH = { amd64: "x64", x86_64: "x64", aarch64: "arm64" };

export function artifactIdentity(fileName) {
  for (const kind of INSTALLER_KINDS) {
    const match = fileName.match(INSTALLERS[kind].pattern);
    if (!match) continue;
    const rawArch = match[2];
    return {
      kind,
      platform: INSTALLERS[kind].platform,
      version: match[1],
      arch: NORMALIZED_ARCH[rawArch] ?? rawArch,
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

/** The feed prefix plus any legacy directories it is mirrored into (UPDATE_FEED_MIRRORS). */
export function updateFeedPrefixes(platform, arch) {
  const mirrors = UPDATE_FEED_MIRRORS[`${platform}/${arch}`] ?? [];
  return [
    updateFeedPrefix(platform, arch),
    ...mirrors.map((relative) => `${UPDATE_FEED_ROOT}/${relative}`),
  ];
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
