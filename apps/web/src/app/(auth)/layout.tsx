import Link from "next/link";
import { DevBadge } from "@/components/DevBadge";
import { config } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <div className="brand-row">
          <Link href="/" className="auth-brand">
            {config.app.name}
          </Link>
          <DevBadge />
        </div>
      </header>
      <main className="auth-main">{children}</main>
    </div>
  );
}
