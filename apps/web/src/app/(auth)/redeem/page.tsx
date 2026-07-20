import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RedeemForm } from "@/components/comp/RedeemForm";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Unlisted page for redeeming a complimentary-access code. Not linked from
 * anywhere and excluded from the sitemap and robots.txt — the only way here is
 * a link we sent someone. `/redeem/<code>` pre-fills the field.
 */
export const metadata: Metadata = {
  title: "Redeem a code",
  robots: { index: false, follow: false },
};

export default async function RedeemPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/redeem")}`);

  return <RedeemForm />;
}
