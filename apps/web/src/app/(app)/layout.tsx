import Link from "next/link";
import { SignOutButton } from "@/components/app/SignOutButton";
import { config } from "@/lib/config";
import { requireUser } from "@/lib/auth/require-user";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/app" className="app-brand">
          {config.app.name}
        </Link>
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
