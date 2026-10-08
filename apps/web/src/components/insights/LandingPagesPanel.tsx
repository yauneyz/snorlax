import { GROUP_LABELS, getIntentPage, type IntentGroup } from "@/lib/content/intent";
import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryLandingPages } from "@/server/analytics/queries/landing-pages";
import type { LandingPageMetrics } from "@/server/analytics/queries/types";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

const CLUSTERS: (IntentGroup | "other")[] = ["compare", "guides", "use-cases", "other"];

function clusterOf(path: string): IntentGroup | "other" {
  return getIntentPage(path.replace(/^\//, ""))?.group ?? "other";
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((1000 * part) / whole) / 10}%` : "—";
}

/**
 * Which search pages earn their keep (seo-layout.md §6): first-touch traffic through download,
 * activation and paid, per landing page, grouped by footer cluster. "CTA downloads" is last
 * touch — downloads started from that page's own CTA, wherever the person first landed.
 */
export async function LandingPagesPanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const result = await queryLandingPages(target, audience);
  return (
    <PanelShell
      title="Landing pages"
      description="First-touch visitors by landing page over the last 90 days, grouped by cluster. CTA downloads are last-touch."
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : result.rows.length === 0 ? (
        <p className="insights-muted">No landing pages recorded yet.</p>
      ) : (
        <div className="insights-table-wrap">
          <table className="insights-table">
            <thead>
              <tr>
                <th>Landing page</th>
                <th>Visitors</th>
                <th>Organic</th>
                <th>Downloads</th>
                <th>CTA downloads</th>
                <th>Activated</th>
                <th>Paid</th>
                <th>Visit → download</th>
                <th>Visit → activated</th>
              </tr>
            </thead>
            {CLUSTERS.map((cluster) => {
              const rows = result.rows.filter((row) => clusterOf(row.path) === cluster);
              if (rows.length === 0) return null;
              return (
                <tbody key={cluster}>
                  <Row
                    label={<strong>{cluster === "other" ? "Other pages" : GROUP_LABELS[cluster]}</strong>}
                    row={total(rows)}
                  />
                  {rows.map((row) => (
                    <Row key={row.path} label={<code>{row.path}</code>} row={row} />
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </PanelShell>
  );
}

function total(rows: LandingPageMetrics[]): LandingPageMetrics {
  const sum = (key: keyof Omit<LandingPageMetrics, "path">) =>
    rows.reduce((acc, row) => acc + row[key], 0);
  return {
    path: "",
    visitors: sum("visitors"),
    organicVisitors: sum("organicVisitors"),
    downloaded: sum("downloaded"),
    installed: sum("installed"),
    activated: sum("activated"),
    paid: sum("paid"),
    ctaDownloads: sum("ctaDownloads"),
  };
}

function Row({ label, row }: { label: React.ReactNode; row: LandingPageMetrics }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{row.visitors}</td>
      <td>{row.organicVisitors}</td>
      <td>{row.downloaded}</td>
      <td>{row.ctaDownloads}</td>
      <td>{row.activated}</td>
      <td>{row.paid}</td>
      <td>{pct(row.downloaded, row.visitors)}</td>
      <td>{pct(row.activated, row.visitors)}</td>
    </tr>
  );
}
