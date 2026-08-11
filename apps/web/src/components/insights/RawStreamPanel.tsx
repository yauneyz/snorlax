import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryRawStream } from "@/server/analytics/queries/raw-stream";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

function short(value: string | null): string { return value ? value.slice(0, 8) : "—"; }

export async function RawStreamPanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryRawStream(target);
  return <PanelShell title="Raw stream" description="Last 200 milestone events and 50 latest daily usage reports." className="insights-panel--wide">
    {!result.ok ? <Unavailable message={result.message} /> : <div className="insights-raw-grid">
      <div><h3>Events</h3><div className="insights-table-wrap"><table className="insights-table insights-table--raw"><thead><tr><th>Received</th><th>Event</th><th>IDs</th><th>Source</th><th>Props</th></tr></thead><tbody>{result.rows.events.map((row) => <tr key={row.id}><td>{new Date(row.received_at).toLocaleString()}</td><td><code>{row.event}</code></td><td title={`anon ${row.anon_id ?? "—"}\ndevice ${row.device_id ?? "—"}\nuser ${row.user_id ?? "—"}`}>{short(row.user_id)}/{short(row.device_id)}/{short(row.anon_id)}</td><td>{row.source}</td><td><code>{JSON.stringify(row.props)}</code></td></tr>)}</tbody></table></div></div>
      <div><h3>Usage</h3><div className="insights-table-wrap"><table className="insights-table insights-table--raw"><thead><tr><th>Date</th><th>Device</th><th>Platform</th><th>Focus</th><th>Sessions</th><th>Reported</th></tr></thead><tbody>{result.rows.usage.map((row) => <tr key={`${row.device_id}:${row.local_date}`}><td>{row.local_date}</td><td title={row.device_id}>{short(row.device_id)}</td><td>{row.platform}</td><td>{Math.round(row.focus_seconds / 60)}m</td><td>{row.sessions_completed}/{row.sessions_aborted}</td><td>{new Date(row.reported_at).toLocaleString()}</td></tr>)}</tbody></table></div></div>
    </div>}
  </PanelShell>;
}
