import { execFileSync } from "node:child_process";
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

/**
 * Sign arbitrary files via Azure Trusted Signing, the same PowerShell module
 * (`Invoke-TrustedSigning`) electron-builder's own WindowsSignAzureManager uses for the app exe
 * and NSIS installer. Needed because that built-in pass only walks the top-level app exe plus
 * resources/app.asar.unpacked and resources/swiftshader — it never signs extraResources like
 * resources/bin, where scripts/build-native.mjs stages the native service binaries. Always
 * requests a timestamp: an unsigned-after-expiry binary is exactly the failure this exists to
 * avoid, and Trusted Signing's leaf certs are short-lived (~3 days) by design.
 */
export async function signNativeWindowsBinaries(filePaths, env = process.env) {
  if (filePaths.length === 0) return;
  // Matches app-builder-lib's VmManager: prefer pwsh (PowerShell Core) when present, since
  // that's what's available for Linux-hosted cross-signing; native Windows CI has both.
  const ps = process.platform === "win32" ? "powershell.exe" : "pwsh";

  execFileSync(
    ps,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser; " +
        "Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force -Repository PSGallery -Scope CurrentUser",
    ],
    { stdio: "inherit", env },
  );

  for (const filePath of filePaths) {
    execFileSync(
      ps,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Invoke-TrustedSigning -Endpoint '${TRUSTED_SIGNING_ENDPOINT}' ` +
          `-CodeSigningAccountName '${TRUSTED_SIGNING_ACCOUNT}' ` +
          `-CertificateProfileName '${TRUSTED_SIGNING_CERTIFICATE_PROFILE}' ` +
          `-Files '${filePath}' -TimestampRfc3161 'http://timestamp.acs.microsoft.com' ` +
          "-TimestampDigest SHA256 -FileDigest SHA256",
      ],
      { stdio: "inherit", env },
    );
    console.log(`  signed ${filePath}`);
  }
}
