import { homedir } from "node:os";
import { join } from "node:path";

// Fixed once the Trusted Signing account/profile exist — not secrets, safe to hardcode.
// See az cli output from provisioning: resource group talysman-signing-rg, region eastus.
export const TRUSTED_SIGNING_ENDPOINT = "https://eus.codesigning.azure.net/";
export const TRUSTED_SIGNING_ACCOUNT = "talysman";
export const TRUSTED_SIGNING_CERTIFICATE_PROFILE = "Talysman";

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolve the Windows Authenticode credentials for electron-builder's native Azure Trusted
 * Signing support (win.azureSignOptions, applied via --config overrides in build.mjs so the
 * static electron-builder.yml never declares azureSignOptions itself — unlike the traditional
 * signtool/CSC_LINK path, a configured-but-unauthenticated Azure signer throws instead of
 * gracefully producing an unsigned installer).
 *
 * Environment variables win so CI keeps using its existing secret contract; the ignored
 * `.credentials` file is the ergonomic local fallback. Mirrors apple-release.mjs.
 */
export function windowsReleaseEnvironment({ credentials = null, env = process.env } = {}) {
  const azure = credentials?.azure_trusted_signing ?? {};
  const tenantId = env.AZURE_TENANT_ID || azure.tenant_id || "";
  const clientId = env.AZURE_CLIENT_ID || azure.client_id || "";
  const clientSecret = env.AZURE_CLIENT_SECRET || azure.client_secret || "";
  const publisherName = env.AZURE_SIGNING_PUBLISHER_NAME || azure.publisher_name || "";

  const missing = [];
  if (!configured(tenantId)) missing.push("AZURE_TENANT_ID");
  if (!configured(clientId)) missing.push("AZURE_CLIENT_ID");
  if (!configured(clientSecret)) missing.push("AZURE_CLIENT_SECRET");
  if (!configured(publisherName)) {
    missing.push(
      "AZURE_SIGNING_PUBLISHER_NAME (the certificate's exact subject name — only known once " +
        "the Trusted Signing certificate profile finishes identity validation)",
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Windows release credentials are incomplete:\n- ${missing.join("\n- ")}\n` +
        "Set the standard environment variables or add an [azure_trusted_signing] section to the ignored .credentials file.",
    );
  }

  // The vendored Microsoft "TrustedSigning" pwsh module reads $env:localappdata — lowercase.
  // pwsh's $env: is case-sensitive on Linux (unlike Windows), so cross-signing from Linux
  // needs the exact-case var set or every NuGet-installed signing tool path resolves empty.
  const localappdata =
    env.localappdata || (process.platform === "linux" ? join(homedir(), ".cache", "trusted-signing") : "");

  return {
    ...env,
    AZURE_TENANT_ID: tenantId,
    AZURE_CLIENT_ID: clientId,
    AZURE_CLIENT_SECRET: clientSecret,
    AZURE_SIGNING_PUBLISHER_NAME: publisherName,
    ...(localappdata ? { localappdata } : {}),
  };
}

/** Non-throwing check used by build.mjs to decide whether to request Azure signing at all. */
export function windowsSigningAvailable(env = process.env) {
  return (
    configured(env.AZURE_TENANT_ID) &&
    configured(env.AZURE_CLIENT_ID) &&
    configured(env.AZURE_CLIENT_SECRET) &&
    configured(env.AZURE_SIGNING_PUBLISHER_NAME)
  );
}
