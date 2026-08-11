import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryRetention } from "@/server/analytics/queries/retention";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

const pct = (active: number, eligible: number) => eligible ? `${Math.round(active / eligible * 100)}%` : "—";

export async function RetentionPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryRetention(target);
  return <PanelShell title="Retention cohorts" description="Protected-active windows: D1 1–2, D7 5–9, D30 27–33.">
    {!result.ok ? <Unavailable message={result.message} /> : result.rows.length === 0 ? <p className="insights-muted">No install cohorts yet.</p> :
      <div className="insights-table-wrap"><table className="insights-table"><thead><tr><th>Install week</th><th>Devices</th><th>D1</th><th>D7</th><th>D30</th></tr></thead>
      <tbody>{result.rows.map((row) => <tr key={row.cohort_week}><td>{row.cohort_week}</td><td>{row.devices}</td><td>{pct(row.d1_protected, row.eligible_d1)}</td><td>{pct(row.d7_protected, row.eligible_d7)}</td><td>{pct(row.d30_protected, row.eligible_d30)}</td></tr>)}</tbody></table></div>}
  </PanelShell>;
}
