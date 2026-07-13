import { withSentryConfig } from "@sentry/nextjs";

const sentryDsn = process.env.SENTRY_DSN?.trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(sentryDsn ? { env: { SENTRY_DSN: sentryDsn } } : {}),
  allowedDevOrigins: ["walk-undertook-professed.ngrok-free.dev"],
  // Shopify App Proxy forwards with a trailing slash (e.g. /api/proxy/return-assistant/).
  // Next.js default 308 trailing-slash redirects resolve against the shop domain and 404.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/api/requests/:id/action",
        destination: "/api/requests/action/:id",
      },
    ];
  },
};

export default sentryDsn
  ? withSentryConfig(nextConfig, {
      silent: true,
    })
  : nextConfig;
