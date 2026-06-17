import type { Metadata } from "next";
import { ConnectGoogleButton } from "@/components/app/ConnectGoogleButton";
import { GscWidget } from "@/components/app/GscWidget";
import { requireAuthenticatedUiRoute } from "@/lib/auth/require-authenticated-ui-route";
import { getConnectionForUser } from "@/lib/connections/store";
import { googleClientForConnection } from "@/lib/google/oauth";
import { listSites, type SiteEntry } from "@/lib/google/search-console";

export const metadata: Metadata = {
  title: "Google Search Console",
  robots: { index: false, follow: false },
};

type SearchParams = { error?: string };

export default async function GscPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requireAuthenticatedUiRoute();
  const conn = await getConnectionForUser(user.id, "gsc");
  const params = await searchParams;

  if (!conn) {
    return (
      <section className="gsc-page">
        <h1>Google Search Console</h1>
        {params.error ? <p className="gsc-page__error">{describeError(params.error)}</p> : null}
        <ConnectGoogleButton />
      </section>
    );
  }

  let sites: SiteEntry[] = [];
  let listError: string | null = null;
  try {
    const client = await googleClientForConnection(conn.row.id);
    sites = await listSites(client);
  } catch (err) {
    listError = err instanceof Error ? err.message : "Failed to load sites";
  }

  return (
    <section className="gsc-page">
      <h1>Google Search Console</h1>
      <p className="gsc-page__connected">
        Connected as <strong>{conn.row.label}</strong>
      </p>
      {listError ? (
        <>
          <p className="gsc-page__error">
            We couldn&apos;t load your Search Console properties. You may need to reconnect.
          </p>
          <ConnectGoogleButton label="Reconnect Google" />
        </>
      ) : (
        <GscWidget sites={sites} />
      )}
    </section>
  );
}

function describeError(error: string): string {
  switch (error) {
    case "missing_state":
    case "state_mismatch":
    case "bad_signature":
      return "Login flow expired. Please try connecting again.";
    case "code_exchange_failed":
      return "Google rejected the authorization. Please try again.";
    case "access_denied":
      return "You declined to grant access.";
    default:
      return `Connection failed: ${error}`;
  }
}
