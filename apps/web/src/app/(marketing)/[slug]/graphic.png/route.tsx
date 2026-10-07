import { notFound } from "next/navigation";
import { GROUP_LABELS, getIntentPage, intentPages } from "@/lib/content/intent";
import { intentGraphic } from "@/lib/og/intentGraphic";

/**
 * `/<slug>/graphic.png`: the page's infographic, drawn by Satori from the page's own data and
 * prerendered at build time — no rendering on request.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return intentPages.map((page) => ({ slug: page.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getIntentPage(slug);
  if (!page) notFound();
  return intentGraphic(page, { label: `${GROUP_LABELS[page.group]} · ${page.eyebrow}` });
}
