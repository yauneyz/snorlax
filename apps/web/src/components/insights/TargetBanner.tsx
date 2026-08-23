import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget, TargetResult } from "@/server/analytics/db";

export function TargetBanner({
  target,
  audience,
  result,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
  result: TargetResult;
}) {
  const host = result.ok ? result.host : target === "dev" ? "127.0.0.1:54321" : "unavailable";
  const label = audience === "dev" ? "DEV · IGNORED PERSON IDS ONLY" : "PROD · MARKETING AUDIENCE";
  return (
    <div className={`insights-banner insights-banner--${audience}`} role="banner">
      <span>{label}</span>
      <code>{host}</code>
      {!result.ok ? <em>{result.reason}</em> : null}
    </div>
  );
}
