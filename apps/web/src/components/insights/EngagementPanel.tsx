import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryEngagement } from "@/server/analytics/queries/engagement";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function EngagementPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryEngagement(target);
  const latest = result.ok ? result.rows[0] : null;
  return <PanelShell title="Engagement depth" description="Latest reported day, split by how focus began.">
    {!result.ok ? <Unavailable message={result.message} /> : !latest ? <p className="insights-muted">No usage reported yet.</p> :
      <div className="insights-kpis">
        <div><span>Median focus</span><strong>{latest.median_focus_minutes ?? 0}m</strong></div>
        <div><span>Scheduled</span><strong>{latest.scheduled_focus_hours ?? 0}h</strong></div>
        <div><span>Manual</span><strong>{latest.manual_focus_hours ?? 0}h</strong></div>
        <div><span>Completed / aborted</span><strong>{latest.sessions_completed ?? 0} / {latest.sessions_aborted ?? 0}</strong></div>
      </div>}
  </PanelShell>;
}
