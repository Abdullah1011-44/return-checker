const seedOrders = require("./seed-data");

function orderTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

function buildOrderCreateData(order) {
  return {
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
  };
}

/**
 * Create test orders for a merchant without duplicating existing ones.
 * Safe to run multiple times.
 */
async function seedMerchantOrders(prisma, merchant, orders = seedOrders) {
  let created = 0;
  let skipped = 0;

  for (const order of orders) {
    const existing = await prisma.customerOrder.findUnique({
      where: {
        merchantId_orderNumber: {
          merchantId: merchant.id,
          orderNumber: order.orderNumber,
        },
      },
    });

    if (existing) {
      skipped += 1;
      console.log(
        `  Skip order #${order.orderNumber} · ${order.email} (already exists)`,
      );
      continue;
    }

    await prisma.customerOrder.create({
      data: {
        merchantId: merchant.id,
        ...buildOrderCreateData(order),
      },
    });

    created += 1;
    console.log(
      `  Created order #${order.orderNumber} · ${order.email} · ${order.items.length} items`,
    );
  }

  return { created, skipped };
}

module.exports = {
  seedOrders,
  orderTotal,
  buildOrderCreateData,
  seedMerchantOrders,
};
