import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLegalDoc } from "@/lib/content/legal";
import { MarkdownRenderer } from "@/components/content/MarkdownRenderer";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Browser Extension Privacy Policy",
  alternates: { canonical: `${config.app.url}/browser-extension-privacy` },
};

export default async function BrowserExtensionPrivacyPage() {
  const doc = await getLegalDoc("browser-extension-privacy");
  if (!doc) notFound();
  return (
    <section className="legal">
      <h1>{doc.title}</h1>
      <MarkdownRenderer html={doc.html} />
    </section>
  );
}
