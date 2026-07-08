import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSubscribed } from "@/lib/auth/require-subscribed";
import { getConnectionForUser, setConnectionMeta } from "@/server/connections/store";
import { googleClientForConnection } from "@/lib/google/oauth";
import { topPages, topQueries } from "@/lib/google/search-console";

const bodySchema = z.object({
  siteUrl: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: NextRequest) {
  const { user } = await requireSubscribed();

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const conn = await getConnectionForUser(user.id, "gsc");
  if (!conn) {
    return NextResponse.json({ error: "not_connected" }, { status: 412 });
  }

  let client;
  try {
    client = await googleClientForConnection(conn.row.id);
  } catch {
    await setConnectionMeta(conn.row.id, { ...(conn.row.meta ?? {}), status: "revoked" });
    return NextResponse.json({ error: "reauth_required" }, { status: 412 });
  }

  const range = { startDate: parsed.data.startDate, endDate: parsed.data.endDate };
  try {
    const [queries, pages] = await Promise.all([
      topQueries(client, parsed.data.siteUrl, range, 50),
      topPages(client, parsed.data.siteUrl, range, 50),
    ]);
    return NextResponse.json({ queries, pages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GSC query failed";
    // 401-style failures here usually mean revoked/insufficient scope.
    if (/invalid_grant|unauthorized|401/i.test(message)) {
      await setConnectionMeta(conn.row.id, { ...(conn.row.meta ?? {}), status: "revoked" });
      return NextResponse.json({ error: "reauth_required" }, { status: 412 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
