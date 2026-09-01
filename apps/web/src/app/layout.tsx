import type { Metadata, Viewport } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { BotIdClient } from "botid/client";
import { palette, paletteCssVariables } from "@talysman/shared";
import { Providers } from "./providers";
import { config } from "@/lib/config";
import "./globals.css";

const botIdProtectedRoutes = [{ path: "/api/analytics/track", method: "POST" }];

/**
 * Space Grotesk for everything, JetBrains Mono for the small caps-and-numbers labels
 * (step counters, "DETECTED", metadata). Self-hosted by next/font, so no request to
 * fonts.googleapis.com in the critical path.
 */
const sans = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(config.app.url),
  title: {
    default: config.app.name,
    template: `%s - ${config.app.name}`,
  },
  description: `${config.app.name} account, billing, and subscription management.`,
  openGraph: {
    siteName: config.app.name,
    type: "website",
    url: config.app.url,
    images: [{ url: "/og-default.png" }],
  },
  twitter: {
    card: "summary_large_image",
  },
  // favicon.ico / icon.svg / apple-icon.png are picked up from app/ by file convention; the PWA
  // icons come from app/manifest.ts.
  manifest: "/manifest.webmanifest",
  verification: config.google.siteVerification
    ? { google: config.google.siteVerification }
    : undefined,
};

export const viewport: Viewport = {
  themeColor: palette.colors.background,
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      style={paletteCssVariables() as React.CSSProperties}
      suppressHydrationWarning
    >
      <head>
        <BotIdClient protect={botIdProtectedRoutes} />
      </head>
      <body>
        <Providers>{children}</Providers>
        {config.google.ga4MeasurementId ? (
          <GoogleAnalytics gaId={config.google.ga4MeasurementId} />
        ) : null}
      </body>
    </html>
  );
}
