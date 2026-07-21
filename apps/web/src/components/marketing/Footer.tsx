import Link from "next/link";
import { config } from "@/lib/config";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">© {new Date().getFullYear()} {config.app.name}</div>
      <nav className="site-footer__nav">
        <Link href="/download">Download</Link>
        <Link href="/blog">Blog</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </footer>
  );
}
