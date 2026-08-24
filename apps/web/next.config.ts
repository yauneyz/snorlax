import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Trace from the monorepo root so serverless bundles include workspace packages.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: [
    "@talysman/auth-contracts",
    "@talysman/billing-server",
    "@talysman/product",
    "@talysman/shared",
  ],
  images: {
    remotePatterns: [],
  },
  webpack(config, { dev }) {
    // Workspace packages use Node-compatible `.js` specifiers in their
    // TypeScript sources. Resolve those specifiers to source files while Next
    // transpiles the packages, then fall back to JavaScript dependencies.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      // Sentry's Node tracing integrations use dynamic require hooks. Webpack
      // cannot statically trace them, but they are expected in this package.
      {
        module: /node_modules[\\/]@opentelemetry[\\/]instrumentation/,
        message: /Critical dependency/,
      },
      {
        module: /node_modules[\\/]require-in-the-middle[\\/]/,
        message: /Critical dependency/,
      },
    ];
    if (dev) {
      config.infrastructureLogging = {
        ...config.infrastructureLogging,
        level: "error",
      };
    }
    return config;
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

const configWithBotId = withBotId(nextConfig);

export default sentryEnabled
  ? withSentryConfig(configWithBotId, sentryWebpackOptions)
  : configWithBotId;
