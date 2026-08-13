import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryInstallHealth } from "@/server/analytics/queries/install-health";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function InstallHealthPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryInstallHealth(target);
  const empty = result.ok && result.rows.platforms.length === 0 && result.rows.failures.length === 0;
  return <PanelShell title="Desktop install health" description="Milestones by platform; failures grouped by reported reason.">
    {!result.ok ? <Unavailable message={result.message} /> : empty ? <p className="insights-muted">No desktop milestones yet.</p> : <>
      <div className="insights-table-wrap"><table className="insights-table"><thead><tr><th>Platform</th><th>Installed</th><th>Service ready</th><th>Extension</th></tr></thead><tbody>{result.rows.platforms.map((row) => <tr key={row.platform}><td>{row.platform}</td><td>{row.appInstalled}</td><td>{row.serviceInstalled}</td><td>{row.extensionConnected}</td></tr>)}</tbody></table></div>
      {result.rows.failures.length ? <ul className="insights-failures">{result.rows.failures.map((row) => <li key={`${row.platform}:${row.reason}`}><code>{row.platform}</code> {row.reason}: <strong>{row.count}</strong></li>)}</ul> : null}
    </>}
  </PanelShell>;
}
