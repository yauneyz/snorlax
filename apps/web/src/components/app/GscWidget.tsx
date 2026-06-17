"use client";
import { useState } from "react";
import { ConnectGoogleButton } from "./ConnectGoogleButton";

type RankedRow = {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type QueryResult = {
  queries: RankedRow[];
  pages: RankedRow[];
};

const RANGES = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "28", label: "Last 28 days", days: 28 },
  { id: "90", label: "Last 90 days", days: 90 },
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatPos(n: number): string {
  return n.toFixed(1);
}

export function GscWidget({ sites }: { sites: { siteUrl: string; permissionLevel: string }[] }) {
  const [siteUrl, setSiteUrl] = useState(sites[0]?.siteUrl ?? "");
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("28");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [data, setData] = useState<QueryResult | null>(null);

  if (sites.length === 0) {
    return (
      <div className="gsc-widget gsc-widget--empty">
        <p>
          Your Google account has no verified Search Console properties. Verify a site in{" "}
          <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">
            Search Console
          </a>{" "}
          and reload this page.
        </p>
      </div>
    );
  }

  const onRun = async () => {
    setPending(true);
    setError(null);
    setReauth(false);
    try {
      const range = RANGES.find((r) => r.id === rangeId)!;
      const res = await fetch("/api/data-sources/gsc/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteUrl,
          startDate: isoDaysAgo(range.days),
          endDate: isoDaysAgo(1), // GSC has a ~2-3 day lag; pick yesterday for stability.
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        queries?: RankedRow[];
        pages?: RankedRow[];
      };
      if (!res.ok) {
        if (body.error === "reauth_required" || body.error === "not_connected") {
          setReauth(true);
        }
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setData({ queries: body.queries ?? [], pages: body.pages ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gsc-widget">
      <form
        className="gsc-widget__form"
        onSubmit={(e) => {
          e.preventDefault();
          void onRun();
        }}
      >
        <label className="gsc-widget__field">
          <span>Site</span>
          <select value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}>
            {sites.map((s) => (
              <option key={s.siteUrl} value={s.siteUrl}>
                {s.siteUrl}
              </option>
            ))}
          </select>
        </label>
        <label className="gsc-widget__field">
          <span>Range</span>
          <select
            value={rangeId}
            onChange={(e) => setRangeId(e.target.value as (typeof RANGES)[number]["id"])}
          >
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="gsc-widget__run" disabled={pending || !siteUrl}>
          {pending ? "Running…" : "Run"}
        </button>
      </form>

      {error ? <p className="gsc-widget__error">{error}</p> : null}
      {reauth ? <ConnectGoogleButton label="Reconnect Google" /> : null}

      {data ? (
        <div className="gsc-widget__results">
          <Table title="Top queries" rows={data.queries} keyHeader="Query" />
          <Table title="Top pages" rows={data.pages} keyHeader="Page" />
        </div>
      ) : null}
    </div>
  );
}

function Table({
  title,
  rows,
  keyHeader,
}: {
  title: string;
  rows: RankedRow[];
  keyHeader: string;
}) {
  return (
    <section className="gsc-widget__table">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>No rows.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{keyHeader}</th>
              <th>Clicks</th>
              <th>Impressions</th>
              <th>CTR</th>
              <th>Avg pos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td>{r.clicks.toLocaleString()}</td>
                <td>{r.impressions.toLocaleString()}</td>
                <td>{formatPct(r.ctr)}</td>
                <td>{formatPos(r.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
