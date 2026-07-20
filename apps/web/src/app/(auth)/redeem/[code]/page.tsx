import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RedeemForm } from "@/components/comp/RedeemForm";
import { normalizeCompCode } from "@/lib/comp/code";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Redeem a code",
  robots: { index: false, follow: false },
};

type Params = Promise<{ code: string }>;

/**
 * The link we email out. Signed-out visitors are routed through login/signup
 * and come straight back here with the code intact; the redemption itself is
 * always an explicit click, never a side effect of loading a URL (so a prefetch
 * or link scanner can't burn someone's code).
 */
export default async function RedeemCodePage({ params }: { params: Params }) {
  const { code } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const target = `/redeem/${encodeURIComponent(code)}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(target)}`);

  // Only pass through something code-shaped; the form is a plain text input.
  const prefill = normalizeCompCode(decodeURIComponent(code)).slice(0, 32);
  return <RedeemForm initialCode={prefill ? decodeURIComponent(code).trim() : ""} />;
}
