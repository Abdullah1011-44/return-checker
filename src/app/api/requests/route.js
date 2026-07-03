import { NextResponse } from "next/server";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";

export async function GET(request) {
  let merchant = null;

  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      return auth.response;
    }

    merchant = auth.merchant;

    const [returnRequests, settings] = await Promise.all([
      prisma.returnRequest.findMany({
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
      }),
      prisma.merchantSettings.findUnique({
        where: { merchantId: merchant.id },
      }),
    ]);

    const requests = returnRequests.map((returnRequest) =>
      mapReturnRequestToDashboard(returnRequest, {
        storeType: settings?.storeType ?? null,
      }),
    );

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id || null,
      shopDomain: merchant?.shopDomain || null,
      action: "dashboard_requests",
    });

    console.error("[GET /api/requests]", error);
    return NextResponse.json(
      { success: false, message: "Failed to load return requests." },
      { status: 500 },
    );
  }
}
