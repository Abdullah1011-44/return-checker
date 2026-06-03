const { PrismaClient } = require("@prisma/client");
const seedOrders = require("./seed-data");

const prisma = new PrismaClient();

const MERCHANT_EMAIL = "demo@returnchecker.shop";
const MERCHANT_SHOP_NAME = "Return Checker Demo";

function orderTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

async function main() {
  console.log("Seeding database…");

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
        create: seedOrders.map((order) => ({
          orderNumber: order.orderNumber,
          customerEmail: order.email.trim().toLowerCase(),
          customerName: `Test Customer (${order.orderNumber})`,
          totalAmount: orderTotal(order.items),
          status: "DELIVERED",
          deliveredAt: new Date(),
          items: {
            create: order.items.map((item) => ({
              productName: item.title,
              sku: item.sku,
              quantity: item.quantity,
              price: item.price,
              isReturnable: item.returnable,
            })),
          },
        })),
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
