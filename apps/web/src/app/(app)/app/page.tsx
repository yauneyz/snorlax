import type { Metadata } from "next";
import Link from "next/link";
import { ManageBillingButton } from "@/components/app/ManageBillingButton";
import { requireAuthenticatedUiRoute } from "@/lib/auth/require-authenticated-ui-route";
import { getConnectionForUser } from "@/lib/connections/store";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default async function AppPage() {
  const { user } = await requireAuthenticatedUiRoute();
  const gsc = await getConnectionForUser(user.id, "gsc");

  return (
    <section className="dashboard">
      <h1>Welcome to {config.app.name}</h1>
      <p>You are signed in as {user.email}.</p>

      <section className="data-sources">
        <h2>Data sources</h2>
        <ul className="data-sources__list">
          <li className="data-source">
            <span className="data-source__name">Google Search Console</span>
            <span className="data-source__status">
              {gsc ? `connected as ${gsc.row.label}` : "not connected"}
            </span>
            <Link href="/app/data-sources/gsc" className="data-source__link">
              Open
            </Link>
          </li>
        </ul>
      </section>

      <ManageBillingButton />
    </section>
  );
}
