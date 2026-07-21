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
        <Link href="/download">Download</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/blog">Blog</Link>
        {user ? (
          <AccountMenu />
        ) : (
          <Link href="/login" className="site-nav__login">
            Log in
          </Link>
        )}
        <Link href="/signup" className="site-nav__cta">
          Get started
        </Link>
      </nav>
    </header>
  );
}
