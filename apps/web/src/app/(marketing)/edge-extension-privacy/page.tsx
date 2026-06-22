import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLegalDoc } from "@/lib/content/legal";
import { MarkdownRenderer } from "@/components/content/MarkdownRenderer";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Microsoft Edge Extension Privacy Policy",
  alternates: { canonical: `${config.app.url}/edge-extension-privacy` },
};

export default async function EdgeExtensionPrivacyPage() {
  const doc = await getLegalDoc("edge-extension-privacy");
  if (!doc) notFound();
  return (
    <section className="legal">
      <h1>{doc.title}</h1>
      <MarkdownRenderer html={doc.html} />
    </section>
  );
}
