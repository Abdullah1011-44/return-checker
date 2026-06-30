const DEFAULT_TIMEOUT_MS = 30_000;

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * JSON fetch helper for merchant dashboard pages.
 * Uses same-origin credentials, no-store cache, and a request timeout.
 *
 * @param {string} url
 * @param {{
 *   method?: string;
 *   body?: unknown;
 *   signal?: AbortSignal;
 *   timeoutMs?: number;
 * }} [options]
 */
export async function fetchMerchantJson(url, options = {}) {
  const {
    method = "GET",
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const abortFromParent = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener("abort", abortFromParent);
    }
  }

  try {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeoutController.signal,
    });

    const data = await parseJsonSafely(res);
    return { res, data, aborted: false };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { res: null, data: {}, aborted: true };
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", abortFromParent);
    }
  }
}

/**
 * @param {unknown} data
 * @param {string} arrayKey
 */
export function readArrayField(data, arrayKey) {
  if (!data || typeof data !== "object") {
    return [];
  }

  const value = data[arrayKey];
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} data
 * @param {string} objectKey
 */
export function readObjectField(data, objectKey) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const value = data[objectKey];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/**
 * @param {Response | null} res
 * @param {unknown} data
 * @param {string} fallbackMessage
 */
export function getApiErrorMessage(res, data, fallbackMessage) {
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }

    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }

    if (Array.isArray(data.details)) {
      const detailMessage = data.details
        .map((item) =>
          item && typeof item.message === "string" ? item.message : "",
        )
        .filter(Boolean)
        .join(" ");

      if (detailMessage) {
        return detailMessage;
      }
    }
  }

  if (res?.status === 401) {
    return "Please sign in to continue.";
  }

  return fallbackMessage;
}
