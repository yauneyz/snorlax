import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { track } from "@/server/analytics/track";

/**
 * PMF survey submission (the account page's Sean-Ellis prompt). Session-cookie auth, not
 * bearer — this is a browser-only form, and unlike `/api/analytics/track` the response must
 * be tied to a real signed-in person, never an anonymous visitor, so `userId` is resolved
 * here rather than accepted from the body.
 */
const surveyBodySchema = z.object({
  disappointment: z.enum(["very", "somewhat", "not"]),
  primary_benefit: z.string().max(500).optional(),
  main_alternative: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = surveyBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  await track({
    event: "pmf_survey_responded",
    source: "web",
    userId: user.id,
    props: parsed.data,
  });

  return new NextResponse(null, { status: 202 });
}
