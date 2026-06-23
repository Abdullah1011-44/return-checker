import { NextResponse } from "next/server";
import { AUDIT_EVENTS } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import { logWebhookInvalidHmac } from "@/lib/shopifyComplianceWebhook";
import { getShopifyWebhookHeaders } from "@/lib/shopifyWebhook";
import {
  createWebhookAuditLog,
  getWebhookMerchant,
  parseWebhookJson,
  readRawBody,
  verifyIncomingShopifyWebhook,
} from "@/lib/shopifyWebhookHandlers";

const ROUTE_NAME = "webhooks/products-update";

function toOptionalString(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

/**
 * Extract only safe product fields from Shopify REST webhook payload.
 * Ignores variants, images, body_html, and other large nested payloads.
 */
function extractSafeProductFields(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const shopifyProductLegacyId =
    payload.id != null ? String(payload.id) : null;
  const shopifyProductGid = toOptionalString(payload.admin_graphql_api_id);
  const title = toOptionalString(payload.title);

  if (!shopifyProductLegacyId && !shopifyProductGid) {
    return null;
  }

  if (!title) {
    return null;
  }

  return {
    shopifyProductId: shopifyProductLegacyId ?? shopifyProductGid,
    shopifyProductGid,
    shopifyProductLegacyId,
    title,
    handle: toOptionalString(payload.handle),
    vendor: toOptionalString(payload.vendor),
    productType: toOptionalString(payload.product_type),
    status: toOptionalString(payload.status),
    updatedAt: payload.updated_at ? new Date(payload.updated_at) : new Date(),
  };
}

function getProductUpdateFields(existingProduct, productFields) {
  const patch = {};

  if (existingProduct.title !== productFields.title) {
    patch.title = productFields.title;
  }

  if (existingProduct.handle !== productFields.handle) {
    patch.handle = productFields.handle;
  }

  if (existingProduct.vendor !== productFields.vendor) {
    patch.vendor = productFields.vendor;
  }

  if (existingProduct.productType !== productFields.productType) {
    patch.productType = productFields.productType;
  }

  if (existingProduct.status !== productFields.status) {
    patch.status = productFields.status;
  }

  if (
    productFields.updatedAt instanceof Date &&
    !Number.isNaN(productFields.updatedAt.getTime()) &&
    existingProduct.updatedAt?.getTime?.() !== productFields.updatedAt.getTime()
  ) {
    patch.updatedAt = productFields.updatedAt;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

async function findMerchantProduct(merchantId, productFields) {
  if (productFields.shopifyProductGid) {
    const productByGid = await prisma.shopifyProduct.findUnique({
      where: {
        merchantId_shopifyProductGid: {
          merchantId,
          shopifyProductGid: productFields.shopifyProductGid,
        },
      },
    });

    if (productByGid) {
      return productByGid;
    }
  }

  if (productFields.shopifyProductLegacyId) {
    return prisma.shopifyProduct.findFirst({
      where: {
        merchantId,
        shopifyProductLegacyId: productFields.shopifyProductLegacyId,
      },
    });
  }

  return null;
}

/**
 * Shopify products/update webhook.
 * Updates existing ShopifyProduct rows only; never creates incomplete records.
 */
export async function POST(request) {
  const webhookMeta = { route: ROUTE_NAME };

  try {
    const rawBody = await readRawBody(request);
    const verification = verifyIncomingShopifyWebhook(request, rawBody);

    if (!verification.valid) {
      await logWebhookInvalidHmac(
        ROUTE_NAME,
        getShopifyWebhookHeaders(request),
        request
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shopDomain = verification.shopDomain;
    webhookMeta.shopDomain = shopDomain;

    const merchant = await getWebhookMerchant(shopDomain);
    if (!merchant) {
      console.log("[Shopify Webhook]", {
        route: ROUTE_NAME,
        shopDomain,
        ignored: true,
        reason: "Unknown or inactive merchant",
      });
      return NextResponse.json({ success: true, ignored: true });
    }

    webhookMeta.merchantId = merchant.id;

    const parsed = parseWebhookJson(rawBody);
    if (!parsed.success || !parsed.data) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const productFields = extractSafeProductFields(parsed.data);
    if (!productFields) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const existingProduct = await findMerchantProduct(merchant.id, productFields);

    if (!existingProduct) {
      console.log("[Shopify Webhook]", {
        route: ROUTE_NAME,
        shopDomain,
        shopifyProductId: productFields.shopifyProductId,
        ignored: true,
        reason: "Product not found",
      });
      return NextResponse.json({ success: true, ignored: true });
    }

    const updateFields = getProductUpdateFields(existingProduct, productFields);

    if (updateFields) {
      await prisma.shopifyProduct.update({
        where: { id: existingProduct.id },
        data: updateFields,
      });
    }

    await createWebhookAuditLog({
      merchantId: merchant.id,
      action: AUDIT_EVENTS.PRODUCT_UPDATED_WEBHOOK,
      metadata: {
        shopDomain,
        shopifyProductId: productFields.shopifyProductId,
        title: productFields.title,
        source: "shopify_webhook",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: webhookMeta.merchantId || null,
      shopDomain: webhookMeta.shopDomain || null,
      action: "webhook_products_update",
    });

    console.error("[Shopify Webhook]", {
      route: ROUTE_NAME,
      shopDomain: webhookMeta.shopDomain ?? null,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json({ success: false }, { status: 500 });
  }
}

export {
  extractSafeProductFields,
  findMerchantProduct,
  getProductUpdateFields,
};
