export interface ParsedDeepLink {
  path: string;
  code: string | null;
  error: string | null;
  /** Safe for logs: deliberately excludes query parameters and fragments. */
  logLabel: string;
}

export function parseDeepLink(value: string): ParsedDeepLink {
  const parsed = new URL(value);
  const path = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
  return {
    path,
    code: parsed.searchParams.get('code'),
    error: parsed.searchParams.get('error'),
    logLabel: `${parsed.protocol}//${path}`,
  };
}
