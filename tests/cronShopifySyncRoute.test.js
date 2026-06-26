import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRunShopifySyncScheduler = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("@/lib/syncScheduler", () => ({
  runShopifySyncScheduler: (...args) => mockRunShopifySyncScheduler(...args),
}));

vi.mock("@/lib/sentry", () => ({
  captureException: (...args) => mockCaptureException(...args),
}));

import { GET, POST } from "@/app/api/cron/shopify-sync/route";

const schedulerResult = {
  ok: true,
  trigger: "cron",
  startedAt: "2026-06-16T03:00:00.000Z",
  finishedAt: "2026-06-16T03:00:05.000Z",
  durationMs: 5000,
  merchantCount: 1,
  queuedCount: 1,
  skippedCount: 0,
  errorCount: 0,
  results: [
    {
      merchantId: "merchant-1",
      shopDomain: "demo.myshopify.com",
      ok: true,
      queued: true,
      reason: "scheduler:cron",
      requestedAt: "2026-06-16T03:00:00.000Z",
      error: null,
    },
  ],
};

function cronRequest(
  method = "GET",
  authorization = "Bearer test-cron-secret",
) {
  return new Request("http://localhost:3000/api/cron/shopify-sync", {
    method,
    headers: authorization ? { authorization } : {},
  });
}

describe("cron shopify-sync route", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    mockRunShopifySyncScheduler.mockResolvedValue(schedulerResult);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
  });

  it("GET returns 500 when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cronRequest("GET"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "CRON_SECRET is not configured",
    });
    expect(mockRunShopifySyncScheduler).not.toHaveBeenCalled();
  });

  it("GET returns 401 when Authorization is invalid", async () => {
    const response = await GET(cronRequest("GET", "Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Unauthorized",
    });
    expect(mockRunShopifySyncScheduler).not.toHaveBeenCalled();
  });

  it("GET runs scheduler when authorized", async () => {
    const response = await GET(cronRequest("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(schedulerResult);
    expect(mockRunShopifySyncScheduler).toHaveBeenCalledWith({
      trigger: "cron",
      merchantLimit: 10,
    });
  });

  it("POST uses the same handler as GET", async () => {
    const response = await POST(cronRequest("POST"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(schedulerResult);
    expect(mockRunShopifySyncScheduler).toHaveBeenCalledOnce();
  });

  it("returns safe 500 when scheduler throws", async () => {
    mockRunShopifySyncScheduler.mockRejectedValue(
      new Error("shpat_secret_token should not leak"),
    );

    const response = await GET(cronRequest("GET"));
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: "Shopify sync scheduler failed. Please try again later.",
    });
    expect(text).not.toContain("shpat_secret_token");
    expect(mockCaptureException).toHaveBeenCalled();
  });
});
