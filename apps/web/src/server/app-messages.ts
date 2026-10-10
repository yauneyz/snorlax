import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AppMessage, AppMessageReceipt } from "@talysman/product";
import type { Database } from "@/lib/supabase/database.types";

/** More than this pending at once is a sending mistake, not something to render. */
const MAX_MESSAGES = 10;

const uuid = z.string().uuid();

/** The device-id header, if it's a well-formed id. Anything else gets no messages. */
export function parseDeviceId(value: string | null): string | null {
  const parsed = uuid.safeParse(value?.trim());
  return parsed.success ? parsed.data : null;
}

/**
 * Unexpired messages addressed to this device, its signed-in account, or everyone, minus the
 * ones this device already dismissed. Oldest first, so a follow-up reads after what it follows.
 */
export async function messagesForDevice(
  db: SupabaseClient<Database>,
  deviceId: string,
  userId: string | null,
  now: Date = new Date(),
): Promise<AppMessage[]> {
  const audience = [`device_id.eq.${deviceId}`, "broadcast.is.true"];
  if (userId) audience.push(`user_id.eq.${userId}`);

  const { data: messages, error } = await db
    .from("app_messages")
    .select("id, title, body, link_url, link_label, created_at")
    .or(audience.join(","))
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  if (error) throw new Error(error.message);
  if (!messages?.length) return [];

  const { data: dismissed, error: receiptsError } = await db
    .from("app_message_receipts")
    .select("message_id")
    .eq("device_id", deviceId)
    .not("dismissed_at", "is", null)
    .in(
      "message_id",
      messages.map((m) => m.id),
    );
  if (receiptsError) throw new Error(receiptsError.message);
  const dismissedIds = new Set((dismissed ?? []).map((r) => r.message_id));

  return messages
    .filter((m) => !dismissedIds.has(m.id))
    .map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      linkUrl: m.link_url,
      linkLabel: m.link_label,
      createdAt: m.created_at,
    }));
}

/** Record that a message reached this device (`seen`) or that its user closed it (`dismissed`). */
export async function recordReceipt(
  db: SupabaseClient<Database>,
  deviceId: string,
  receipt: AppMessageReceipt,
  now: Date = new Date(),
): Promise<void> {
  const row = { message_id: receipt.messageId, device_id: deviceId };
  // `seen` keeps the first time it was shown; `dismissed` only ever sets dismissed_at.
  const { error } =
    receipt.status === "seen"
      ? await db
          .from("app_message_receipts")
          .upsert(row, { onConflict: "message_id,device_id", ignoreDuplicates: true })
      : await db
          .from("app_message_receipts")
          .upsert({ ...row, dismissed_at: now.toISOString() }, { onConflict: "message_id,device_id" });
  if (error) throw new Error(error.message);
}
