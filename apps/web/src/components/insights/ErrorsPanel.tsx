import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryRecentErrors } from "@/server/analytics/queries/errors";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function ErrorsPanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const result = await queryRecentErrors(target, audience);
  return (
    <PanelShell
      title="Install-blocking errors"
      description="Full text of bootstrap/service/window failures, most recent first."
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : result.rows.length === 0 ? (
        <p className="insights-muted">No errors reported.</p>
      ) : (
        <ul className="insights-failures">
          {result.rows.map((row) => (
            <li key={`${row.deviceId}:${row.event}:${row.occurredAt}`}>
              <code>{row.platform ?? "?"}</code> {row.event} — {row.occurredAt}
              <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{row.message}</pre>
              {row.stack ? (
                <details>
                  <summary>Stack</summary>
                  <pre style={{ whiteSpace: "pre-wrap" }}>{row.stack}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
