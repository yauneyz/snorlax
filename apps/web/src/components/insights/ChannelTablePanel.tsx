import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryChannels } from "@/server/analytics/queries/channels";
import { queryVisitorBreakdown } from "@/server/analytics/queries/visitor-breakdown";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function ChannelTablePanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const [result, breakdown] = await Promise.all([
    queryChannels(target, audience),
    queryVisitorBreakdown(target, audience),
  ]);
  return (
    <PanelShell
      title="Acquisition channels"
      description="First-touch traffic through download, install, and paid conversion over the last 90 days."
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : result.rows.length === 0 ? (
        <p className="insights-muted">No attributed visitors yet.</p>
      ) : (
        <div className="insights-table-wrap">
          <table className="insights-table">
            <thead>
              <tr>
                <th>Source / medium</th>
                <th>Visitors</th>
                <th>Downloads</th>
                <th>Installs</th>
                <th>Trials</th>
                <th>Paid</th>
                <th>Visit → paid</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={`${row.channel}:${row.medium}`}>
                  <td>
                    <strong>{row.channel}</strong>
                    <small>{row.medium}</small>
                  </td>
                  <td>{row.visitors}</td>
                  <td>{row.downloaded}</td>
                  <td>{row.installed}</td>
                  <td>{row.trials}</td>
                  <td>{row.paid}</td>
                  <td>{row.pctVisitorToPaid}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {breakdown.ok ? (
            <div className="insights-breakdowns">
              <Breakdown title="Device type" rows={breakdown.rows.deviceTypes} />
              <Breakdown title="Operating system" rows={breakdown.rows.operatingSystems} />
            </div>
          ) : (
            <Unavailable message={breakdown.message} />
          )}
        </div>
      )}
    </PanelShell>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; visitors: number; pctVisitors: number }[];
}) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="insights-muted">No visitor data yet.</p>
      ) : (
        <dl>
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                {row.visitors.toLocaleString()} <small>{row.pctVisitors}%</small>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
