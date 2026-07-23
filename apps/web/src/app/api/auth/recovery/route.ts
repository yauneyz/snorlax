import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { supabaseServer } from "@/lib/supabase/server";

function recoveryErrorRedirect(): NextResponse {
  return NextResponse.redirect(
    new URL("/auth/recovery?error=invalid_or_expired", config.app.url),
    { status: 303 },
  );
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return recoveryErrorRedirect();
  }
  const tokenHash = form.get("token_hash");

  if (typeof tokenHash !== "string" || tokenHash.length === 0 || tokenHash.length > 2048) {
    return recoveryErrorRedirect();
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });

  if (error) return recoveryErrorRedirect();

  return NextResponse.redirect(new URL("/reset-password", config.app.url), { status: 303 });
}
