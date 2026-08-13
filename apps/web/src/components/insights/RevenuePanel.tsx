import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryRevenue } from "@/server/analytics/queries/revenue";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function RevenuePanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryRevenue(target);
  const row = result.ok ? result.rows : null;
  return <PanelShell title="Revenue" description="Subscription projection plus authoritative billing milestones.">
    {!result.ok ? <Unavailable message={result.message} /> : !row ? <p className="insights-muted">No revenue data yet.</p> : <div className="insights-kpis insights-kpis--revenue">
      <div><span>Active subscriptions</span><strong>{row.activeSubscriptions}</strong></div>
      <div><span>Active trials</span><strong>{row.activeTrials}</strong></div>
      <div><span>Started</span><strong>{row.subscriptionsStarted}</strong></div>
      <div><span>Cancel intent / ended</span><strong>{row.cancelIntents} / {row.subscriptionsEnded}</strong></div>
      <div><span>Payment failures</span><strong>{row.paymentsFailed}</strong></div>
      <div><span>Refunds</span><strong>{row.refunds}</strong></div>
    </div>}
  </PanelShell>;
}
