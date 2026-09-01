import Link from "next/link";
import { BrandLink } from "@/components/brand/BrandLink";
import { DevBadge } from "@/components/DevBadge";
import { AccountMenu } from "@/components/marketing/AccountMenu";
import { supabaseServer } from "@/lib/supabase/server";

export async function Header() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="site-header">
      <div className="brand-row">
        <BrandLink href="/" />
        <DevBadge />
      </div>
      <nav className="site-nav">
        <Link href="/#how">How it works</Link>
        <Link href="/pricing">Pricing</Link>
        {user ? (
          <>
            <Link href="/app">Dashboard</Link>
            <AccountMenu
              name={(user.user_metadata?.full_name as string | undefined) ?? user.email}
            />
          </>
        ) : (
          <Link href="/download" className="site-nav__cta">
            Get Talysman free
          </Link>
        )}
      </nav>
    </header>
  );
}
