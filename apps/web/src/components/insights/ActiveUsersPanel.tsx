import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryEngagement } from "@/server/analytics/queries/engagement";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function ActiveUsersPanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const result = await queryEngagement(target, audience);
  const data = result.ok ? result.rows.activeUsers : null;
  return (
    <PanelShell
      title="Active users"
      description="Protected activity is at least 60 seconds of focus."
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : !data ? (
        <p className="insights-muted">No usage reported yet.</p>
      ) : (
        <>
          <div className="insights-kpis">
            <div>
              <span>DAU protected</span>
              <strong>{data.dauProtected}</strong>
            </div>
            <div>
              <span>DAU UI</span>
              <strong>{data.dauUi}</strong>
            </div>
            <div>
              <span>MAU protected</span>
              <strong>{data.mauProtected}</strong>
            </div>
            <div>
              <span>30d installed base</span>
              <strong>{data.installedBase30d}</strong>
            </div>
          </div>
          <div className="insights-spark-table">
            {data.series.map((point) => (
              <div key={point.date} title={`${point.date}: ${point.dauProtected}`}>
                <i style={{ height: `${Math.max(4, Math.min(100, point.dauProtected * 8))}%` }} />
                <small>{point.date.slice(5)}</small>
              </div>
            ))}
          </div>
          <p className="insights-footnote">
            The latest two days are provisional while offline devices backfill.
          </p>
        </>
      )}
    </PanelShell>
  );
}
