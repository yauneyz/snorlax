import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listPosts, getPost } from "@/lib/content/blog";
import { MarkdownRenderer } from "@/components/content/MarkdownRenderer";
import { config } from "@/lib/config";

export async function generateStaticParams() {
  const posts = await listPosts();
  return posts.map((p) => ({ slug: p.frontmatter.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Not found" };
  const { frontmatter } = post;
  const url = `${config.app.url}/blog/${frontmatter.slug}`;
  return {
    title: frontmatter.title,
    description: frontmatter.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: frontmatter.title,
      description: frontmatter.description,
      url,
      publishedTime: frontmatter.publishedAt.toISOString(),
      modifiedTime: frontmatter.updatedAt?.toISOString(),
      authors: [frontmatter.author],
      images: frontmatter.coverImage
        ? [`/api/blog/resources/${frontmatter.coverImage.replace(/^resources\//, "")}`]
        : ["/og-default.png"],
    },
  };
}

export default async function BlogPost({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const { frontmatter, html } = post;
  return (
    <article className="blog-post">
      <header>
        <h1>{frontmatter.title}</h1>
        <p className="blog-post__meta">
          <time dateTime={frontmatter.publishedAt.toISOString()}>
            {frontmatter.publishedAt.toLocaleDateString()}
          </time>{" "}
          · {frontmatter.author}
        </p>
      </header>
      <MarkdownRenderer html={html} />
    </article>
  );
}
