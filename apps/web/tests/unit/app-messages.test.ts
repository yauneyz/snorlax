// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

import { messagesForDevice, parseDeviceId, recordReceipt } from "@/server/app-messages";

const DEVICE = "ba23f81f-43e7-4087-a32b-edd69ded4ea2";
const USER = "11111111-1111-4111-8111-111111111111";
const M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A thenable query builder that records every filter call and resolves to `result`. */
function builder(result: unknown) {
  const calls: [string, ...unknown[]][] = [];
  const q: Record<string, unknown> = {};
  for (const method of ["select", "or", "order", "limit", "eq", "not", "in", "upsert"]) {
    q[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { q, calls };
}

function fakeDb(tables: Record<string, ReturnType<typeof builder>>) {
  return { from: (table: string) => tables[table]!.q } as unknown as SupabaseClient<Database>;
}

const row = (id: string, title: string) => ({
  id,
  title,
  body: "body",
  link_url: null,
  link_label: null,
  created_at: "2026-10-10T00:00:00Z",
});

describe("parseDeviceId", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(parseDeviceId(` ${DEVICE} `)).toBe(DEVICE);
    expect(parseDeviceId("not-a-uuid")).toBeNull();
    expect(parseDeviceId(null)).toBeNull();
  });
});

describe("messagesForDevice", () => {
  it("targets the device and broadcasts, plus the account when signed in", async () => {
    const messages = builder({ data: [], error: null });
    const db = fakeDb({ app_messages: messages });

    await messagesForDevice(db, DEVICE, null);
    expect(messages.calls).toContainEqual(["or", `device_id.eq.${DEVICE},broadcast.is.true`]);

    messages.calls.length = 0;
    await messagesForDevice(db, DEVICE, USER);
    expect(messages.calls).toContainEqual([
      "or",
      `device_id.eq.${DEVICE},broadcast.is.true,user_id.eq.${USER}`,
    ]);
  });

  it("filters out expired messages", async () => {
    const messages = builder({ data: [], error: null });
    await messagesForDevice(fakeDb({ app_messages: messages }), DEVICE, null, new Date("2026-10-10T12:00:00Z"));
    expect(messages.calls).toContainEqual(["or", "expires_at.is.null,expires_at.gt.2026-10-10T12:00:00.000Z"]);
  });

  it("drops messages this device dismissed and maps the rest to the wire shape", async () => {
    const db = fakeDb({
      app_messages: builder({ data: [row(M1, "first"), row(M2, "second")], error: null }),
      app_message_receipts: builder({ data: [{ message_id: M1 }], error: null }),
    });
    expect(await messagesForDevice(db, DEVICE, null)).toEqual([
      { id: M2, title: "second", body: "body", linkUrl: null, linkLabel: null, createdAt: "2026-10-10T00:00:00Z" },
    ]);
  });

  it("throws on a query error so the route reports it", async () => {
    const db = fakeDb({ app_messages: builder({ data: null, error: { message: "boom" } }) });
    await expect(messagesForDevice(db, DEVICE, null)).rejects.toThrow("boom");
  });
});

describe("recordReceipt", () => {
  it("keeps the first seen_at, and only sets dismissed_at on dismiss", async () => {
    const receipts = builder({ error: null });
    const db = fakeDb({ app_message_receipts: receipts });

    await recordReceipt(db, DEVICE, { messageId: M1, status: "seen" });
    expect(receipts.calls[0]).toEqual([
      "upsert",
      { message_id: M1, device_id: DEVICE },
      { onConflict: "message_id,device_id", ignoreDuplicates: true },
    ]);

    await recordReceipt(db, DEVICE, { messageId: M1, status: "dismissed" }, new Date("2026-10-10T12:00:00Z"));
    expect(receipts.calls[1]).toEqual([
      "upsert",
      { message_id: M1, device_id: DEVICE, dismissed_at: "2026-10-10T12:00:00.000Z" },
      { onConflict: "message_id,device_id" },
    ]);
  });
});
