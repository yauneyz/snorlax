#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import toml from "@iarna/toml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const credentialsPath = [
  join(root, ".credentials"),
  resolve(root, "../indigo/.credentials"),
].find((candidate) => existsSync(candidate));

const tables = [
  { name: "analytics_events", nonNullColumn: "id" },
  { name: "analytics_usage_daily", nonNullColumn: "device_id" },
  { name: "analytics_identities", nonNullColumn: "identifier" },
  { name: "analytics_persons", nonNullColumn: "id" },
];

function usage() {
  console.log(`Usage: pnpm analytics:reset:prod [--dry-run] [--yes]

Deletes every row from the four production analytics source tables. Dashboard views
recompute from those tables and therefore return zero afterward.

Options:
  --dry-run  Show the target and current row counts without deleting anything
  --yes      Skip the interactive production confirmation (for automation)
  --help     Show this help`);
}

function parseArgs(args) {
  const known = new Set(["--dry-run", "--yes", "--help", "-h"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  return {
    dryRun: args.includes("--dry-run"),
    yes: args.includes("--yes"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

function productionCredentials() {
  const environmentUrl = process.env.ANALYTICS_PROD_SUPABASE_URL?.trim();
  const environmentKey = process.env.ANALYTICS_PROD_SUPABASE_SECRET_KEY?.trim();
  const environmentRef = process.env.ANALYTICS_PROD_SUPABASE_PROJECT_REF?.trim();

  if (environmentUrl || environmentKey || environmentRef) {
    if (!environmentUrl || !environmentKey) {
      throw new Error(
        "ANALYTICS_PROD_SUPABASE_URL and ANALYTICS_PROD_SUPABASE_SECRET_KEY must be set together.",
      );
    }
    return {
      url: environmentUrl,
      secretKey: environmentKey,
      projectRef: environmentRef || new URL(environmentUrl).hostname.split(".")[0],
    };
  }

  if (!credentialsPath) {
    throw new Error(
      "Missing .credentials and ANALYTICS_PROD_SUPABASE_URL/ANALYTICS_PROD_SUPABASE_SECRET_KEY.",
    );
  }

  const credentials = toml.parse(readFileSync(credentialsPath, "utf8"));
  const prod = credentials.supabase?.prod;
  if (!prod?.url || !prod?.secret_key || !prod?.project_ref) {
    throw new Error(
      `${credentialsPath} must define supabase.prod.url, secret_key, and project_ref.`,
    );
  }
  return {
    url: String(prod.url),
    secretKey: String(prod.secret_key),
    projectRef: String(prod.project_ref),
  };
}

function normalizeProjectUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/(?:rest|auth|storage|functions|realtime)\/v\d+\/?$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function countFromContentRange(value, table) {
  const count = value?.match(/\/(\d+)$/)?.[1];
  if (count === undefined) {
    throw new Error(`Supabase did not return an exact count for ${table}.`);
  }
  return Number(count);
}

async function request(project, table, init, filter = "") {
  const response = await fetch(`${project.url}/rest/v1/${table.name}?select=*${filter}`, {
    ...init,
    headers: {
      apikey: project.secretKey,
      Authorization: `Bearer ${project.secretKey}`,
      Prefer: "count=exact,return=minimal",
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `${init.method} ${table.name} failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return response;
}

async function tableCounts(project) {
  return Promise.all(
    tables.map(async (table) => {
      const response = await request(project, table, { method: "HEAD" });
      return {
        table: table.name,
        count: countFromContentRange(response.headers.get("content-range"), table.name),
      };
    }),
  );
}

async function confirmReset(projectRef) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive confirmation requires a terminal; pass --yes to confirm.");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type the production project ref (${projectRef}) to reset: `);
    if (answer.trim() !== projectRef) {
      throw new Error("Confirmation did not match; production analytics were not changed.");
    }
  } finally {
    prompt.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const credentials = productionCredentials();
  const project = { ...credentials, url: normalizeProjectUrl(credentials.url) };
  const host = new URL(project.url).host;
  if (!project.projectRef || project.projectRef === "localhost" || host.startsWith("127.0.0.1")) {
    throw new Error(`Refusing to treat ${host} as the production Supabase project.`);
  }
  if (host.endsWith(".supabase.co") && host !== `${project.projectRef}.supabase.co`) {
    throw new Error(`Production project ref ${project.projectRef} does not match ${host}.`);
  }

  console.log(`Production Supabase: ${project.projectRef} (${host})`);
  const before = await tableCounts(project);
  for (const { table, count } of before) console.log(`${table}: ${count}`);

  if (options.dryRun) {
    console.log("Dry run complete; no rows were deleted.");
    return;
  }
  if (!options.yes) await confirmReset(project.projectRef);

  for (const table of tables) {
    await request(project, table, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      // Every source table has a non-null key, making this an explicit all-row filter.
      // PostgREST rejects DELETE requests that have no filter at all.
      body: undefined,
    }, `&${table.nonNullColumn}=not.is.null`);
  }

  const after = await tableCounts(project);
  const remaining = after.filter(({ count }) => count !== 0);
  if (remaining.length > 0) {
    throw new Error(
      `Reset verification failed: ${remaining.map(({ table, count }) => `${table}=${count}`).join(", ")}`,
    );
  }
  console.log("Production analytics reset complete; all four source tables contain 0 rows.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
