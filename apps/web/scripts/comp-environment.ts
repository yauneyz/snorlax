import fs from "node:fs";
import path from "node:path";
import toml from "@iarna/toml";
import { z } from "zod";

export type CompMode = "dev" | "prod";

type Flags = Record<string, string | boolean>;

const supabaseTargetSchema = z.object({
  url: z.string().url(),
  secret_key: z.string().min(1),
});

const compCredentialsSchema = z.object({
  app: z.object({
    url_dev: z.string().url(),
    url_prod: z.string().url(),
  }),
  supabase: z.object({
    dev: supabaseTargetSchema,
    prod: supabaseTargetSchema,
  }),
});

type CompCredentials = z.infer<typeof compCredentialsSchema>;

export type CompEnvironment = {
  mode: CompMode;
  label: "local development" | "production";
  appUrl: string;
  supabaseUrl: string;
  secretKey: string;
};

export function resolveCompMode(flags: Flags): CompMode {
  if (flags.dev !== undefined && flags.dev !== true) {
    throw new Error("--dev does not take a value.");
  }
  if (flags.prod !== undefined && flags.prod !== true) {
    throw new Error("--prod does not take a value.");
  }
  if (flags.dev === true && flags.prod === true) {
    throw new Error("Choose either --dev or --prod, not both.");
  }
  return flags.dev === true ? "dev" : "prod";
}

function isLocalSupabaseUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function selectCompEnvironment(
  credentials: CompCredentials,
  mode: CompMode,
): CompEnvironment {
  const supabase = credentials.supabase[mode];
  const local = isLocalSupabaseUrl(supabase.url);

  if (mode === "prod" && local) {
    throw new Error(
      `.credentials [supabase.prod] points at local Supabase (${supabase.url}); refusing a production command.`,
    );
  }
  if (mode === "prod" && new URL(supabase.url).protocol !== "https:") {
    throw new Error(
      `.credentials [supabase.prod].url must use HTTPS (received ${supabase.url}).`,
    );
  }
  if (mode === "dev" && !local) {
    throw new Error(
      `.credentials [supabase.dev] points at a hosted project (${supabase.url}); --dev may only use local Supabase.`,
    );
  }

  return {
    mode,
    label: mode === "prod" ? "production" : "local development",
    appUrl: mode === "prod" ? credentials.app.url_prod : credentials.app.url_dev,
    supabaseUrl: supabase.url.replace(/\/$/, ""),
    secretKey: supabase.secret_key,
  };
}

export function loadCompEnvironment(mode: CompMode): CompEnvironment {
  const root = path.resolve(__dirname, "../../..");
  const candidates = [
    path.join(root, ".credentials"),
    path.resolve(root, "..", "indigo", ".credentials"),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(`Missing .credentials. Checked:\n${candidates.join("\n")}`);
  }

  let parsed: unknown;
  try {
    parsed = toml.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${path.relative(root, source)}: ${message}`);
  }

  const result = compCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`.credentials is missing comp configuration:\n${issues}`);
  }

  return selectCompEnvironment(result.data, mode);
}
