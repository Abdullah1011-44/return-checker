import { NextResponse } from "next/server";
import { mapReturnRequestToCustomerStatus } from "@/lib/customerStatusMapper";
import { prisma } from "@/lib/prisma";
import {
  normalizeEmail,
  normalizeOrderNumber,
} from "@/lib/returnApiMappers";

export async function POST(request) {
  try {
    const body = await request.json();
    const { orderNumber, email } = body;

    if (!orderNumber || !email) {
      return NextResponse.json(
        {
          success: false,
          found: false,
          message: "Order number and email are required.",
        },
        { status: 400 }
      );
    }

    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const normalizedEmail = normalizeEmail(email);

    const returnRequest = await prisma.returnRequest.findFirst({
      where: {
        customerEmail: normalizedEmail,
        order: {
          orderNumber: normalizedOrderNumber,
        },
      },
      orderBy: { submittedAt: "desc" },
      include: {
        order: true,
        items: {
          include: {
            orderItem: true,
          },
        },
      },
    });

    if (!returnRequest) {
      return NextResponse.json({
        success: true,
        found: false,
        message: "Return request not found.",
      });
    }

    return NextResponse.json({
      success: true,
      found: true,
      return: mapReturnRequestToCustomerStatus(returnRequest),
    });
  } catch (error) {
    console.error("[POST /api/return-status]", error);
    return NextResponse.json(
      {
        success: false,
        found: false,
        message: "Unable to look up return status. Please try again.",
      },
      { status: 500 }
    );
  }
}
