import type { AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryPmf } from "@/server/analytics/queries/pmf";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function PmfPanel({
  target,
  audience,
}: {
  target: AnalyticsTarget;
  audience: AnalyticsAudience;
}) {
  const result = await queryPmf(target, audience);
  const row = result.ok ? result.rows : null;
  return (
    <PanelShell
      title="Product-market fit"
      description={'Sean Ellis survey — "how would you feel if you could no longer use Talysman?" 40% very disappointed is the classic PMF threshold.'}
    >
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : !row || row.responses === 0 ? (
        <p className="insights-muted">No survey responses yet.</p>
      ) : (
        <div className="insights-kpis insights-kpis--pmf">
          <div>
            <span>Very disappointed</span>
            <strong>{row.pctVeryDisappointed}%</strong>
          </div>
          <div>
            <span>Somewhat disappointed</span>
            <strong>{row.pctSomewhatDisappointed}%</strong>
          </div>
          <div>
            <span>Not disappointed</span>
            <strong>{row.pctNotDisappointed}%</strong>
          </div>
          <div>
            <span>Responses</span>
            <strong>{row.responses}</strong>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
