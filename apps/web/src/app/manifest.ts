import type { MetadataRoute } from "next";
import { config } from "@/lib/config";

/**
 * PWA manifest. The icons are the brand kit's web exports, copied into public/icons — see
 * assets/brand/README.md. `favicon.ico`, `icon.svg` and `apple-icon.png` live beside this file
 * and are wired up by Next's file conventions instead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: config.app.name,
    short_name: config.app.name,
    description: `${config.app.name} account, billing, and subscription management.`,
    start_url: "/",
    display: "standalone",
    background_color: "#08090a",
    theme_color: "#08090a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
