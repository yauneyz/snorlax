import Link from "next/link";
import { config } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <Link href="/" className="auth-brand">
          {config.app.name}
        </Link>
      </header>
      <main className="auth-main">{children}</main>
    </div>
  );
}
