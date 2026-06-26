/**
 * Mock order data — replace with database lookups later.
 * Order verification (match order + email) is separate from item eligibility.
 */

const mockOrders = [
  {
    orderNumber: "1001",
    email: "test1@gmail.com",
    items: [
      {
        id: "1001-1",
        title: "Classic Cotton T-Shirt",
        sku: "TEE-BLU-M",
        quantity: 1,
        price: 29.99,
        eligible: true,
        ineligibleReason: "",
        returnable: true,
        finalSale: false,
        itemType: "standard",
      },
      {
        id: "1001-2",
        title: "Everyday Running Shoes",
        sku: "SHOE-GRY-10",
        quantity: 1,
        price: 89.99,
        eligible: true,
        ineligibleReason: "",
        returnable: true,
        finalSale: false,
        itemType: "standard",
      },
      {
        id: "1001-3",
        title: "Merino Wool Socks (3-pack)",
        sku: "SOCK-GRY-OS",
        quantity: 1,
        price: 18.0,
        eligible: true,
        ineligibleReason: "",
        returnable: true,
        finalSale: false,
        itemType: "standard",
      },
    ],
  },
  {
    orderNumber: "1002",
    email: "test2@gmail.com",
    items: [
      {
        id: "1002-1",
        title: "Waterproof Jacket",
        sku: "JKT-BLK-L",
        quantity: 1,
        price: 120.0,
        eligible: true,
        ineligibleReason: "",
        returnable: true,
        finalSale: false,
        itemType: "standard",
      },
      {
        id: "1002-2",
        title: "Clearance Beanie",
        sku: "HAT-RED-OS",
        quantity: 1,
        price: 12.0,
        eligible: false,
        ineligibleReason: "Final sale items cannot be returned.",
        returnable: false,
        finalSale: true,
        itemType: "clearance",
      },
      {
        id: "1002-3",
        title: "Canvas Tote Bag",
        sku: "BAG-NAT-OS",
        quantity: 1,
        price: 24.0,
        eligible: true,
        ineligibleReason: "",
        returnable: true,
        finalSale: false,
        itemType: "standard",
      },
    ],
  },
  {
    orderNumber: "1003",
    email: "test3@gmail.com",
    items: [
      {
        id: "1003-1",
        title: "Limited Edition Hoodie",
        sku: "HD-LTD-XL",
        quantity: 1,
        price: 75.0,
        eligible: false,
        ineligibleReason: "Final sale items cannot be returned.",
        returnable: false,
        finalSale: true,
        itemType: "clearance",
      },
      {
        id: "1003-2",
        title: "Digital Gift Card",
        sku: "GC-50",
        quantity: 1,
        price: 50.0,
        eligible: false,
        ineligibleReason: "Digital products are not eligible for return.",
        returnable: false,
        finalSale: false,
        itemType: "digital",
      },
      {
        id: "1003-3",
        title: "Summer Linen Shirt",
        sku: "SHIRT-WHT-M",
        quantity: 1,
        price: 45.0,
        eligible: false,
        ineligibleReason: "Return window has expired (30 days).",
        returnable: true,
        finalSale: false,
        itemType: "standard",
      },
    ],
  },
];

export function findMockOrder(orderNumber, email) {
  const cleanOrderNumber = orderNumber.replace("#", "").trim();
  return mockOrders.find(
    (order) =>
      order.orderNumber === cleanOrderNumber &&
      order.email.toLowerCase() === email.toLowerCase(),
  );
}

export function buildOrderCheckResponse(order) {
  const orderEligible = order.items.some((item) => item.eligible);

  return {
    success: true,
    orderFound: true,
    orderNumber: order.orderNumber,
    customerEmail: order.email,
    orderEligible,
    items: order.items,
  };
}
