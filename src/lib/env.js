/**
 * Safe environment variable helpers.
 * Never log secret values or dump all env vars.
 */

export class MissingEnvError extends Error {
  constructor(name) {
    super(`Missing required environment variable: ${name}`);
    this.name = "MissingEnvError";
  }
}

export function isMissingEnvError(error) {
  return error instanceof MissingEnvError;
}

/**
 * Read an environment variable with optional required/fallback behavior.
 *
 * @param {string} name
 * @param {{ required?: boolean, fallback?: string }} [options]
 */
export function getEnv(name, options = {}) {
  const { required = false, fallback } = options;
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : raw;

  if (value) {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  if (required) {
    throw new MissingEnvError(name);
  }

  return undefined;
}

/** Return a required env var or throw a safe error (name only, no value). */
export function requireEnv(name) {
  const value = getEnv(name);
  if (!value) {
    throw new MissingEnvError(name);
  }
  return value;
}

/** Return env var if set, otherwise fallback. */
export function optionalEnv(name, fallback) {
  return getEnv(name, { fallback });
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function isDevelopment() {
  return process.env.NODE_ENV === "development";
}
