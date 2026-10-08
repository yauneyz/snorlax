import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLegalDoc } from "@/lib/content/legal";
import { MarkdownRenderer } from "@/components/content/MarkdownRenderer";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms for using ${config.app.name}: the desktop app, browser extensions, accounts and paid plans.`,
  alternates: { canonical: `${config.app.url}/terms` },
};

export default async function TermsPage() {
  const doc = await getLegalDoc("terms");
  if (!doc) notFound();
  return (
    <section className="legal">
      <h1>{doc.title}</h1>
      <MarkdownRenderer html={doc.html} />
    </section>
  );
}
