import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "./helpers/mockPrisma.js";

const mockLogWebhookInvalidHmac = vi.fn();

vi.mock("@/lib/sentry", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/shopifyComplianceWebhook", () => ({
  logWebhookInvalidHmac: (...args) => mockLogWebhookInvalidHmac(...args),
}));

import { POST as fulfillmentsCreatePost } from "@/app/api/webhooks/fulfillments-create/route";
import { POST as ordersCreatePost } from "@/app/api/webhooks/orders-create/route";
import { POST as ordersUpdatedPost } from "@/app/api/webhooks/orders-updated/route";
import { POST as productsUpdatePost } from "@/app/api/webhooks/products-update/route";

const WEBHOOK_SECRET = "test-webhook-secret";
const SHOP_DOMAIN = "demo.myshopify.com";
const MERCHANT = {
  id: "merchant-1",
  shopDomain: SHOP_DOMAIN,
  shopName: "Demo Shop",
  isActive: true,
};

const WEBHOOK_ROUTES = [
  {
    name: "orders-create",
    path: "/api/webhooks/orders-create",
    post: ordersCreatePost,
    validBody: JSON.stringify({
      id: 5001,
      name: "#5001",
      total_price: "49.00",
      currency: "USD",
      financial_status: "paid",
      fulfillment_status: null,
      created_at: "2026-06-16T12:00:00Z",
      email: "secret@example.com",
      customer: { first_name: "Jane", email: "secret@example.com" },
    }),
  },
  {
    name: "orders-updated",
    path: "/api/webhooks/orders-updated",
    post: ordersUpdatedPost,
    validBody: JSON.stringify({
      id: 5001,
      name: "#5001",
      total_price: "59.00",
      currency: "USD",
      financial_status: "paid",
      fulfillment_status: "fulfilled",
      email: "secret@example.com",
    }),
  },
  {
    name: "fulfillments-create",
    path: "/api/webhooks/fulfillments-create",
    post: fulfillmentsCreatePost,
    validBody: JSON.stringify({
      id: 9001,
      order_id: 5001,
      status: "success",
      shipment_status: "delivered",
      tracking_number: "SECRET-TRACKING",
      destination: { address1: "123 Main St", name: "Jane Doe" },
    }),
  },
  {
    name: "products-update",
    path: "/api/webhooks/products-update",
    post: productsUpdatePost,
    validBody: JSON.stringify({
      id: 7001,
      admin_graphql_api_id: "gid://shopify/Product/7001",
      title: "Updated Tee",
      handle: "updated-tee",
      vendor: "Return Radar",
      product_type: "Apparel",
      status: "active",
      updated_at: "2026-06-16T12:00:00Z",
      variants: [{ id: 1, sku: "TEE-1" }],
      body_html: "<p>secret copy</p>",
    }),
  },
];

function signWebhookBody(body, secret = WEBHOOK_SECRET) {
  return crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
}

function createWebhookRequest(path, body, options = {}) {
  const {
    hmac = signWebhookBody(body),
    shopDomain = SHOP_DOMAIN,
    includeHmac = true,
  } = options;

  const headers = {
    "x-shopify-shop-domain": shopDomain,
  };

  if (includeHmac && hmac != null) {
    headers["x-shopify-hmac-sha256"] = hmac;
  }

  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body,
  });
}

function expectNoSensitiveLogs(spy) {
  for (const call of spy.mock.calls) {
    const serialized = JSON.stringify(call);
    expect(serialized).not.toMatch(/shpat_/i);
    expect(serialized).not.toMatch(/accessToken/i);
    expect(serialized).not.toContain("secret@example.com");
    expect(serialized).not.toContain("SECRET-TRACKING");
    expect(serialized).not.toContain("123 Main St");
  }
}

