import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const DEFAULT_APPLE_CERTIFICATE_PATH =
  "local-credentials/apple/talysman-developer-id.p12";

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function localPath(root, value) {
  if (!configured(value)) return "";
  return isAbsolute(value) ? value : resolve(root, value);
}

/**
 * Resolve the macOS release credentials without exposing them in command arguments.
 * Environment variables win so GitHub Actions keeps using its existing secret contract;
 * the ignored `.credentials` file is the ergonomic local fallback.
 */
export function appleReleaseEnvironment({
  root,
  credentials = null,
  env = process.env,
  pathExists = existsSync,
} = {}) {
  const apple = credentials?.apple ?? {};
  const defaultCertificate = join(root, DEFAULT_APPLE_CERTIFICATE_PATH);
  const certificate =
    env.CSC_LINK ||
    env.MAC_CSC_LINK ||
    localPath(root, apple.certificate_path) ||
    (pathExists(defaultCertificate) ? defaultCertificate : "");
  const certificatePassword =
    env.CSC_KEY_PASSWORD ||
    env.MAC_CSC_KEY_PASSWORD ||
    apple.certificate_password ||
    "";
  const keychainProfile =
    env.APPLE_KEYCHAIN_PROFILE || apple.keychain_profile || "";
  const keychain = env.APPLE_KEYCHAIN || localPath(root, apple.keychain);
  const apiKey = env.APPLE_API_KEY || localPath(root, apple.api_key_path);
  const apiKeyId = env.APPLE_API_KEY_ID || apple.api_key_id || "";
  const apiIssuer = env.APPLE_API_ISSUER || apple.api_issuer || "";
  const appleId = env.APPLE_ID || apple.apple_id || "";
  const appleIdPassword =
    env.APPLE_APP_SPECIFIC_PASSWORD || apple.app_specific_password || "";
  const teamId = env.APPLE_TEAM_ID || apple.team_id || "";

  const missing = [];
  if (!configured(certificate)) missing.push("Developer ID .p12 (CSC_LINK)");
  if (!configured(certificatePassword))
    missing.push(".p12 password (CSC_KEY_PASSWORD)");
  const hasKeychainProfile = configured(keychainProfile);
  const hasCompleteApiKey =
    configured(apiKey) && configured(apiKeyId) && configured(apiIssuer);
  const hasCompleteAppleId =
    configured(appleId) &&
    configured(appleIdPassword) &&
    configured(teamId);
  if (!hasKeychainProfile && !hasCompleteApiKey && !hasCompleteAppleId) {
    missing.push(
      "notarization authentication: APPLE_KEYCHAIN_PROFILE, a complete App Store Connect API key, or Apple ID credentials",
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `macOS release credentials are incomplete:\n- ${missing.join("\n- ")}\n` +
        "Set the standard environment variables or add an [apple] section to the ignored .credentials file.",
    );
  }

  // Paths supplied by CI may not exist until the workflow writes them, but by the time
  // release:upload starts every local path must be readable. CSC_LINK may alternatively
  // be base64 data, so only path-like values are checked here.
  // electron-builder also accepts base64 certificate data in CSC_LINK. Only validate
  // it as a file when it is clearly a path. APPLE_API_KEY is always a `.p8` path.
  if (
    (isAbsolute(certificate) || certificate.startsWith(".")) &&
    !pathExists(certificate)
  ) {
    throw new Error(`Developer ID certificate does not exist: ${certificate}`);
  }
  if (hasCompleteApiKey && !pathExists(apiKey)) {
    throw new Error(`App Store Connect API key does not exist: ${apiKey}`);
  }

  if (configured(teamId) && !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error("APPLE_TEAM_ID must be the 10-character Apple Developer Team ID.");
  }

  const result = {
    ...env,
    CSC_LINK: certificate,
    CSC_KEY_PASSWORD: certificatePassword,
  };
  if (hasKeychainProfile) {
    // app-builder-lib checks Apple ID and API-key variables before the keychain
    // profile. Remove stale partial values so the selected profile wins cleanly.
    delete result.APPLE_ID;
    delete result.APPLE_APP_SPECIFIC_PASSWORD;
    delete result.APPLE_API_KEY;
    delete result.APPLE_API_KEY_ID;
    delete result.APPLE_API_ISSUER;
    result.APPLE_KEYCHAIN_PROFILE = keychainProfile;
    if (configured(keychain)) result.APPLE_KEYCHAIN = keychain;
  } else if (hasCompleteApiKey) {
    result.APPLE_API_KEY = apiKey;
    result.APPLE_API_KEY_ID = apiKeyId;
    result.APPLE_API_ISSUER = apiIssuer;
    if (configured(teamId)) result.APPLE_TEAM_ID = teamId;
  } else {
    result.APPLE_ID = appleId;
    result.APPLE_APP_SPECIFIC_PASSWORD = appleIdPassword;
    result.APPLE_TEAM_ID = teamId;
  }
  return result;
}
