import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryMigrationState } from "@/server/analytics/queries/migration-state";
import { PanelShell } from "./PanelShell";
import { Unavailable } from "./Unavailable";

export async function MigrationStatePanel({ target }: { target: AnalyticsTarget }) {
  const result = await queryMigrationState(target);
  return (
    <PanelShell title="Migration state" description="Expected analytics relations on this target.">
      {!result.ok ? (
        <Unavailable message={result.message} />
      ) : (
        <ul className="insights-relation-list">
          {result.rows.map((row) => (
            <li key={row.relation} className={row.present ? "is-present" : "is-absent"}>
              <span aria-hidden>{row.present ? "●" : "×"}</span>
              <code>{row.relation}</code>
              <small>{row.present ? "present" : "absent"}</small>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
