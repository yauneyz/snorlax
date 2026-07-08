import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ConnectionKind, ConnectionRow } from "@/lib/supabase/types";
import { decrypt, encrypt } from "@/lib/connections/cipher";

export type GoogleTokens = {
  access_token: string;
  refresh_token: string;
  // Unix ms; matches googleapis OAuth2Client `expiry_date`.
  expiry_date: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

export type ConnectionPublicRow = Omit<ConnectionRow, "ciphertext" | "iv" | "tag">;

// PostgREST returns bytea columns as `\x<hex>` strings (default `bytea_output=hex`).
// We send the same format on insert/update.
function byteaIn(buf: Buffer): string {
  return "\\x" + buf.toString("hex");
}

function byteaOut(s: string): Buffer {
  // Strip a leading `\x` (one backslash from PostgREST, parsed from JSON).
  const hex = s.startsWith("\\x") ? s.slice(2) : s;
  return Buffer.from(hex, "hex");
}

function stripSecrets(row: ConnectionRow): ConnectionPublicRow {
  return {
    id: row.id,
    user_id: row.user_id,
    kind: row.kind,
    label: row.label,
    meta: row.meta,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function upsertGoogleConnection(input: {
  userId: string;
  label: string;
  tokens: GoogleTokens;
  meta?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const sealed = encrypt(JSON.stringify(input.tokens));
  const expiresAt = new Date(input.tokens.expiry_date).toISOString();
  const db = supabaseAdmin();

  // Manual upsert: select first to keep the existing id; otherwise insert.
  // We can't use Postgres ON CONFLICT DO UPDATE through PostgREST while sending
  // bytea as `\x...` strings - easier to branch in code.
  const { data: existing, error: selErr } = await db
    .from("connections")
    .select("id")
    .eq("user_id", input.userId)
    .eq("kind", "gsc")
    .eq("label", input.label)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    const { error } = await db
      .from("connections")
      .update({
        ciphertext: byteaIn(sealed.ciphertext),
        iv: byteaIn(sealed.iv),
        tag: byteaIn(sealed.tag),
        expires_at: expiresAt,
        meta: input.meta ?? {},
      })
      .eq("id", existing.id);
    if (error) throw error;
    return { id: existing.id };
  }

  const { data, error } = await db
    .from("connections")
    .insert({
      user_id: input.userId,
      kind: "gsc",
      label: input.label,
      ciphertext: byteaIn(sealed.ciphertext),
      iv: byteaIn(sealed.iv),
      tag: byteaIn(sealed.tag),
      meta: input.meta ?? {},
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function getConnectionForUser(
  userId: string,
  kind: ConnectionKind = "gsc",
): Promise<{ row: ConnectionPublicRow; tokens: GoogleTokens } | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("connections")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", kind)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const tokens = JSON.parse(
    decrypt({
      ciphertext: byteaOut(data.ciphertext),
      iv: byteaOut(data.iv),
      tag: byteaOut(data.tag),
    }),
  ) as GoogleTokens;
  return { row: stripSecrets(data), tokens };
}

export async function getConnectionById(
  connectionId: string,
): Promise<{ row: ConnectionPublicRow; tokens: GoogleTokens }> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("connections").select("*").eq("id", connectionId).single();
  if (error) throw error;

  const tokens = JSON.parse(
    decrypt({
      ciphertext: byteaOut(data.ciphertext),
      iv: byteaOut(data.iv),
      tag: byteaOut(data.tag),
    }),
  ) as GoogleTokens;
  return { row: stripSecrets(data), tokens };
}

export async function updateConnectionTokens(
  connectionId: string,
  tokens: GoogleTokens,
): Promise<void> {
  const sealed = encrypt(JSON.stringify(tokens));
  const db = supabaseAdmin();
  const { error } = await db
    .from("connections")
    .update({
      ciphertext: byteaIn(sealed.ciphertext),
      iv: byteaIn(sealed.iv),
      tag: byteaIn(sealed.tag),
      expires_at: new Date(tokens.expiry_date).toISOString(),
    })
    .eq("id", connectionId);
  if (error) throw error;
}

export async function setConnectionMeta(
  connectionId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("connections").update({ meta }).eq("id", connectionId);
  if (error) throw error;
}
