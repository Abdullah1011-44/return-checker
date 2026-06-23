/**
 * Temporary mock test for Task 22 order status mapping.
 * No Shopify API or database access.
 *
 * Run: node scripts/test-order-status.js
 */
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const mapperUrl = pathToFileURL(
    path.join(__dirname, "../src/lib/orderStatusMapper.js")
  ).href;
  const { mapShopifyOrderStatus } = await import(mapperUrl);

  const cases = [
    {
      label: "#1001",
      order: {
        financial_status: "paid",
        fulfillment_status: null,
        cancelled_at: null,
      },
    },
    {
      label: "#1002",
      order: {
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        cancelled_at: null,
      },
    },
    {
      label: "#1003",
      order: {
        financial_status: "pending",
        fulfillment_status: null,
        cancelled_at: null,
      },
    },
    {
      label: "#1004",
      order: {
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        cancelled_at: "2026-06-16T12:00:00Z",
      },
    },
  ];

  for (const { label, order } of cases) {
    console.log(`${label} → ${mapShopifyOrderStatus(order)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/*
Expected output:

#1001 → PAID
#1002 → FULFILLED
#1003 → PENDING
#1004 → CANCELLED
*/
