import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Home",
  description: `${config.app.name} — the fastest way to ship your SaaS.`,
  alternates: { canonical: `${config.app.url}/` },
};

export default function LandingPage() {
  return (
    <section className="landing">
      <h1 className="landing__headline">Ship your SaaS this week.</h1>
      <p className="landing__sub">
        {config.app.name} is a reusable Next.js + Supabase + Stripe starter. Set your credentials
        and you have auth, billing, and analytics already wired.
      </p>
      <div className="landing__ctas">
        <Link href="/signup" className="landing__cta landing__cta--primary">
          Get started
        </Link>
        <Link href="/pricing" className="landing__cta landing__cta--secondary">
          See pricing
        </Link>
      </div>
    </section>
  );
}
