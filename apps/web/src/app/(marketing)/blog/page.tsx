import type { Metadata } from "next";
import Link from "next/link";
import { listPosts } from "@/lib/content/blog";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Blog",
  description: `Writing from the ${config.app.name} team.`,
  alternates: { canonical: `${config.app.url}/blog` },
};

export default async function BlogIndex() {
  const posts = await listPosts();
  return (
    <section className="blog-index">
      <h1>Blog</h1>
      {posts.length === 0 ? (
        <p>No posts yet.</p>
      ) : (
        <ul className="blog-index__list">
          {posts.map(({ frontmatter, excerpt }) => (
            <li key={frontmatter.slug} className="blog-index__item">
              <Link href={`/blog/${frontmatter.slug}`}>
                <h2>{frontmatter.title}</h2>
              </Link>
              <p className="blog-index__meta">
                <time dateTime={frontmatter.publishedAt.toISOString()}>
                  {frontmatter.publishedAt.toLocaleDateString()}
                </time>{" "}
                · {frontmatter.author}
              </p>
              <p className="blog-index__excerpt">{excerpt}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
