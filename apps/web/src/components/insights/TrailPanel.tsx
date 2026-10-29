import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryTrail } from "@/server/analytics/queries/trail";
import type { TrailOutcomeMetrics } from "@/server/analytics/queries/types";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((1000 * part) / whole) / 10}%` : "—";
}

/**
 * The channel trail (migration 0022): every person keeps an outside-world source, a blog
 * channel and an affiliate side by side, so each layer can be judged on outcomes and the
 * journeys between them read directly. Rows are ordered by what's paying now, so the top of each
 * table is what to double down on.
 */
export async function TrailPanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const result = await queryTrail(target, audience);
  return (
    <PanelShell
      title="Channel trail"
      className="insights-panel--wide"
      description="All time. Every person on all three layers at once: where they came from, which post they read, which affiliate sent them. Active now excludes anything set to cancel. The (no blog) and (no affiliate) rows are the baseline to beat."
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : (
        <>
          <Layer title="Source — the outside world" rows={result.rows.sources} />
          <Layer title="Blog — first post read, or first → CTA post" rows={result.rows.blog} />
          <Layer title="Affiliate" rows={result.rows.affiliates} />
          <Layer title="Journeys — the paths people take, busiest first" rows={result.rows.journeys} />
        </>
      )}
    </PanelShell>
  );
}

function Layer({ title, rows }: { title: string; rows: TrailOutcomeMetrics[] }) {
  return (
    <div className="insights-trail-layer">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="insights-muted">Nobody on this layer yet.</p>
      ) : (
        <div className="insights-table-wrap">
          <table className="insights-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>People</th>
                <th>Last 30d</th>
                <th>Downloads</th>
                <th>Paired</th>
                <th>Trials</th>
                <th>Paid</th>
                <th>Active trials</th>
                <th>Active subs</th>
                <th>Lifetime</th>
                <th>Person → trial</th>
                <th>Person → paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.channel}:${row.kind}`}>
                  <td>
                    <strong>{row.channel}</strong>
                    <small>{row.kind}</small>
                  </td>
                  <td>{row.people}</td>
                  <td>{row.people30d}</td>
                  <td>{row.downloaded}</td>
                  <td>{row.paired}</td>
                  <td>{row.trials}</td>
                  <td>{row.paid}</td>
                  <td>{row.activeTrials}</td>
                  <td>{row.activeSubs}</td>
                  <td>{row.lifetime}</td>
                  <td>{pct(row.trials, row.people)}</td>
                  <td>{pct(row.paid + row.lifetime, row.people)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