describe("Shopify webhook routes — shared security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = WEBHOOK_SECRET;
    mockPrisma.merchant.findFirst.mockResolvedValue(MERCHANT);
    mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it.each(WEBHOOK_ROUTES)(
    "$name rejects invalid HMAC with 401",
    async ({ path, post, validBody }) => {
      const response = await post(
        createWebhookRequest(path, validBody, {
          hmac: signWebhookBody("different-body"),
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    },
  );

  it.each(WEBHOOK_ROUTES)(
    "$name rejects missing HMAC with 401",
    async ({ path, post, validBody }) => {
      const response = await post(
        createWebhookRequest(path, validBody, { includeHmac: false }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    },
  );

  it.each(WEBHOOK_ROUTES)(
    "$name ignores unknown merchant with 200 ignored true",
    async ({ path, post, validBody }) => {
      mockPrisma.merchant.findFirst.mockResolvedValue(null);

      const response = await post(createWebhookRequest(path, validBody));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, ignored: true });
    },
  );

  it.each(WEBHOOK_ROUTES)(
    "$name rejects invalid JSON after valid HMAC with 400",
    async ({ path, post }) => {
      const invalidBody = "{not-json";
      const response = await post(
        createWebhookRequest(path, invalidBody, {
          hmac: signWebhookBody(invalidBody),
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false });
    },
  );

  it.each(WEBHOOK_ROUTES)(
    "$name verifies HMAC against the raw request body",
    async ({ path, post, validBody }) => {
      const response = await post(
        createWebhookRequest(path, `${validBody} `, {
          hmac: signWebhookBody(validBody),
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    },
  );
});

describe("orders-create webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = WEBHOOK_SECRET;
    mockPrisma.merchant.findFirst.mockResolvedValue(MERCHANT);
    mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.customerOrder.findUnique.mockResolvedValue(null);
    mockPrisma.customerOrder.create.mockResolvedValue({ id: "order-1" });
    mockPrisma.customerOrder.update.mockResolvedValue({ id: "order-1" });
  });

  it("creates once and upserts on duplicate webhook delivery", async () => {
    const body = WEBHOOK_ROUTES[0].validBody;
    const request = createWebhookRequest("/api/webhooks/orders-create", body);

    mockPrisma.customerOrder.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "order-1",
        merchantId: MERCHANT.id,
        shopifyOrderId: "5001",
        status: "PENDING",
        financialStatus: "pending",
        fulfillmentStatus: null,
        cancelledAt: null,
      });

    const first = await ordersCreatePost(request);
    const second = await ordersCreatePost(
      createWebhookRequest("/api/webhooks/orders-create", body),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockPrisma.customerOrder.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.customerOrder.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.customerOrder.findUnique).toHaveBeenCalledWith({
      where: {
        merchantId_shopifyOrderId: {
          merchantId: MERCHANT.id,
          shopifyOrderId: "5001",
        },
      },
    });
  });

  it("does not store customer PII from webhook payload", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await ordersCreatePost(
      createWebhookRequest(
        "/api/webhooks/orders-create",
        WEBHOOK_ROUTES[0].validBody,
      ),
    );

    const createArgs = mockPrisma.customerOrder.create.mock.calls[0][0];
    expect(createArgs.data.customerEmail).toBe(
      "shopify-order-5001@placeholder.returnradar.local",
    );
    expect(createArgs.data.customerEmail).not.toBe("secret@example.com");
    expect(createArgs.data.customerName).toBe("Shopify Customer");
    expect(createArgs.data).not.toHaveProperty("customer");
    expectNoSensitiveLogs(logSpy);
    expectNoSensitiveLogs(errorSpy);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("orders-updated webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = WEBHOOK_SECRET;
    mockPrisma.merchant.findFirst.mockResolvedValue(MERCHANT);
    mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.customerOrder.findUnique.mockResolvedValue({
      id: "order-1",
      merchantId: MERCHANT.id,
      shopifyOrderId: "5001",
      orderNumber: "5001",
      totalAmount: "49.00",
      currency: "USD",
      status: "PAID",
      financialStatus: "paid",
      fulfillmentStatus: null,
      cancelledAt: null,
    });
    mockPrisma.customerOrder.update.mockResolvedValue({ id: "order-1" });
  });

  it("updates only order fields and leaves return request data unchanged", async () => {
    const response = await ordersUpdatedPost(
      createWebhookRequest(
        "/api/webhooks/orders-updated",
        WEBHOOK_ROUTES[1].validBody,
      ),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.customerOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        status: "FULFILLED",
        fulfillmentStatus: "fulfilled",
        totalAmount: "59.00",
      },
    });
    expect(mockPrisma.returnRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.returnItem.update).not.toHaveBeenCalled();
    expect(mockPrisma.returnRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.returnItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.customerOrder.findUnique).toHaveBeenCalledWith({
      where: {
        merchantId_shopifyOrderId: {
          merchantId: MERCHANT.id,
          shopifyOrderId: "5001",
        },
      },
    });
  });
});

