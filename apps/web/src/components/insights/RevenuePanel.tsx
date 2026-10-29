import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryRevenue } from "@/server/analytics/queries/revenue";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export async function RevenuePanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const result = await queryRevenue(target, audience);
  const row = result.ok ? result.rows : null;
  return (
    <PanelShell
      title="Revenue"
      description="Right now. Active excludes anything set to cancel at period end; those are counted as canceling instead."
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : !row ? (
        <p className="insights-muted">No revenue data yet.</p>
      ) : (
        <div className="insights-kpis insights-kpis--revenue">
          <div>
            <span>Active subscriptions</span>
            <strong>{row.activeSubscriptions}</strong>
          </div>
          <div>
            <span>Active trials</span>
            <strong>{row.activeTrials}</strong>
          </div>
          <div>
            <span>MRR (list price)</span>
            <strong>{dollars(row.mrrCents)}</strong>
          </div>
          <div>
            <span>Canceling subs / trials</span>
            <strong>
              {row.cancelingSubscriptions} / {row.cancelingTrials}
            </strong>
          </div>
          <div>
            <span>Lifetime customers</span>
            <strong>{row.lifetimeCustomers}</strong>
          </div>
          <div>
            <span>Subscriptions started</span>
            <strong>{row.subscriptionsStarted}</strong>
          </div>
          <div>
            <span>Cancel intent / ended</span>
            <strong>
              {row.cancelIntents} / {row.subscriptionsEnded}
            </strong>
          </div>
          <div>
            <span>Payment failures</span>
            <strong>{row.paymentsFailed}</strong>
          </div>
          <div>
            <span>Refunds</span>
            <strong>{row.refunds}</strong>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
