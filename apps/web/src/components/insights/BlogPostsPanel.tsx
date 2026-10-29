import { listPosts } from "@/lib/content/blog";
import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryBlogPosts } from "@/server/analytics/queries/blog-posts";
import type { BlogPostMetrics } from "@/server/analytics/queries/types";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((1000 * part) / whole) / 10}%` : "—";
}

/** "linked / first-read" — the second number only when it differs, which is the hybrid case. */
function Step({ linked, firstRead }: { linked: number; firstRead: number }) {
  return (
    <>
      {linked}
      {firstRead !== linked ? <span className="insights-muted"> / {firstRead}</span> : null}
    </>
  );
}

/**
 * Per-post traffic and conversions (migration 0021). A reader is filed under the first post they
 * read before converting, or under "first → clicked" when they click the CTA on another post.
 * Conversion columns show people linked to the post (first read OR its CTA clicked), then — when
 * different — the first-read-only count, which never double counts across posts.
 */
export async function BlogPostsPanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const [result, posts] = await Promise.all([queryBlogPosts(target, audience), listPosts()]);
  const titles = new Map(posts.map(({ frontmatter }) => [frontmatter.slug, frontmatter.title]));
  return (
    <PanelShell
      title="Blog"
      description="Last 90 days. Conversions are people linked to the post (read it first, or clicked its CTA) before converting; a muted second number is first-read only. Hybrid channels are in Channels."
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : result.rows.length === 0 ? (
        <p className="insights-muted">No blog traffic recorded yet.</p>
      ) : (
        <div className="insights-table-wrap">
          <table className="insights-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Views</th>
                <th>7d</th>
                <th>Readers</th>
                <th>Entrances</th>
                <th>CTA clicks</th>
                <th>CTA rate</th>
                <th>Downloads</th>
                <th>Paired</th>
                <th>Trials</th>
                <th>Paid</th>
                <th>Reader → paired</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <Row key={row.slug} row={row} title={titles.get(row.slug)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

function Row({ row, title }: { row: BlogPostMetrics; title: string | undefined }) {
  return (
    <tr>
      <td>
        {title ?? <span className="insights-muted">unknown post</span>}
        <br />
        <code>{row.slug}</code>
      </td>
      <td>{row.views}</td>
      <td>{row.views7d}</td>
      <td>{row.visitors}</td>
      <td>{row.entrances}</td>
      <td>{row.ctaClickers}</td>
      <td>{pct(row.ctaClickers, row.visitors)}</td>
      <td>
        <Step linked={row.linkedDownloaded} firstRead={row.downloaded} />
      </td>
      <td>
        <Step linked={row.linkedPaired} firstRead={row.paired} />
      </td>
      <td>
        <Step linked={row.linkedTrials} firstRead={row.trials} />
      </td>
      <td>
        <Step linked={row.linkedPaid} firstRead={row.paid} />
      </td>
      <td>{pct(row.linkedPaired, row.visitors)}</td>
    </tr>
  );
}
