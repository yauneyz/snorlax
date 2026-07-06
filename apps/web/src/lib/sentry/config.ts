const PLACEHOLDER_MARKERS = ["..."];

export function normalizeSentryDsn(value: string | null | undefined): string {
  const dsn = value?.trim() ?? "";
  if (!dsn || PLACEHOLDER_MARKERS.some((marker) => dsn.includes(marker))) {
    return "";
  }

  try {
    const url = new URL(dsn);
    const projectPath = url.pathname.replace(/\/+$/, "");
    if (!["http:", "https:"].includes(url.protocol) || !url.username || !url.host || !projectPath) {
      return "";
    }
    return dsn;
  } catch {
    return "";
  }
}

export function isSentryEnabled(): boolean {
  return normalizeSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN).length > 0;
}
