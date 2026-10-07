import Link from "next/link";
import { GROUP_LABELS, pagesInGroup, type IntentGroup } from "@/lib/content/intent";
import { config } from "@/lib/config";

const GROUPS: IntentGroup[] = ["compare", "guides", "use-cases"];

export function Footer() {
  return (
    <footer className="site-footer">
      {/* Every search page linked from every page: the site-wide inbound link that makes the
          set discoverable from the homepage, not only from the sitemap. */}
      <div className="site-footer__directory">
        {GROUPS.map((group) => (
          <nav key={group} className="site-footer__column" aria-label={GROUP_LABELS[group]}>
            <h2 className="site-footer__heading">{GROUP_LABELS[group]}</h2>
            <ul>
              {pagesInGroup(group).map((page) => (
                <li key={page.slug}>
                  <Link href={`/${page.slug}`}>{page.eyebrow}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="site-footer__base">
        <div className="site-footer__brand">
          <strong>{config.app.name}</strong>
          <span>The off switch should not be one click away.</span>
          <small>
            © {new Date().getFullYear()} {config.app.name}
          </small>
        </div>
        <nav className="site-footer__nav">
          <Link href="/download">Download</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/about">About Us</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
