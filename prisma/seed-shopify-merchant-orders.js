/**
 * Dev-only: seed test orders for the authenticated Shopify merchant.
 * Does not modify the demo merchant or any other merchant data.
 *
 * Usage: npm run db:seed:shopify
 */
const { PrismaClient } = require("@prisma/client");
const { seedMerchantOrders } = require("./seed-helpers");

const SHOPIFY_SHOP_DOMAIN = "return-ai-saas.myshopify.com";

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding test orders for ${SHOPIFY_SHOP_DOMAIN}…`);

  const merchant = await prisma.merchant.findUnique({
    where: { shopDomain: SHOPIFY_SHOP_DOMAIN },
  });

  if (!merchant) {
    console.error(
      `Merchant not found for shopDomain "${SHOPIFY_SHOP_DOMAIN}".`
    );
    console.error(
      "Install the Shopify app first so OAuth creates the merchant record."
    );
    process.exit(1);
  }

  console.log(`Merchant: ${merchant.shopName} (${merchant.shopDomain})`);

  const { created, skipped } = await seedMerchantOrders(prisma, merchant);

  console.log(
    `\nDone. ${created} order(s) created, ${skipped} skipped (already existed).`
  );
  console.log("Test in the return portal while logged in as this merchant:");
  console.log("  Order 1001 / test1@gmail.com");
  console.log("  Order 1002 / test2@gmail.com");
  console.log("  Order 1003 / test3@gmail.com");
}

main()
  .catch((error) => {
    console.error("Shopify merchant seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
