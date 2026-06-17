import Link from "next/link";
import { AccountMenu } from "@/components/marketing/AccountMenu";
import { config } from "@/lib/config";
import { supabaseServer } from "@/lib/supabase/server";

export async function Header() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="site-header">
      <Link href="/" className="site-brand">
        {config.app.name}
      </Link>
      <nav className="site-nav">
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
