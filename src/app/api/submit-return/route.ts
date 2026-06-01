import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getAiRecommendation,
  mapEligibilityStatus,
  mapRecoveryOption,
  mapReturnReason,
  normalizeEmail,
  normalizeOrderNumber,
} from "@/lib/returnMappers";

type IncomingReturnItem = {
  itemId?: string;
  sku?: string;
  title?: string;
  returnReason?: string;
  comment?: string;
  selectedOption?: string;
  proofImageName?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { orderNumber, email, returnRequestItems } = body as {
      orderNumber?: string;
      email?: string;
      returnRequestItems?: IncomingReturnItem[];
    };

    if (!orderNumber || !email) {
      return Response.json(
        { success: false, message: "Order number and email are required." },
        { status: 400 }
      );
    }

    if (!Array.isArray(returnRequestItems) || returnRequestItems.length === 0) {
      return Response.json(
        { success: false, message: "At least one return item is required." },
        { status: 400 }
      );
    }

    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const normalizedEmail = normalizeEmail(email);

    const order = await prisma.customerOrder.findFirst({
      where: {
        orderNumber: normalizedOrderNumber,
        customerEmail: normalizedEmail,
      },
      include: {
        items: true,
      },
    });

    if (!order) {
      return Response.json(
        {
          success: false,
          message:
            "Order not found. Please check your order number and email address.",
        },
        { status: 404 }
      );
    }

    const returnItemsCreate = [];

    for (const item of returnRequestItems) {
      if (!item.returnReason || !item.selectedOption) {
        return Response.json(
          {
            success: false,
            message:
              "Each return item must include a return reason and preferred resolution.",
          },
          { status: 400 }
        );
      }

      const orderItem = order.items.find(
        (oi) =>
          (item.itemId && oi.id === item.itemId) ||
          (item.sku && oi.sku === item.sku)
      );

      if (!orderItem) {
        return Response.json(
          {
            success: false,
            message: `Order item not found for SKU "${item.sku ?? item.itemId ?? "unknown"}".`,
          },
          { status: 400 }
        );
      }

      const mappedReason = mapReturnReason(item.returnReason);

      returnItemsCreate.push({
        orderItemId: orderItem.id,
        reason: mappedReason,
        comment: item.comment?.trim() || null,
        selectedOption: mapRecoveryOption(item.selectedOption),
        aiRecommendation: getAiRecommendation(item.returnReason),
        eligibilityStatus: mapEligibilityStatus(orderItem.isReturnable),
        imageUrl: item.proofImageName?.trim() || null,
        merchantDecision: "PENDING" as const,
      });
    }

    const returnRequest = await prisma.returnRequest.create({
      data: {
        merchantId: order.merchantId,
        orderId: order.id,
        customerEmail: order.customerEmail,
        status: "PENDING",
        items: {
          create: returnItemsCreate,
        },
      },
      include: {
        items: {
          include: {
            orderItem: true,
          },
        },
      },
    });

    return Response.json({
      success: true,
      message: "Return request submitted successfully.",
      returnRequest: serializeReturnRequest(returnRequest),
    });
  } catch (error) {
    console.error("[submit-return]", error);
    return Response.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}

type ReturnRequestWithItems = Prisma.ReturnRequestGetPayload<{
  include: {
    items: {
      include: {
        orderItem: true;
      };
    };
  };
}>;

function serializeReturnRequest(request: ReturnRequestWithItems) {
  return {
    ...request,
    items: request.items.map((item) => ({
      ...item,
      orderItem: item.orderItem
        ? {
            ...item.orderItem,
            price: item.orderItem.price.toString(),
          }
        : null,
    })),
  };
}
