import { beforeEach, describe, expect, it } from "vitest";
import { findCustomerOrderForReturn } from "@/lib/orderLookup";
import {
  buildScopedReturnRequestWhere,
  createMockMerchantA,
  createMockMerchantB,
  createMockReturnRequest,
  findReturnRequestForMerchant,
  listReturnRequestsForMerchant,
} from "./helpers/mockMerchant.js";
import { mockPrisma } from "./helpers/mockPrisma.js";

describe("merchant isolation", () => {
  const merchantA = createMockMerchantA();
  const merchantB = createMockMerchantB();

  const returnRequestA = createMockReturnRequest({
    id: "return-a",
    merchantId: merchantA.id,
  });
  const returnRequestB = createMockReturnRequest({
    id: "return-b",
    merchantId: merchantB.id,
  });

  beforeEach(() => {
    mockPrisma.returnRequest.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        [returnRequestA, returnRequestB].filter(
          (request) => request.merchantId === where.merchantId,
        ),
      ),
    );

    mockPrisma.returnRequest.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        [returnRequestA, returnRequestB].find(
          (request) =>
            request.id === where.id && request.merchantId === where.merchantId,
        ) ?? null,
      ),
    );
  });

  it("Merchant A can access only Merchant A return requests", async () => {
    const { requests } = await listReturnRequestsForMerchant(
      merchantA,
      mockPrisma,
    );

    expect(requests).toEqual([returnRequestA]);
    expect(
      requests.every((request) => request.merchantId === merchantA.id),
    ).toBe(true);
    expect(mockPrisma.returnRequest.findMany).toHaveBeenCalledWith({
      where: { merchantId: merchantA.id },
    });
  });

  it("Merchant A cannot access Merchant B return requests", async () => {
    const { request } = await findReturnRequestForMerchant(
      merchantA,
      returnRequestB.id,
      mockPrisma,
    );

    expect(request).toBeNull();
    expect(mockPrisma.returnRequest.findFirst).toHaveBeenCalledWith({
      where: {
        id: returnRequestB.id,
        merchantId: merchantA.id,
      },
    });
  });

  it("query filters must include merchantId", async () => {
    const where = buildScopedReturnRequestWhere(merchantA, returnRequestA.id);

    expect(where).toEqual({
      id: returnRequestA.id,
      merchantId: merchantA.id,
    });

    await findCustomerOrderForReturn({
      orderNumber: "1001",
      email: "test1@gmail.com",
      merchant: merchantA,
    });

    expect(mockPrisma.customerOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId: merchantA.id,
        }),
      }),
    );
  });

  it("missing merchantId should fail safely", async () => {
    const where = buildScopedReturnRequestWhere(null, returnRequestA.id);
    expect(where).toBeNull();

    const listResult = await listReturnRequestsForMerchant(null, mockPrisma);
    expect(listResult).toEqual({
      error: "MERCHANT_REQUIRED",
      requests: [],
    });
    expect(mockPrisma.returnRequest.findMany).not.toHaveBeenCalled();

    const findResult = await findReturnRequestForMerchant(
      null,
      returnRequestA.id,
      mockPrisma,
    );
    expect(findResult).toEqual({
      error: "MERCHANT_REQUIRED",
      request: null,
    });
    expect(mockPrisma.returnRequest.findFirst).not.toHaveBeenCalled();
  });
});
