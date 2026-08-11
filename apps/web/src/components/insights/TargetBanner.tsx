import type { AnalyticsTarget, TargetResult } from "@/server/analytics/db";

export function TargetBanner({ target, result }: { target: AnalyticsTarget; result: TargetResult }) {
  const host = result.ok ? result.host : target === "dev" ? "127.0.0.1:54321" : "unavailable";
  const label = target === "dev" ? "LOCAL DEV DATABASE" : "PRODUCTION DATABASE";
  return (
    <div className={`insights-banner insights-banner--${target}`} role="banner">
      <span>{label}</span>
      <code>{host}</code>
      {!result.ok ? <em>{result.reason}</em> : null}
    </div>
  );
}
