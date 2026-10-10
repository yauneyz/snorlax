/**
 * Push a message into the desktop app — the admin side of app_messages (migration 0018).
 *
 * Target a device id (from the /insights errors panel; works for people who never signed in),
 * an account's email (every device signed into it), or everyone. The app shows it as a banner
 * plus an OS notification, and inside the startup-failure dialog when it can't start at all.
 *
 * Usage (from the repository root):
 *   pnpm message send --device <id> --title "…" --body "…" [--link https://… --link-label "…"]
 *   pnpm message send --email <email> --title "…" --body "…" [--expires 2026-11-01]
 *   pnpm message send --all --title "…" --body "…" --expires 2026-11-01
 *   pnpm message list [--device <id>]     recent messages and whether they were seen/dismissed
 *   pnpm message revoke <message-id>      stop serving a message
 *
 * Same environment handling as `pnpm comp`: production by default, --dev for local Supabase.
 */
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SUPPORT_EMAIL } from "@talysman/shared";
import { loadCompEnvironment, resolveCompMode, type CompEnvironment } from "./comp-environment";

type Args = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const booleanFlags = new Set(["dev", "prod", "all"]);

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

type Db = ReturnType<typeof admin>;

function stringFlag(args: Args, name: string): string | undefined {
  const value = args.flags[name];
  if (value === true) die(`--${name} needs a value.`);
  return typeof value === "string" ? value : undefined;
}

function parseExpiry(value: string | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) die(`Could not read --expires "${value}" as a date.`);
  return date.toISOString();
}

async function send(db: Db, args: Args): Promise<void> {
  const device = stringFlag(args, "device");
  const email = stringFlag(args, "email");
  const all = args.flags.all === true;
  if ([device, email, all || undefined].filter(Boolean).length !== 1) {
    die("Choose exactly one of --device <id>, --email <email>, or --all.");
  }
  if (device && !z.string().uuid().safeParse(device).success) die(`"${device}" is not a device id.`);

  const title = stringFlag(args, "title") ?? die("--title is required.");
  const body = stringFlag(args, "body") ?? die("--body is required.");
  const linkUrl = stringFlag(args, "link") ?? null;
  const linkLabel = stringFlag(args, "link-label") ?? null;
  if (linkUrl && !/^(https:\/\/|mailto:)/.test(linkUrl)) die("--link must start with https:// or mailto:.");
  const expiresAt = parseExpiry(stringFlag(args, "expires"));
  if (all && !expiresAt) die("--all needs --expires, or every future install sees it forever.");

  let userId: string | null = null;
  if (email) {
    const { data, error } = await db.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (error) die(error.message);
    if (!data) die(`No account with email ${email}.`);
    userId = data.id as string;
  }

  const { data, error } = await db
    .from("app_messages")
    .insert({
      device_id: device ?? null,
      user_id: userId,
      broadcast: all,
      title,
      body,
      link_url: linkUrl,
      link_label: linkLabel,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) die(error.message);
  console.log(`✓ Sent ${data.id} to ${device ? `device ${device}` : email ? email : "everyone"}.`);
  console.log("  Delivered on the app's next launch, or within 15 minutes if it's running.");
}

async function list(db: Db, args: Args): Promise<void> {
  const device = stringFlag(args, "device");
  let query = db
    .from("app_messages")
    .select("id, device_id, user_id, broadcast, title, created_at, expires_at, app_message_receipts(device_id, seen_at, dismissed_at)")
    .order("created_at", { ascending: false })
    .limit(25);
  if (device) query = query.eq("device_id", device);
  const { data, error } = await query;
  if (error) die(error.message);
  if (!data?.length) {
    console.log("No messages.");
    return;
  }
  for (const m of data) {
    const target = m.broadcast ? "everyone" : m.device_id ? `device ${m.device_id}` : `user ${m.user_id}`;
    const expired = m.expires_at && new Date(m.expires_at) <= new Date() ? " (expired)" : "";
    console.log(`${m.id}  ${m.created_at.slice(0, 16)}  → ${target}${expired}\n  ${m.title}`);
    for (const r of m.app_message_receipts ?? []) {
      console.log(`    ${r.device_id}: seen ${r.seen_at.slice(0, 16)}${r.dismissed_at ? `, dismissed ${r.dismissed_at.slice(0, 16)}` : ""}`);
    }
    if (!m.app_message_receipts?.length) console.log("    not seen yet");
  }
}

async function revoke(db: Db, args: Args): Promise<void> {
  const id = args.positional[0] ?? die("Usage: pnpm message revoke <message-id>");
  const { data, error } = await db
    .from("app_messages")
    .update({ expires_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) die(error.message);
  if (!data?.length) die(`No message ${id}.`);
  console.log(`✓ Revoked ${id}. Banners already showing clear on the app's next poll.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    console.log(
      [
        'pnpm message send (--device <id> | --email <email> | --all) --title "…" --body "…"',
        "                  [--link https://… --link-label …] [--expires YYYY-MM-DD] [--dev]",
        "pnpm message list [--device <id>] [--dev]     recent messages with seen/dismissed receipts",
        "pnpm message revoke <message-id> [--dev]      stop serving a message",
        "",
        `Tip: point people at ${SUPPORT_EMAIL} or a mailto: link so they can write back.`,
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
    case "send":
      return send(db, args);
    case "list":
      return list(db, args);
    case "revoke":
      return revoke(db, args);
    default:
      die(`Unknown command "${args.command}". Try: pnpm message help`);
  }
}

void main();
