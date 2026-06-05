const { PrismaClient } = require("@prisma/client");
const {
  buildOrderCreateData,
  seedMerchantOrders,
  seedOrders,
} = require("./seed-helpers");

const prisma = new PrismaClient();

const MERCHANT_EMAIL = "demo@returnchecker.shop";
const MERCHANT_SHOP_NAME = "Return Checker Demo";
const SHOPIFY_SHOP_DOMAIN = "return-ai-saas.myshopify.com";

async function seedDemoMerchant() {
  const existing = await prisma.merchant.findUnique({
    where: { email: MERCHANT_EMAIL },
  });

  if (existing) {
    await prisma.merchant.delete({ where: { id: existing.id } });
    console.log("Removed previous demo merchant data.");
  }

  const merchant = await prisma.merchant.create({
    data: {
      shopName: MERCHANT_SHOP_NAME,
      email: MERCHANT_EMAIL,
      orders: {
        create: seedOrders.map((order) => buildOrderCreateData(order)),
      },
    },
    include: {
      orders: {
        include: { items: true },
      },
    },
  });

  console.log(`Merchant: ${merchant.shopName} (${merchant.email})`);
  for (const order of merchant.orders) {
    console.log(
      `  Order #${order.orderNumber} · ${order.customerEmail} · ${order.items.length} items`
    );
  }
}

async function seedShopifyMerchantOrders() {
  console.log(`\nSeeding Shopify merchant orders (${SHOPIFY_SHOP_DOMAIN})…`);

  const merchant = await prisma.merchant.findUnique({
    where: { shopDomain: SHOPIFY_SHOP_DOMAIN },
  });

  if (!merchant) {
    console.log(
      `  Skipped — no merchant with shopDomain "${SHOPIFY_SHOP_DOMAIN}".`
    );
    console.log(
      "  Run Shopify OAuth install first, then: npm run db:seed:shopify"
    );
    return;
  }

  console.log(`Merchant: ${merchant.shopName} (${merchant.shopDomain})`);
  await seedMerchantOrders(prisma, merchant);
}

async function main() {
  console.log("Seeding database…");

  await seedDemoMerchant();
  await seedShopifyMerchantOrders();

  console.log("\nSeed complete. Test with:");
  console.log("  Order 1001 / test1@gmail.com");
  console.log("  Order 1002 / test2@gmail.com");
  console.log("  Order 1003 / test3@gmail.com");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
