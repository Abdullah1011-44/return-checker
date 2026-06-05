import { NextResponse } from "next/server";
import {
  mapReturnRequestToDashboard,
  mapUiMerchantDecisionToPrisma,
  mapUiStatusToPrisma,
} from "@/lib/dashboardMapper";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { prisma } from "@/lib/prisma";

async function logReturnEvent(returnRequestId, data) {
  await prisma.returnEvent.create({
    data: {
      returnRequestId,
      ...data,
    },
  });
}

export async function PATCH(request) {
  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      return auth.response;
    }

    const { merchant } = auth;
    const body = await request.json();
    const { id, status, merchantNote, merchantDecision } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Request ID is required." },
        { status: 400 }
      );
    }

    const existing = await prisma.returnRequest.findFirst({
      where: {
        id,
        merchantId: merchant.id,
      },
      include: {
        order: true,
        items: { include: { orderItem: true } },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Request not found." },
        { status: 404 }
      );
    }

    const prismaStatus = status ? mapUiStatusToPrisma(status) : undefined;
    const prismaDecision = merchantDecision
      ? mapUiMerchantDecisionToPrisma(merchantDecision)
      : undefined;

    const itemData = {};
    if (merchantNote !== undefined) {
      itemData.merchantNote = merchantNote || null;
    }
    if (prismaDecision) {
      itemData.merchantDecision = prismaDecision;
      itemData.decidedAt = new Date();
    }

    if (Object.keys(itemData).length > 0) {
      await prisma.returnItem.updateMany({
        where: { returnRequestId: id },
        data: itemData,
      });

      if (merchantNote !== undefined) {
        await logReturnEvent(id, {
          eventType: "NOTE_ADDED",
          actorType: "merchant",
          note: merchantNote || "Merchant note cleared",
        });
      }

      if (prismaDecision) {
        await logReturnEvent(id, {
          eventType: "DECISION_MADE",
          actorType: "merchant",
          fromValue: existing.items[0]?.merchantDecision ?? "PENDING",
          toValue: prismaDecision,
          note: `Merchant decision: ${merchantDecision}`,
        });
      }
    }

    if (prismaStatus) {
      await prisma.returnRequest.updateMany({
        where: {
          id,
          merchantId: merchant.id,
        },
        data: {
          status: prismaStatus,
          ...(prismaStatus === "RESOLVED" ? { resolvedAt: new Date() } : {}),
        },
      });

      await logReturnEvent(id, {
        eventType: "STATUS_CHANGED",
        actorType: "merchant",
        fromValue: existing.status,
        toValue: prismaStatus,
        note: `Status changed to ${status}`,
      });
    }

    const updated = await prisma.returnRequest.findFirst({
      where: {
        id,
        merchantId: merchant.id,
      },
      include: {
        order: { include: { items: true } },
        items: { include: { orderItem: true } },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Request updated successfully.",
      request: mapReturnRequestToDashboard(updated),
    });
  } catch (error) {
    console.error("[PATCH /api/update-request]", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong." },
      { status: 500 }
    );
  }
}
