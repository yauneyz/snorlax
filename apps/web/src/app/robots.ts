import type { MetadataRoute } from "next";
import { config } from "@/lib/config";

// Everything public is fair game, including for AI/answer-engine crawlers — being
// cited by ChatGPT/Claude/Perplexity is as valuable to us as a search ranking.
// Only signed-in app surfaces and the API are off limits, and those pages also
// carry noindex metadata. `/redeem` is deliberately not listed here: it's unlisted,
// already noindex, and naming it in robots.txt would just advertise it.
// Anchored with `$` / trailing slash because robots rules are prefix matches — a bare
// "/app" would also block /app-blocker-pc and /apple-icon.png.
const disallow = ["/app$", "/app/", "/account$", "/account/", "/api/", "/insights$", "/insights/"];

// Blog images (inline + og:image covers) are served from under /api.
const allow = ["/", "/api/blog/"];

// A crawler matching a named group ignores the `*` group entirely, so these get the
// same rules. Listing them is an explicit welcome rather than a behavior change.
const aiCrawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "CCBot",
  "meta-externalagent",
  "Bytespider",
  "DuckAssistBot",
  "MistralAI-User",
  "cohere-ai",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow, disallow },
      { userAgent: aiCrawlers, allow, disallow },
    ],
    sitemap: `${config.app.url}/sitemap.xml`,
  };
}
