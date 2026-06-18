import { prisma } from "@/lib/prisma";
import { shopifyAdminGraphqlRequest } from "@/lib/shopifyAdmin";

const PRODUCTS_PAGE_LIMIT = 50;
const MAX_PRODUCT_PAGES = 20;
const MAX_VARIANTS_PER_PRODUCT = 100;

const PRODUCTS_SYNC_QUERY = `
  query ProductsSync($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        legacyResourceId
        title
        handle
        vendor
        productType
        status
        tags
        onlineStoreUrl
        totalInventory
        featuredMedia {
          ... on MediaImage {
            image {
              url
            }
          }
        }
        variants(first: ${MAX_VARIANTS_PER_PRODUCT}) {
          pageInfo {
            hasNextPage
          }
          nodes {
            id
            legacyResourceId
            title
            displayName
            sku
            barcode
            price
            compareAtPrice
            inventoryQuantity
            availableForSale
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;

/**
 * @param {{ id?: string; shopDomain?: string; accessToken?: string }} merchant
 */
function validateMerchantForProductSync(merchant) {
  if (!merchant?.id || !merchant?.shopDomain || !merchant?.accessToken) {
    throw new Error(
      "Merchant id, shopDomain, and accessToken are required for product sync"
    );
  }
}

function resolveFeaturedImageUrl(featuredMedia) {
  const url = featuredMedia?.image?.url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return null;
  }

  return tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .join(",");
}

function toOptionalString(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function toLegacyId(value) {
  return value == null ? null : String(value);
}

function buildProductFields(productNode, syncedAt) {
  return {
    shopifyProductLegacyId: toLegacyId(productNode.legacyResourceId),
    title: productNode.title?.trim() || "Untitled product",
    handle: toOptionalString(productNode.handle),
    vendor: toOptionalString(productNode.vendor),
    productType: toOptionalString(productNode.productType),
    status: productNode.status != null ? String(productNode.status) : null,
    tags: formatTags(productNode.tags),
    featuredImageUrl: resolveFeaturedImageUrl(productNode.featuredMedia),
    onlineStoreUrl: toOptionalString(productNode.onlineStoreUrl),
    totalInventory:
      typeof productNode.totalInventory === "number"
        ? productNode.totalInventory
        : null,
    lastSyncedAt: syncedAt,
  };
}

function buildVariantFields(variantNode, syncedAt) {
  const selectedOptions = Array.isArray(variantNode.selectedOptions)
    ? variantNode.selectedOptions.map((option) => ({
        name: option?.name ?? null,
        value: option?.value ?? null,
      }))
    : null;

  return {
    shopifyVariantLegacyId: toLegacyId(variantNode.legacyResourceId),
    title: variantNode.title?.trim() || variantNode.displayName?.trim() || "Default",
    displayName: toOptionalString(variantNode.displayName),
    sku: toOptionalString(variantNode.sku),
    barcode: toOptionalString(variantNode.barcode),
    price: variantNode.price != null ? String(variantNode.price) : null,
    compareAtPrice:
      variantNode.compareAtPrice != null
        ? String(variantNode.compareAtPrice)
        : null,
    inventoryQuantity:
      typeof variantNode.inventoryQuantity === "number"
        ? variantNode.inventoryQuantity
        : null,
    availableForSale:
      typeof variantNode.availableForSale === "boolean"
        ? variantNode.availableForSale
        : null,
    selectedOptions,
    lastSyncedAt: syncedAt,
  };
}

async function upsertProductWithVariants({
  merchantId,
  productNode,
  syncedAt,
  warnings,
}) {
  let variantsSynced = 0;

  await prisma.$transaction(async (tx) => {
    const productFields = buildProductFields(productNode, syncedAt);

    const product = await tx.shopifyProduct.upsert({
      where: {
        merchantId_shopifyProductGid: {
          merchantId,
          shopifyProductGid: productNode.id,
        },
      },
      create: {
        merchantId,
        shopifyProductGid: productNode.id,
        ...productFields,
      },
      update: productFields,
    });

    if (productNode.variants?.pageInfo?.hasNextPage) {
      warnings.push(
        `Product ${productNode.title} has more than 100 variants; later task should add nested variant pagination.`
      );
    }

    const variantNodes = Array.isArray(productNode.variants?.nodes)
      ? productNode.variants.nodes
      : [];

    for (const variantNode of variantNodes) {
      if (!variantNode?.id) {
        continue;
      }

      const variantFields = buildVariantFields(variantNode, syncedAt);

      await tx.shopifyProductVariant.upsert({
        where: {
          merchantId_shopifyVariantGid: {
            merchantId,
            shopifyVariantGid: variantNode.id,
          },
        },
        create: {
          merchantId,
          productId: product.id,
          shopifyVariantGid: variantNode.id,
          ...variantFields,
        },
        update: {
          productId: product.id,
          ...variantFields,
        },
      });

      variantsSynced += 1;
    }
  });

  return variantsSynced;
}

/**
 * Sync Shopify products and variants for a merchant via GraphQL Admin API.
 * Does not delete local rows when products disappear from Shopify (webhooks later).
 *
 * @param {{ id: string; shopDomain: string; accessToken: string }} merchant
 */
export async function syncShopifyProductsForMerchant(merchant) {
  validateMerchantForProductSync(merchant);

  const warnings = [];
  let productsSynced = 0;
  let variantsSynced = 0;
  let pagesSynced = 0;

  let after = null;
  let hasNextPage = true;

  while (hasNextPage && pagesSynced < MAX_PRODUCT_PAGES) {
    const data = await shopifyAdminGraphqlRequest({
      shopDomain: merchant.shopDomain,
      accessToken: merchant.accessToken,
      query: PRODUCTS_SYNC_QUERY,
      variables: {
        first: PRODUCTS_PAGE_LIMIT,
        after,
      },
    });

    const connection = data?.products;
    const productNodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    const syncedAt = new Date();

    for (const productNode of productNodes) {
      if (!productNode?.id) {
        continue;
      }

      const pageVariantCount = await upsertProductWithVariants({
        merchantId: merchant.id,
        productNode,
        syncedAt,
        warnings,
      });

      productsSynced += 1;
      variantsSynced += pageVariantCount;
    }

    pagesSynced += 1;
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;

    if (!hasNextPage) {
      break;
    }
  }

  return {
    success: true,
    productsSynced,
    variantsSynced,
    pagesSynced,
    warnings,
  };
}
