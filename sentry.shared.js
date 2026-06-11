/**
 * Shared Sentry initialization helpers.
 * Only activates when SENTRY_DSN is set — app runs normally without it.
 */

export function getSentryDsn() {
  const dsn = process.env.SENTRY_DSN?.trim();
  return dsn || undefined;
}

export function getSentryInitOptions() {
  const dsn = getSentryDsn();
  if (!dsn) {
    return null;
  }

  return {
    dsn,
    enabled: true,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  };
}

/**
 * Initialize Sentry when DSN is configured. Never throws.
 */
export function initSentryIfConfigured(Sentry) {
  const options = getSentryInitOptions();
  if (!options) {
    return false;
  }

  try {
    Sentry.init(options);
    return true;
  } catch {
    return false;
  }
}
