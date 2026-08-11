export const ANALYTICS_ANON_COOKIE = "tal_aid";
export const ANALYTICS_ANON_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Treat malformed values as absent so middleware replaces them with an opaque UUID. */
export function parseAnonId(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value.toLowerCase() : null;
}

export function mintAnonId(): string {
  return crypto.randomUUID();
}
