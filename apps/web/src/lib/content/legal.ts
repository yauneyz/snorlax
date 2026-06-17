import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkHtml from "remark-html";

const LEGAL_DIR = path.join(process.cwd(), "content", "legal");

export async function getLegalDoc(name: "privacy" | "terms"): Promise<{ title: string; html: string } | null> {
  const abs = path.join(LEGAL_DIR, `${name}.md`);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  const processed = await remark().use(remarkHtml, { sanitize: false }).process(content);
  return {
    title: typeof data.title === "string" ? data.title : name === "privacy" ? "Privacy Policy" : "Terms of Service",
    html: String(processed),
  };
}
