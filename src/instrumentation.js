import * as Sentry from "@sentry/nextjs";
import { getSentryDsn } from "../sentry.shared.js";

export async function register() {
  if (!getSentryDsn()) {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config.ts");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config.ts");
  }
}

export const onRequestError = getSentryDsn()
  ? Sentry.captureRequestError
  : async () => {};
