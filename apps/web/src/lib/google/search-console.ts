import "server-only";
import { google, type Auth } from "googleapis";

export type SiteEntry = {
  siteUrl: string;
  permissionLevel: string;
};

export type PerformanceRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type DateRange = {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
};

function wm(client: Auth.OAuth2Client) {
  return google.webmasters({ version: "v3", auth: client });
}

export async function listSites(client: Auth.OAuth2Client): Promise<SiteEntry[]> {
  const { data } = await wm(client).sites.list({});
  return (data.siteEntry ?? [])
    .filter((s) => s.siteUrl)
    .map((s) => ({
      siteUrl: s.siteUrl as string,
      permissionLevel: (s.permissionLevel as string | undefined) ?? "",
    }));
}

const ROW_LIMIT = 25_000;

export async function queryPerformance(
  client: Auth.OAuth2Client,
  input: DateRange & {
    siteUrl: string;
    dimensions: ("query" | "page" | "country" | "device" | "date")[];
    rowCap?: number;
  },
): Promise<PerformanceRow[]> {
  const rows: PerformanceRow[] = [];
  let startRow = 0;
  const cap = input.rowCap ?? Number.POSITIVE_INFINITY;

  for (;;) {
    const { data } = await wm(client).searchanalytics.query({
      siteUrl: input.siteUrl,
      requestBody: {
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        aggregationType: "byProperty",
        dataState: "final",
        rowLimit: ROW_LIMIT,
        startRow,
      },
    });
    const batch = (data.rows ?? []).map((r) => ({
      keys: r.keys ?? [],
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));
    rows.push(...batch);
    if (rows.length >= cap || batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
  }
  return rows.slice(0, cap);
}

export type RankedRow = {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function flatten(rows: PerformanceRow[]): RankedRow[] {
  return rows.map((r) => ({
    key: r.keys[0] ?? "",
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

export async function topQueries(
  client: Auth.OAuth2Client,
  siteUrl: string,
  range: DateRange,
  limit = 50,
): Promise<RankedRow[]> {
  const rows = await queryPerformance(client, {
    siteUrl,
    ...range,
    dimensions: ["query"],
    rowCap: limit,
  });
  return flatten(rows);
}

export async function topPages(
  client: Auth.OAuth2Client,
  siteUrl: string,
  range: DateRange,
  limit = 50,
): Promise<RankedRow[]> {
  const rows = await queryPerformance(client, {
    siteUrl,
    ...range,
    dimensions: ["page"],
    rowCap: limit,
  });
  return flatten(rows);
}
