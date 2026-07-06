import { describe, it, expect } from "vitest";
import { blogFrontmatterSchema } from "@/lib/zod/blog-frontmatter";
import { listPosts, getPost } from "@/lib/content/blog";

describe("blog frontmatter schema", () => {
  it("rejects malformed frontmatter", () => {
    const r = blogFrontmatterSchema.safeParse({ title: "", slug: "Bad Slug" });
    expect(r.success).toBe(false);
  });

  it("accepts a complete frontmatter object", () => {
    const r = blogFrontmatterSchema.safeParse({
      title: "Post",
      slug: "post",
      description: "desc",
      publishedAt: "2025-01-01",
      author: "Alice",
    });
    expect(r.success).toBe(true);
  });
});

describe("blog content pipeline", () => {
  it("listPosts returns at least the example post", async () => {
    const posts = await listPosts();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const slugs = posts.map((p) => p.frontmatter.slug);
    expect(slugs).toContain("hello-world");
  });

  it("excerpts are plain text, not raw markdown", async () => {
    const posts = await listPosts();
    const hello = posts.find((p) => p.frontmatter.slug === "hello-world")!;
    expect(hello.excerpt.length).toBeGreaterThan(0);
    expect(hello.excerpt).not.toMatch(/[#*[\]]|```/);
  });

  it("getPost returns null for unknown slug", async () => {
    const p = await getPost("does-not-exist");
    expect(p).toBeNull();
  });

  it("getPost renders HTML for hello-world", async () => {
    const p = await getPost("hello-world");
    expect(p).not.toBeNull();
    // The page renders the frontmatter title as <h1>; body headings start at <h2>.
    expect(p!.html).toContain("<h2>");
    expect(p!.html).not.toContain("<h1>");
  });
});
