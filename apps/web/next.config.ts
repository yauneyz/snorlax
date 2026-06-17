import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Trace from the monorepo root so serverless bundles include workspace packages.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: [
    "@focuslock/auth-contracts",
    "@focuslock/billing-server",
    "@focuslock/product",
  ],
  images: {
    remotePatterns: [],
  },
};

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN ?? "";
const sentryOrg = process.env.SENTRY_ORG ?? "";
const sentryProject = process.env.SENTRY_PROJECT ?? "";

// Only wrap with Sentry when the auth token looks real. Placeholder values
// (from `.credentials.example`) contain ellipses; they should not trigger the
// source-map upload that needs a real token.
const sentryEnabled =
  sentryAuthToken.length > 0 &&
  !sentryAuthToken.includes("...") &&
  sentryOrg.length > 0 &&
  !sentryOrg.includes("-org-") &&
  sentryProject.length > 0;

const sentryWebpackOptions = {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
  hideSourceMaps: true,
  sourcemaps: { disable: !sentryEnabled },
};

export default sentryEnabled ? withSentryConfig(nextConfig, sentryWebpackOptions) : nextConfig;
