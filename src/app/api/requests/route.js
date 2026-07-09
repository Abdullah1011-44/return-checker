import { NextResponse } from "next/server";
import { mapReturnRequestsToDashboard } from "@/lib/dashboardMapperWithImages";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import {
  aggregateOfferAcceptanceMetrics,
  buildOfferAcceptanceByReturnItemId,
  loadMerchantOfferAcceptances,
} from "@/lib/offerAcceptanceAnalytics";
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

    const [returnRequests, settings, offerAcceptances] = await Promise.all([
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
      loadMerchantOfferAcceptances(prisma, merchant.id),
    ]);

    const offerAcceptanceByReturnItemId =
      buildOfferAcceptanceByReturnItemId(offerAcceptances);

    const requests = await mapReturnRequestsToDashboard(returnRequests, {
      merchantId: merchant.id,
      storeType: settings?.storeType ?? null,
      offerAcceptanceByReturnItemId,
    });

    const offerAcceptanceSummary = aggregateOfferAcceptanceMetrics(
      offerAcceptances,
      { currency: merchant.currency ?? "AUD" },
    );

    return NextResponse.json({
      success: true,
      shopDomain: merchant.shopDomain ?? null,
      requests,
      offerAcceptanceSummary,
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
