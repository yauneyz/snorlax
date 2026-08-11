import Link from "next/link";
import { Suspense } from "react";
import { resolveTarget, type AnalyticsTarget } from "@/server/analytics/db";
import { ActiveUsersPanel } from "./ActiveUsersPanel";
import { ChannelTablePanel } from "./ChannelTablePanel";
import { EngagementPanel } from "./EngagementPanel";
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
  ["Funnel", FunnelPanel], ["Channels", ChannelTablePanel], ["Active users", ActiveUsersPanel],
  ["Engagement", EngagementPanel], ["Retention", RetentionPanel], ["Install health", InstallHealthPanel],
  ["Revenue", RevenuePanel], ["Raw stream", RawStreamPanel], ["Migration state", MigrationStatePanel],
] as const;

export async function InsightsDashboard({ target }: { target: AnalyticsTarget }) {
  const resolved = await resolveTarget(target);
  const other = target === "dev" ? "/insights" : "/insights/dev";
  return <main className="insights-root" data-insights-target={target}>
    <TargetBanner target={target} result={resolved} />
    <div className="insights-container">
      <header className="insights-heading"><div><span className="insights-eyebrow">Talysman analytics</span><h1>Insights</h1><p>Operational funnel, usage, retention, install health, and billing signals.</p></div><Link href={other}>Open {target === "dev" ? "production" : "local dev"} →</Link></header>
      <div className="insights-grid">{panels.map(([title, Panel]) => <SuspenseBoundary key={title} fallback={<PanelLoading title={title} />}><Panel target={target} /></SuspenseBoundary>)}</div>
    </div>
  </main>;
}
