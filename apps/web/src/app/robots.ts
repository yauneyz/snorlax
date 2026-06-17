import type { MetadataRoute } from "next";
import { config } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/account", "/api"],
      },
    ],
    sitemap: `${config.app.url}/sitemap.xml`,
  };
}
