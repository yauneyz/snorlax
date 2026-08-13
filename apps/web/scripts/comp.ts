/**
 * Complimentary ("comped") Pro accounts — the admin side.
 *
 * There is deliberately no admin UI and no privileged HTTP endpoint: grants are
 * written out-of-band with the Supabase secret key, so there is no backdoor in
 * the shipped app to secure. See migration 0004 and payments-arch.md §9.
 *
 * Usage (from the repository root):
 *   pnpm comp grant  <email> [--note "mom"] [--expires 2027-01-01]
 *   pnpm comp code   [count] [--note "mom"] [--uses N] [--expires 2027-01-01]
 *   pnpm comp revoke <email>
 *   pnpm comp list
 *
 * `code` mints `count` codes (default 100), writes their plaintext one per
 * line to ./comp_codes_<timestamp>.txt, and never prints them to the
 * terminal — that file is the only copy, since only the hash is stored.
 *
 * Commands target production by default. Add --dev to use local Supabase.
 */
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { generateCompCode, hashCompCode } from "../src/lib/comp/code";
import {
  loadCompEnvironment,
  resolveCompMode,
  type CompEnvironment,
} from "./comp-environment";

type Args = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const booleanFlags = new Set(["dev", "prod"]);

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split("=");
    if (inline !== undefined) {
      flags[name] = inline;
    } else if (booleanFlags.has(name)) {
      flags[name] = true;
    } else if (rest[i + 1] && !rest[i + 1].startsWith("--")) {
      flags[name] = rest[i + 1];
      i += 1;
    } else {
      flags[name] = true;
    }
  }

  return { command, positional, flags };
}

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function admin(environment: CompEnvironment) {
  console.log(`→ ${environment.label}: ${environment.supabaseUrl}`);
  return createClient(environment.supabaseUrl, environment.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseExpiry(value: string | boolean | undefined): string | null {
  if (value === undefined || typeof value === "boolean") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) die(`Could not read --expires "${value}" as a date.`);
  return date.toISOString();
}

type Db = ReturnType<typeof admin>;

/** Resolve an email to an auth user id. Paginates because listUsers has no email filter. */
async function findUserByEmail(db: Db, email: string): Promise<string | null> {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`Could not list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function grant(db: Db, args: Args): Promise<void> {
  const email = args.positional[0] ?? die("Usage: pnpm comp grant <email>");
  const userId = await findUserByEmail(db, email);
  if (!userId) {
    die(
      `No account for ${email}. They need to sign up first — or send them a code instead: pnpm comp code`,
    );
  }

  const note = typeof args.flags.note === "string" ? args.flags.note : null;
  const { error } = await db.from("entitlement_grants").upsert(
    {
      user_id: userId,
      plan: "pro",
      note,
      source: "manual",
      granted_at: new Date().toISOString(),
      expires_at: parseExpiry(args.flags.expires),
      revoked_at: null,
    },
    { onConflict: "user_id" },
  );
  if (error) die(`Could not write the grant: ${error.message}`);

  const until = parseExpiry(args.flags.expires);
  console.log(`✓ ${email} is on Pro${until ? ` until ${until}` : " for life"}.`);
}

async function code(db: Db, args: Args): Promise<void> {
  const count = args.positional[0] !== undefined ? Number(args.positional[0]) : 100;
  if (!Number.isInteger(count) || count < 1) die("count must be a positive integer.");

  const note = typeof args.flags.note === "string" ? args.flags.note : null;
  const uses = typeof args.flags.uses === "string" ? Number(args.flags.uses) : 1;
  if (!Number.isInteger(uses) || uses < 1) die("--uses must be a positive integer.");
  const expiresAt = parseExpiry(args.flags.expires);

  const plaintexts = new Set<string>();
  while (plaintexts.size < count) plaintexts.add(generateCompCode());

  const rows = [...plaintexts].map((plaintext) => ({
    code_hash: hashCompCode(plaintext),
    note,
    max_redemptions: uses,
    expires_at: expiresAt,
  }));

  const { error } = await db.from("comp_codes").insert(rows);
  if (error) die(`Could not mint the codes: ${error.message}`);

  const filename = `comp_codes_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  await writeFile(filename, [...plaintexts].join("\n") + "\n");

  console.log(
    `✓ Minted ${count} code${count === 1 ? "" : "s"}${
      uses === 1 ? "" : ` (${uses} uses each)`
    }${note ? ` · ${note}` : ""} → ${filename}`,
  );
  console.log("  Only hashes are stored — this file is the only copy of the plaintext codes.");
}

async function revoke(db: Db, args: Args): Promise<void> {
  const email = args.positional[0] ?? die("Usage: pnpm comp revoke <email>");
  const userId = await findUserByEmail(db, email);
  if (!userId) die(`No account for ${email}.`);

  const { data, error } = await db
    .from("entitlement_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("code_id");
  if (error) die(`Could not revoke: ${error.message}`);
  if (!data?.length) die(`${email} has no active grant.`);

  // Revoke the code too, so a saved email can't simply re-grant it.
  const codeId = data[0].code_id as string | null;
  if (codeId) {
    const { error: codeError } = await db
      .from("comp_codes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", codeId);
    if (codeError) die(`Grant revoked, but the code was not: ${codeError.message}`);
  }

  console.log(`✓ Revoked complimentary Pro for ${email}${codeId ? " (and its code)" : ""}.`);
}

async function list(db: Db): Promise<void> {
  const { data: grants, error } = await db
    .from("entitlement_grants")
    .select("user_id,note,source,granted_at,expires_at,revoked_at")
    .order("granted_at", { ascending: false });
  if (error) die(`Could not list grants: ${error.message}`);

  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emailById = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? u.id]));

  console.log(`\nGrants (${grants?.length ?? 0}):`);
  for (const g of grants ?? []) {
    const state = g.revoked_at
      ? "revoked"
      : g.expires_at
        ? `until ${g.expires_at.slice(0, 10)}`
        : "lifetime";
    console.log(
      `  ${(emailById.get(g.user_id) ?? g.user_id).padEnd(34)} ${state.padEnd(18)} ${g.source}${
        g.note ? ` · ${g.note}` : ""
      }`,
    );
  }

  const { data: codes } = await db
    .from("comp_codes")
    .select("id,note,max_redemptions,redemption_count,expires_at,revoked_at,created_at")
    .order("created_at", { ascending: false });

  console.log(`\nCodes (${codes?.length ?? 0}) — plaintext is never stored:`);
  for (const c of codes ?? []) {
    const state = c.revoked_at
      ? "revoked"
      : c.redemption_count >= c.max_redemptions
        ? "used"
        : "open";
    console.log(
      `  ${c.created_at.slice(0, 10)}  ${state.padEnd(8)} ${c.redemption_count}/${
        c.max_redemptions
      }${c.note ? ` · ${c.note}` : ""}`,
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    console.log(
      [
        "pnpm comp grant  <email> [--note …] [--expires YYYY-MM-DD] [--dev]  grant Pro to an existing account",
        "pnpm comp code   [count] [--note …] [--uses N] [--expires …] [--dev]",
        "                 mint `count` codes (default 100) to ./comp_codes_<timestamp>.txt",
        "pnpm comp revoke <email> [--dev]                                    take a grant back",
        "pnpm comp list [--dev]                                              show grants and codes",
        "",
        "Production is the default. Add --dev to use local Supabase.",
      ].join("\n"),
    );
    return;
  }

  let environment: CompEnvironment;
  try {
    environment = loadCompEnvironment(resolveCompMode(args.flags));
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  const db = admin(environment);

  switch (args.command) {
    case "grant":
      return grant(db, args);
    case "code":
      return code(db, args);
    case "revoke":
      return revoke(db, args);
    case "list":
      return list(db);
    default:
      die(`Unknown command "${args.command}". Try: pnpm comp help`);
  }
}

void main();
