import type { Metadata } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Providers } from "./providers";
import { config } from "@/lib/config";
import "./globals.css";

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
  verification: config.google.siteVerification
    ? { google: config.google.siteVerification }
    : undefined,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        {config.google.ga4MeasurementId ? (
          <GoogleAnalytics gaId={config.google.ga4MeasurementId} />
        ) : null}
      </body>
    </html>
  );
}
