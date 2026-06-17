import "server-only";
import { google, type Auth } from "googleapis";
import { config } from "@/lib/config";
import {
  getConnectionById,
  updateConnectionTokens,
  type GoogleTokens,
} from "@/lib/connections/store";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const GSC_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export function redirectUri(): string {
  return `${config.app.url}/api/connections/google/callback`;
}

export function buildAuthUrl(input: { state: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: config.google.oauthClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GSC_SCOPES.join(" "),
    state: input.state,
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: config.google.oauthClientId,
    client_secret: config.google.oauthClientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(
      `Google token exchange failed: ${json.error ?? res.statusText} — ${json.error_description ?? ""}`,
    );
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expiry_date: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope,
    token_type: json.token_type,
    id_token: json.id_token,
  };
}

/**
 * Decode the `email` claim from a Google id_token. We don't verify the signature
 * because the token came directly from Google's token endpoint over HTTPS.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
    const json = JSON.parse(Buffer.from(payload + pad, "base64").toString("utf8")) as {
      email?: string;
    };
    return json.email ?? null;
  } catch {
    return null;
  }
}

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Returns an OAuth2Client ready to call Google APIs. Refreshes the access
 * token if it's expired or close to expiring, and persists the new credentials.
 *
 * Throws if Google rejects the refresh (e.g. the user revoked access). Callers
 * should catch and surface a `reauth_required` to the UI.
 */
export async function googleClientForConnection(connectionId: string): Promise<Auth.OAuth2Client> {
  const { tokens } = await getConnectionById(connectionId);
  const client = new google.auth.OAuth2(
    config.google.oauthClientId,
    config.google.oauthClientSecret,
    redirectUri(),
  );
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    scope: tokens.scope,
    token_type: tokens.token_type,
    id_token: tokens.id_token,
  });

  const stale = tokens.expiry_date - Date.now() < REFRESH_THRESHOLD_MS;
  if (stale) {
    const { credentials } = await client.refreshAccessToken();
    const refreshed: GoogleTokens = {
      access_token: credentials.access_token ?? tokens.access_token,
      // Google sometimes omits refresh_token on refresh; keep the original.
      refresh_token: credentials.refresh_token ?? tokens.refresh_token,
      expiry_date: credentials.expiry_date ?? Date.now() + 3600 * 1000,
      scope: credentials.scope ?? tokens.scope,
      token_type: credentials.token_type ?? tokens.token_type,
      id_token: credentials.id_token ?? tokens.id_token,
    };
    await updateConnectionTokens(connectionId, refreshed);
    client.setCredentials({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expiry_date: refreshed.expiry_date,
      scope: refreshed.scope,
      token_type: refreshed.token_type,
      id_token: refreshed.id_token,
    });
  }

  return client;
}
