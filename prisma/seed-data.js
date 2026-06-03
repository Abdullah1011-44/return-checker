/**
 * Test orders mirrored from src/lib/mockOrders.js for check-return + submit-return.
 * Keep in sync when mock order numbers, emails, SKUs, or prices change.
 */
module.exports = [
  {
    orderNumber: "1001",
    email: "test1@gmail.com",
    items: [
      { title: "Classic Cotton T-Shirt", sku: "TEE-BLU-M", quantity: 1, price: 29.99, returnable: true },
      { title: "Everyday Running Shoes", sku: "SHOE-GRY-10", quantity: 1, price: 89.99, returnable: true },
      { title: "Merino Wool Socks (3-pack)", sku: "SOCK-GRY-OS", quantity: 1, price: 18.0, returnable: true },
    ],
  },
  {
    orderNumber: "1002",
    email: "test2@gmail.com",
    items: [
      { title: "Waterproof Jacket", sku: "JKT-BLK-L", quantity: 1, price: 120.0, returnable: true },
      { title: "Clearance Beanie", sku: "HAT-RED-OS", quantity: 1, price: 12.0, returnable: false },
      { title: "Canvas Tote Bag", sku: "BAG-NAT-OS", quantity: 1, price: 24.0, returnable: true },
    ],
  },
  {
    orderNumber: "1003",
    email: "test3@gmail.com",
    items: [
      { title: "Limited Edition Hoodie", sku: "HD-LTD-XL", quantity: 1, price: 75.0, returnable: false },
      { title: "Digital Gift Card", sku: "GC-50", quantity: 1, price: 50.0, returnable: false },
      { title: "Summer Linen Shirt", sku: "SHIRT-WHT-M", quantity: 1, price: 45.0, returnable: true },
    ],
  },
];
