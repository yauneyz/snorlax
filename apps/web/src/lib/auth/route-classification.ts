export type PathKind = "marketing" | "auth" | "app" | "api" | "asset";

export const AUTH_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
] as const;

export const AUTHENTICATED_UI_PATHS = ["/app", "/account"] as const;

export function isAuthenticatedUiRoute(pathname: string): boolean {
  return AUTHENTICATED_UI_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function classifyPath(pathname: string): PathKind {
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/og-")
  ) {
    return "asset";
  }
  if (pathname.startsWith("/api")) return "api";
  if ((AUTH_PATHS as readonly string[]).includes(pathname)) return "auth";
  if (isAuthenticatedUiRoute(pathname)) return "app";
  return "marketing";
}
