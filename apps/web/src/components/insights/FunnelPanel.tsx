import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryFunnel } from "@/server/analytics/queries/funnel";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

export async function FunnelPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryFunnel(target);
  if (!result.ok) return <PanelShell title="90-day funnel"><Unavailable message={result.message} /></PanelShell>;
  if (!result.rows) return <PanelShell title="90-day funnel"><p className="insights-muted">No funnel data yet.</p></PanelShell>;

  const row = result.rows;
  const steps = [
    ["page_viewed", "Visitors", row.visitors, false],
    ["download_clicked", "Downloads", row.downloaded, false],
    ["app_installed", "Installs ≈", row.installed, true],
    ["account_created", "Accounts", row.accounts, false],
    ["usb_key_paired", "Paired", row.paired, false],
    ["focus_session_completed", "Activated", row.activated, false],
    ["trial_started", "Trials", row.trials, false],
    ["subscription_started", "Paid", row.paid, false],
  ] as const;

  return (
    <PanelShell title="90-day funnel" description="First-touch people; download → install is an aggregate estimate.">
      <div className="insights-funnel">
        {steps.map(([event, label, count, estimated], index) => {
          const previous = index === 0 ? count : steps[index - 1][2];
          const conversion = previous > 0 ? Math.round((count / previous) * 100) : 0;
          return (
            <div className="insights-funnel__step" key={event}>
              <span>{label}{estimated ? <sup title="Estimated"> est.</sup> : null}</span>
              <strong data-testid={`funnel-step-${event}`} data-count={count}>{count.toLocaleString()}</strong>
              <small>{index === 0 ? "90 days" : `${conversion}% from prior`}</small>
            </div>
          );
        })}
      </div>
      <div className="insights-inline-stats">
        <span>Median visit → download <strong>{duration(row.medianVisitToDownloadSeconds)}</strong></span>
        <span>Median install → value <strong>{duration(row.medianInstallToValueSeconds)}</strong></span>
      </div>
    </PanelShell>
  );
}
