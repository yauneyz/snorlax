import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import { visit } from "unist-util-visit";
import { blogFrontmatterSchema, type BlogFrontmatter } from "@/lib/zod/blog-frontmatter";
import { config } from "@/lib/config";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");
const EXCERPT_CHARS = 200;

export type PostSummary = { frontmatter: BlogFrontmatter; excerpt: string };
export type PostDetail = { frontmatter: BlogFrontmatter; html: string };

function rewriteResourceUrls() {
  return (tree: unknown) => {
    visit(tree as never, "image", (node: { url?: string }) => {
      if (!node.url) return;
      // `resources/foo.png` → `/api/blog/resources/foo.png`
      if (/^resources\//.test(node.url)) {
        node.url = `/api/blog/resources/${node.url.replace(/^resources\//, "")}`;
      }
    });
  };
}

async function listPostFiles(): Promise<string[]> {
  try {
    const files = await fs.readdir(BLOG_DIR);
    return files.filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

async function readPostFile(filename: string) {
  const abs = path.join(BLOG_DIR, filename);
  const raw = await fs.readFile(abs, "utf8");
  const { data, content } = matter(raw);
  const parsed = blogFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid frontmatter in content/blog/${filename}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return { frontmatter: parsed.data, content };
}

export async function listPosts(): Promise<PostSummary[]> {
  const files = await listPostFiles();
  const entries = await Promise.all(
    files.map(async (f) => {
      const { frontmatter, content } = await readPostFile(f);
      if (frontmatter.draft && config.app.environment === "production") return null;
      const excerpt =
        content.replace(/\s+/g, " ").slice(0, EXCERPT_CHARS).trim() +
        (content.length > EXCERPT_CHARS ? "…" : "");
      return { frontmatter, excerpt };
    }),
  );
  return entries
    .filter((e): e is PostSummary => e !== null)
    .sort((a, b) => b.frontmatter.publishedAt.getTime() - a.frontmatter.publishedAt.getTime());
}

export async function getPost(slug: string): Promise<PostDetail | null> {
  const files = await listPostFiles();
  for (const f of files) {
    const { frontmatter, content } = await readPostFile(f);
    if (frontmatter.slug !== slug) continue;
    if (frontmatter.draft && config.app.environment === "production") return null;
    const processed = await remark()
      .use(remarkGfm)
      .use(rewriteResourceUrls)
      .use(remarkHtml, { sanitize: false })
      .process(content);
    return { frontmatter, html: String(processed) };
  }
  return null;
}
