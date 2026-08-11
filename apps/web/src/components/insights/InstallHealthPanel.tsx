import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryInstallHealth } from "@/server/analytics/queries/install-health";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function InstallHealthPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryInstallHealth(target);
  const totals = result.ok ? result.rows.filter((row) => row.failure_reason === null) : [];
  const failures = result.ok ? result.rows.filter((row) => row.failure_reason !== null) : [];
  return <PanelShell title="Desktop install health" description="Milestones by platform; failures grouped by reported reason.">
    {!result.ok ? <Unavailable message={result.message} /> : result.rows.length === 0 ? <p className="insights-muted">No desktop milestones yet.</p> : <>
      <div className="insights-table-wrap"><table className="insights-table"><thead><tr><th>Platform</th><th>Installed</th><th>Service ready</th><th>Extension</th></tr></thead><tbody>{totals.map((row) => <tr key={row.platform}><td>{row.platform}</td><td>{row.app_installed}</td><td>{row.service_installed}</td><td>{row.extension_connected}</td></tr>)}</tbody></table></div>
      {failures.length ? <ul className="insights-failures">{failures.map((row) => <li key={`${row.platform}:${row.failure_reason}`}><code>{row.platform}</code> {row.failure_reason}: <strong>{row.install_failed}</strong></li>)}</ul> : null}
    </>}
  </PanelShell>;
}
