import * as Sentry from "@sentry/nextjs";
import { sanitizeAuditMetadata } from "@/lib/audit";

/**
 * @typedef {Object} SentryCaptureContext
 * @property {string} [merchantId]
 * @property {string} [shopDomain]
 * @property {string} [route]
 * @property {string} [method]
 * @property {string} [action]
 * @property {string} [userId]
 * @property {Record<string, unknown>} [metadata]
 */

function isSentryConfigured() {
  return Boolean(process.env.SENTRY_DSN?.trim());
}

/**
 * Normalize and sanitize capture context before sending to Sentry or console.
 *
 * @param {SentryCaptureContext} context
 */
function buildSafeContext(context = {}) {
  const {
    merchantId,
    shopDomain,
    route,
    method,
    action,
    userId,
    metadata = {},
  } = context;

  return {
    merchantId: merchantId ?? undefined,
    shopDomain: shopDomain ?? undefined,
    route: route ?? undefined,
    method: method ?? undefined,
    action: action ?? undefined,
    userId: userId ?? undefined,
    metadata: sanitizeAuditMetadata(metadata),
  };
}

/**
 * Capture an exception with safe structured context.
 *
 * When `SENTRY_DSN` is configured, sends the error to Sentry via `withScope`.
 * Otherwise logs to `console.error`. Never throws.
 *
 * @param {unknown} error - Error object or value to capture
 * @param {SentryCaptureContext} [context] - Safe contextual fields
 */
export function captureException(error, context = {}) {
  const safeContext = buildSafeContext(context);

  try {
    if (!isSentryConfigured()) {
      console.error("[Error]", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        ...safeContext,
      });
      return;
    }

    Sentry.withScope((scope) => {
      if (safeContext.merchantId) {
        scope.setTag("merchantId", String(safeContext.merchantId));
      }

      if (safeContext.shopDomain) {
        scope.setTag("shopDomain", safeContext.shopDomain);
      }

      if (safeContext.route) {
        scope.setTag("route", safeContext.route);
      }

      if (safeContext.method) {
        scope.setTag("method", safeContext.method);
      }

      if (safeContext.action) {
        scope.setTag("action", safeContext.action);
      }

      if (safeContext.userId) {
        scope.setUser({ id: String(safeContext.userId) });
      }

      if (Object.keys(safeContext.metadata).length > 0) {
        scope.setContext("metadata", safeContext.metadata);
      }

      const exception =
        error instanceof Error ? error : new Error(String(error));

      Sentry.captureException(exception);
    });
  } catch {
    console.error("[Sentry] Failed to capture exception", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      ...safeContext,
    });
  }
}
