import { withSentryConfig } from "@sentry/nextjs";

const sentryDsn = process.env.SENTRY_DSN?.trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(sentryDsn ? { env: { SENTRY_DSN: sentryDsn } } : {}),
  allowedDevOrigins: ["walk-undertook-professed.ngrok-free.dev"],
};

export default sentryDsn
  ? withSentryConfig(nextConfig, {
      silent: true,
    })
  : nextConfig;
