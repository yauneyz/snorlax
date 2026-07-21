import Link from "next/link";
import { TalysmanMark } from "@/components/brand/TalysmanMark";
import { config } from "@/lib/config";

/**
 * Mark + wordmark, linked home. Shared by the marketing, auth, and app shells so the three
 * headers stay identical — they used to each render the wordmark on their own.
 */
export function BrandLink({ href }: { href: string }) {
  return (
    <Link href={href} className="brand-lockup">
      <TalysmanMark size={26} />
      <span className="brand-lockup__name">{config.app.name}</span>
    </Link>
  );
}
