import Link from "next/link";
import { Suspense } from "react";
import type { AnalyticsAudience } from "@/server/analytics/audience";
import { resolveTarget, type AnalyticsTarget } from "@/server/analytics/db";
import { ActiveUsersPanel } from "./ActiveUsersPanel";
import { ChannelTablePanel } from "./ChannelTablePanel";
import { EngagementPanel } from "./EngagementPanel";
import { ErrorsPanel } from "./ErrorsPanel";
import { FunnelPanel } from "./FunnelPanel";
import { InstallHealthPanel } from "./InstallHealthPanel";
import { MigrationStatePanel } from "./MigrationStatePanel";
import { PanelLoading } from "./PanelShell";
import { RawStreamPanel } from "./RawStreamPanel";
import { RetentionPanel } from "./RetentionPanel";
import { RevenuePanel } from "./RevenuePanel";
import { TargetBanner } from "./TargetBanner";

// The workspace currently resolves two compatible React 19 type patch versions. This cast
// keeps the runtime Suspense boundary while expressing it in the JSX namespace used by Next.
const SuspenseBoundary = Suspense as unknown as (props: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) => React.ReactElement;

const panels = [
  ["Funnel", FunnelPanel],
  ["Channels", ChannelTablePanel],
  ["Active users", ActiveUsersPanel],
  ["Engagement", EngagementPanel],
  ["Retention", RetentionPanel],
  ["Install health", InstallHealthPanel],
  ["Revenue", RevenuePanel],
  ["Errors", ErrorsPanel],
  ["Raw stream", RawStreamPanel],
  ["Migration state", MigrationStatePanel],
] as const;

export async function InsightsDashboard({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const resolved = await resolveTarget(target);
  const other = audience === "dev" ? "/insights" : "/insights/dev";
  return (
    <main className="insights-root" data-insights-target={target} data-insights-audience={audience}>
      <TargetBanner target={target} audience={audience} result={resolved} />
      <div className="insights-container">
        <header className="insights-heading">
          <div>
            <span className="insights-eyebrow">
              Talysman analytics · {audience === "dev" ? "internal traffic" : "marketing audience"}
            </span>
            <h1>Insights</h1>
            <p>Operational funnel, usage, retention, install health, and billing signals.</p>
          </div>
          <Link href={other}>Open {audience === "dev" ? "production" : "dev"} dashboard →</Link>
        </header>
        <div className="insights-grid">
          {panels.map(([title, Panel]) => (
            <SuspenseBoundary key={title} fallback={<PanelLoading title={title} />}>
              <Panel target={target} audience={audience} />
            </SuspenseBoundary>
          ))}
        </div>
      </div>
    </main>
  );
}
