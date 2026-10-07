import { notFound } from "next/navigation";
import { GROUP_LABELS, getIntentPage, intentPages } from "@/lib/content/intent";
import { intentCard, OG_SIZE } from "@/lib/og/intentCard";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Talysman: ending a focus session early needs a USB key that's in another room.";

export function generateStaticParams() {
  return intentPages.map((page) => ({ slug: page.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getIntentPage(slug);
  if (!page) notFound();
  return intentCard({ label: `${GROUP_LABELS[page.group]} · ${page.eyebrow}`, title: page.title });
}
