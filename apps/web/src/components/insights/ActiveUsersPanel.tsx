import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryEngagement } from "@/server/analytics/queries/engagement";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function ActiveUsersPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryEngagement(target);
  const latest = result.ok ? result.rows[0] : null;
  return <PanelShell title="Active users" description="Protected activity is at least 60 seconds of focus.">
    {!result.ok ? <Unavailable message={result.message} /> : !latest ? <p className="insights-muted">No usage reported yet.</p> : <>
      <div className="insights-kpis">
        <div><span>DAU protected</span><strong>{latest.dau_protected}</strong></div>
        <div><span>DAU UI</span><strong>{latest.dau_ui}</strong></div>
        <div><span>MAU protected</span><strong>{latest.mau_protected}</strong></div>
        <div><span>30d installed base</span><strong>{latest.installed_base_30d}</strong></div>
      </div>
      <div className="insights-spark-table">{result.rows.slice(0, 14).reverse().map((row) =>
        <div key={row.local_date} title={`${row.local_date}: ${row.dau_protected}`}>
          <i style={{ height: `${Math.max(4, Math.min(100, row.dau_protected * 8))}%` }} />
          <small>{row.local_date.slice(5)}</small>
        </div>)}</div>
      <p className="insights-footnote">The latest two days are provisional while offline devices backfill.</p>
    </>}
  </PanelShell>;
}
