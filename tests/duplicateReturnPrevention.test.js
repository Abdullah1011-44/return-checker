import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "./helpers/mockPrisma.js";
import {
  DUPLICATE_BLOCKING_RETURN_STATUSES,
  DUPLICATE_RETURN_MESSAGE,
  applyDuplicateFlagsToCheckItem,
  findDuplicateReturnItems,
  formatDuplicateItemsForResponse,
  hasDuplicateOrderItemIds,
} from "@/lib/duplicateReturnPrevention";

describe("duplicateReturnPrevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasDuplicateOrderItemIds", () => {
    it("returns true when the same item id appears twice", () => {
      expect(hasDuplicateOrderItemIds(["item-1", "item-1"])).toBe(true);
    });

    it("returns false for unique item ids", () => {
      expect(hasDuplicateOrderItemIds(["item-1", "item-2"])).toBe(false);
    });
  });

  describe("findDuplicateReturnItems", () => {
    it("scopes duplicate lookup by merchantId", async () => {
      mockPrisma.returnItem.findMany.mockResolvedValue([]);

      await findDuplicateReturnItems({
        prisma: mockPrisma,
        merchantId: "merchant-a",
        orderItemIds: ["item-1"],
      });

      expect(mockPrisma.returnItem.findMany).toHaveBeenCalledWith({
        where: {
          orderItemId: { in: ["item-1"] },
          returnRequest: {
            merchantId: "merchant-a",
            status: { in: DUPLICATE_BLOCKING_RETURN_STATUSES },
          },
        },
        select: expect.any(Object),
      });
    });

    it("returns useful duplicate item details", async () => {
      mockPrisma.returnItem.findMany.mockResolvedValue([
        {
          orderItemId: "item-1",
          merchantDecision: "PENDING",
          returnRequest: { id: "return-1", status: "PENDING" },
          orderItem: {
            id: "item-1",
            productName: "Blue Tee",
            sku: "TEE-BLU-M",
          },
        },
      ]);

      const duplicates = await findDuplicateReturnItems({
        prisma: mockPrisma,
        merchantId: "merchant-a",
        orderItemIds: ["item-1"],
      });

      expect(duplicates).toEqual([
        {
          orderItemId: "item-1",
          productName: "Blue Tee",
          sku: "TEE-BLU-M",
          returnRequestId: "return-1",
          existingReturnStatus: "PENDING",
          merchantDecision: "PENDING",
        },
      ]);
    });
  });

  describe("applyDuplicateFlagsToCheckItem", () => {
    it("marks duplicate items as not selectable", () => {
      const item = {
        id: "item-1",
        title: "Blue Tee",
        sku: "TEE-BLU-M",
        eligible: true,
        ineligibleReason: "",
      };

      const result = applyDuplicateFlagsToCheckItem(item, {
        orderItemId: "item-1",
        productName: "Blue Tee",
        sku: "TEE-BLU-M",
        returnRequestId: "return-1",
        existingReturnStatus: "PENDING",
        merchantDecision: "PENDING",
      });

      expect(result.eligible).toBe(false);
      expect(result.alreadyReturnRequested).toBe(true);
      expect(result.existingReturnStatus).toBe("PENDING");
      expect(result.duplicateReturnMessage).toBe(DUPLICATE_RETURN_MESSAGE);
      expect(result.ineligibleReason).toBe(DUPLICATE_RETURN_MESSAGE);
    });
  });

  describe("formatDuplicateItemsForResponse", () => {
    it("formats API-safe duplicate item payloads", () => {
      expect(
        formatDuplicateItemsForResponse([
          {
            orderItemId: "item-1",
            productName: "Blue Tee",
            sku: "TEE-BLU-M",
            returnRequestId: "return-1",
            existingReturnStatus: "APPROVED",
            merchantDecision: "APPROVED",
          },
        ])
      ).toEqual([
        {
          orderItemId: "item-1",
          title: "Blue Tee",
          sku: "TEE-BLU-M",
          returnRequestId: "return-1",
          existingReturnStatus: "APPROVED",
          duplicateReturnMessage: DUPLICATE_RETURN_MESSAGE,
        },
      ]);
    });
  });
});

/**
 * Manual test checklist (console-safe):
 *
 * 1. Seed DB: npm run db:seed
 * 2. Start app: npm run dev
 * 3. Submit return for order 1001 / test1@gmail.com with item 1001-1 only -> success
 * 4. Re-open portal, check same order -> item 1001-1 shows "Return already requested"
 * 5. Submit again for item 1001-1 -> HTTP 409 DUPLICATE_RETURN_REQUEST
 * 6. Submit for item 1001-2 from same order -> success
 * 7. Submit body with duplicate itemId twice -> HTTP 400 DUPLICATE_ITEM_IDS_IN_REQUEST
 * 8. Merchant B must not block Merchant A items (merchantId scoped in DB query)
 */
