import type { MetadataRoute } from "next";
import { intentPages } from "@/lib/content/intent";
import { listPosts } from "@/lib/content/blog";
import { config } from "@/lib/config";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config.app.url;

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/download`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/blog`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/browser-extension-privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/edge-extension-privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];

  // The high-intent search pages. lastModified is the date their claims were last checked.
  const intentRoutes: MetadataRoute.Sitemap = intentPages.map((page) => ({
    url: `${base}/${page.slug}`,
    lastModified: page.lastReviewed,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const posts = await listPosts();
  const blogRoutes: MetadataRoute.Sitemap = posts.map(({ frontmatter }) => ({
    url: `${base}/blog/${frontmatter.slug}`,
    lastModified: frontmatter.updatedAt ?? frontmatter.publishedAt,
    changeFrequency: "yearly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...intentRoutes, ...blogRoutes];
}
