import Link from "next/link";
import { SignOutButton } from "@/components/app/SignOutButton";
import { BrandLink } from "@/components/brand/BrandLink";
import { DevBadge } from "@/components/DevBadge";
import { requireUser } from "@/lib/auth/require-user";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-row">
          <BrandLink href="/app" />
          <DevBadge />
        </div>
        <nav className="app-nav">
          <Link href="/app">Dashboard</Link>
          <Link href="/account">Account</Link>
          <SignOutButton />
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
