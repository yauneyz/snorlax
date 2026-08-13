import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryEngagement } from "@/server/analytics/queries/engagement";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function EngagementPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryEngagement(target);
  const data = result.ok ? result.rows.engagement : null;
  return <PanelShell title="Engagement depth" description="Latest reported day, split by how focus began.">
    {!result.ok ? <Unavailable message={result.message} /> : !data ? <p className="insights-muted">No usage reported yet.</p> :
      <div className="insights-kpis">
        <div><span>Median focus</span><strong>{data.medianFocusMinutes}m</strong></div>
        <div><span>Scheduled</span><strong>{data.scheduledFocusHours}h</strong></div>
        <div><span>Manual</span><strong>{data.manualFocusHours}h</strong></div>
        <div><span>Completed / aborted</span><strong>{data.sessionsCompleted} / {data.sessionsAborted}</strong></div>
      </div>}
  </PanelShell>;
}
