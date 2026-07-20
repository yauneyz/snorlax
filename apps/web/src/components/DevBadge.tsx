/**
 * Loud "DEV" marker next to the brand so a dev server is never mistaken for
 * production. Renders nothing in production builds.
 */
export function DevBadge() {
  if (process.env.NODE_ENV === "production") return null;
  return <span className="dev-badge">DEV</span>;
}