describe("fulfillments-create webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = WEBHOOK_SECRET;
    mockPrisma.merchant.findFirst.mockResolvedValue(MERCHANT);
    mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.customerOrder.findUnique.mockResolvedValue({
      id: "order-1",
      merchantId: MERCHANT.id,
      shopifyOrderId: "5001",
      status: "PAID",
      fulfillmentStatus: null,
    });
    mockPrisma.customerOrder.update.mockResolvedValue({ id: "order-1" });
  });

  it("sets DELIVERED only when shipment_status is delivered", async () => {
    const deliveredResponse = await fulfillmentsCreatePost(
      createWebhookRequest(
        "/api/webhooks/fulfillments-create",
        WEBHOOK_ROUTES[2].validBody,
      ),
    );

    expect(deliveredResponse.status).toBe(200);
    expect(mockPrisma.customerOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        fulfillmentStatus: "fulfilled",
        status: "DELIVERED",
      },
    });

    mockPrisma.customerOrder.update.mockClear();

    const inTransitBody = JSON.stringify({
      id: 9002,
      order_id: 5001,
      status: "success",
      shipment_status: "in_transit",
    });

    await fulfillmentsCreatePost(
      createWebhookRequest("/api/webhooks/fulfillments-create", inTransitBody),
    );

    expect(mockPrisma.customerOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        fulfillmentStatus: "fulfilled",
        status: "FULFILLED",
      },
    });
  });

  it("scopes order lookup by merchantId and shopifyOrderId", async () => {
    await fulfillmentsCreatePost(
      createWebhookRequest(
        "/api/webhooks/fulfillments-create",
        WEBHOOK_ROUTES[2].validBody,
      ),
    );

    expect(mockPrisma.customerOrder.findUnique).toHaveBeenCalledWith({
      where: {
        merchantId_shopifyOrderId: {
          merchantId: MERCHANT.id,
          shopifyOrderId: "5001",
        },
      },
    });
  });
});

describe("products-update webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = WEBHOOK_SECRET;
    mockPrisma.merchant.findFirst.mockResolvedValue(MERCHANT);
    mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.shopifyProduct.findUnique.mockResolvedValue({
      id: "product-1",
      merchantId: MERCHANT.id,
      shopifyProductGid: "gid://shopify/Product/7001",
      shopifyProductLegacyId: "7001",
      title: "Blue Tee",
      handle: "blue-tee",
      vendor: "Old Vendor",
      productType: "Shirts",
      status: "draft",
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    });
    mockPrisma.shopifyProduct.update.mockResolvedValue({ id: "product-1" });
  });

  it("updates existing products only and ignores missing products safely", async () => {
    const updateResponse = await productsUpdatePost(
      createWebhookRequest(
        "/api/webhooks/products-update",
        WEBHOOK_ROUTES[3].validBody,
      ),
    );

    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({ success: true });
    expect(mockPrisma.shopifyProduct.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.shopifyProduct.create).not.toHaveBeenCalled();
    expect(mockPrisma.shopifyProduct.findUnique).toHaveBeenCalledWith({
      where: {
        merchantId_shopifyProductGid: {
          merchantId: MERCHANT.id,
          shopifyProductGid: "gid://shopify/Product/7001",
        },
      },
    });

    mockPrisma.shopifyProduct.findUnique.mockResolvedValue(null);
    mockPrisma.shopifyProduct.findFirst.mockResolvedValue(null);

    const ignoredResponse = await productsUpdatePost(
      createWebhookRequest(
        "/api/webhooks/products-update",
        WEBHOOK_ROUTES[3].validBody,
      ),
    );

    expect(ignoredResponse.status).toBe(200);
    expect(await ignoredResponse.json()).toEqual({
      success: true,
      ignored: true,
    });
    expect(mockPrisma.shopifyProduct.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.shopifyProduct.create).not.toHaveBeenCalled();
  });

  it("does not persist variant payload from webhook body", async () => {
    await productsUpdatePost(
      createWebhookRequest(
        "/api/webhooks/products-update",
        WEBHOOK_ROUTES[3].validBody,
      ),
    );

    const updateArgs = mockPrisma.shopifyProduct.update.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("variants");
    expect(JSON.stringify(updateArgs.data)).not.toContain("TEE-1");
  });
});
