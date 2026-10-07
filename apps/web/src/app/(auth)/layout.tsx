import type { Metadata } from "next";
import { BrandLink } from "@/components/brand/BrandLink";
import { DevBadge } from "@/components/DevBadge";

// Sign-in, sign-up and password pages: crawlable, so the noindex is seen, but never indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

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
