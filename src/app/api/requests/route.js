import { NextResponse } from "next/server";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      return auth.response;
    }

    const { merchant } = auth;

    const returnRequests = await prisma.returnRequest.findMany({
      where: { merchantId: merchant.id },
      orderBy: { submittedAt: "desc" },
      include: {
        order: {
          include: {
            items: true,
          },
        },
        items: {
          include: {
            orderItem: true,
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    const requests = returnRequests.map(mapReturnRequestToDashboard);

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("[GET /api/requests]", error);
    return NextResponse.json(
      { success: false, message: "Failed to load return requests." },
      { status: 500 }
    );
  }
}
