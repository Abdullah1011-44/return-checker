import { NextResponse } from "next/server";

/**
 * In-memory rate limiting for MVP / single-instance local development.
 *
 * For production with multiple app instances, replace this store with a shared
 * backend such as Redis or Upstash so limits apply across all nodes.
 */

/** @type {Map<string, { count: number, resetAt: number }>} */
const store = new Map();

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupAt = 0;

function cleanupExpiredEntries(now = Date.now()) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return;
  }

  lastCleanupAt = now;

  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

/**
 * Check whether a key is within its rate limit.
 *
 * @param {{ key: string, limit: number, windowMs: number }} options
 */
export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const safeLimit = Math.max(1, limit);
  const safeWindowMs = Math.max(1, windowMs);

  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + safeWindowMs;
    store.set(key, { count: 1, resetAt });

    return {
      allowed: true,
      remaining: safeLimit - 1,
      resetAt,
      limit: safeLimit,
    };
  }

  if (existing.count >= safeLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      limit: safeLimit,
    };
  }

  existing.count += 1;
  store.set(key, existing);

  return {
    allowed: true,
    remaining: Math.max(safeLimit - existing.count, 0),
    resetAt: existing.resetAt,
    limit: safeLimit,
  };
}

/**
 * Resolve client IP from proxy headers.
 * Never returned to frontend clients — server-side use only.
 */
export function getClientIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

/**
 * Build a 429 response with standard rate limit headers.
 * Does not expose client IP in the JSON body.
 */
export function rateLimitResponse(result) {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000),
  );

  const headers = {
    "Retry-After": String(retryAfterSeconds),
    "X-RateLimit-Remaining": String(result.remaining ?? 0),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };

  if (result.limit != null) {
    headers["X-RateLimit-Limit"] = String(result.limit);
  }

  return NextResponse.json(
    {
      success: false,
      error: "Too many requests",
      retryAfter: retryAfterSeconds,
    },
    {
      status: 429,
      headers,
    },
  );
}

/**
 * Convenience helper for API routes.
 * Keys by route name + client IP — never merchantId from request body.
 */
export function checkRateLimit(request, { routeName, limit, windowMs }) {
  const ip = getClientIp(request);
  const key = `${routeName}:${ip}`;

  return rateLimit({ key, limit, windowMs });
}
