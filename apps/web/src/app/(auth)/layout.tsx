import { BrandLink } from "@/components/brand/BrandLink";
import { DevBadge } from "@/components/DevBadge";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <div className="brand-row">
          <BrandLink href="/" />
          <DevBadge />
        </div>
      </header>
      <main className="auth-main">{children}</main>
    </div>
  );
}
