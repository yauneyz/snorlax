import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryChannels } from "@/server/analytics/queries/channels";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function ChannelTablePanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryChannels(target);
  return (
    <PanelShell title="Channels" description="First-touch source and medium over the last 90 days.">
      {!result.ok ? <Unavailable message={result.message} /> : result.rows.length === 0 ? (
        <p className="insights-muted">No attributed visitors yet.</p>
      ) : (
        <div className="insights-table-wrap"><table className="insights-table">
          <thead><tr><th>Source / medium</th><th>Visitors</th><th>Accounts</th><th>Trials</th><th>Paid</th><th>Visit → paid</th></tr></thead>
          <tbody>{result.rows.map((row) => <tr key={`${row.channel}:${row.medium}`}>
            <td><strong>{row.channel}</strong><small>{row.medium}</small></td>
            <td>{row.visitors}</td><td>{row.accounts}</td><td>{row.trials}</td><td>{row.paid}</td>
            <td>{row.pct_visitor_to_paid ?? 0}%</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </PanelShell>
  );
}
