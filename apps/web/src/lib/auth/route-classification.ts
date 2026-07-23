export type PathKind = "marketing" | "auth" | "app" | "api" | "asset";

export const AUTH_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/recovery",
] as const;

export const AUTHENTICATED_UI_PATHS = ["/app", "/account"] as const;

/**
 * Password recovery establishes an authenticated session before the user chooses their new
 * password. Keep this auth surface reachable after that session has been created.
 */
export function isPasswordRecoveryPath(pathname: string): boolean {
  return pathname === "/reset-password";
}

export function isAuthenticatedUiRoute(pathname: string): boolean {
  return AUTHENTICATED_UI_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Brand/PWA files served from the app root. Next's icon file conventions and app/manifest.ts put
 * these outside /_next, so they need an explicit pass so an unauthenticated browser can still
 * fetch the favicon and manifest.
 */
const ASSET_PREFIXES = [
  "/_next",
  "/favicon",
  "/og-",
  "/icon", // /icon.svg and Next's hashed /icon-<hash> variants
  "/icons/", // PWA icons in public/
  "/apple-icon",
  "/manifest.webmanifest",
] as const;

export function classifyPath(pathname: string): PathKind {
  if (ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return "asset";
  }
  if (pathname.startsWith("/api")) return "api";
  if ((AUTH_PATHS as readonly string[]).includes(pathname)) return "auth";
  if (isAuthenticatedUiRoute(pathname)) return "app";
  return "marketing";
}
