import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_RESET_CALLBACK_PATH,
  DESKTOP_DEEP_LINK_SCHEME,
} from "@talysman/auth-contracts";

const FALLBACK_PATH = "/app";
const ALLOWED_DESKTOP_AUTH_PATHS = new Set([
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_RESET_CALLBACK_PATH,
]);

/** Return a same-origin path, rejecting protocol-relative and backslash-normalized URLs. */
export function safeInternalPath(value: string | undefined, fallback = FALLBACK_PATH): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;

  const base = new URL("https://talysman.invalid");
  const parsed = new URL(value, base);
  if (parsed.origin !== base.origin) return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Resolve the post-auth destination without allowing an open redirect. */
export function authRedirectTarget(appUrl: string, value: string | undefined): string {
  if (value?.startsWith("/")) {
    return new URL(safeInternalPath(value), appUrl).toString();
  }

  if (value) {
    try {
      const parsed = new URL(value);
      const path = `${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
      if (
        parsed.protocol === `${DESKTOP_DEEP_LINK_SCHEME}:` &&
        ALLOWED_DESKTOP_AUTH_PATHS.has(path)
      ) {
        return parsed.toString();
      }
    } catch {
      // Fall through to the application home.
    }
  }

  return new URL(FALLBACK_PATH, appUrl).toString();
}

export function authErrorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "access_denied") return "Google sign-in was cancelled.";
  if (code === "provider_disabled") {
    return "Google sign-in is not available in this environment.";
  }
  return "Google sign-in could not be completed. Please try again.";
}
