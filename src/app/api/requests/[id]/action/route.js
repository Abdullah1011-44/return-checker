import { NextResponse } from "next/server";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { prisma } from "@/lib/prisma";

const VALID_ACTIONS = ["APPROVE", "REJECT", "NEEDS_MORE_INFO", "RESOLVE"];

const ACTION_CONFIG = {
  APPROVE: {
    status: "APPROVED",
    merchantDecision: "APPROVED",
    eventType: "DECISION_MADE",
    label: "Approved",
  },
  REJECT: {
    status: "REJECTED",
    merchantDecision: "REJECTED",
    eventType: "DECISION_MADE",
    label: "Rejected",
  },
  NEEDS_MORE_INFO: {
    status: "IN_REVIEW",
    merchantDecision: "NEEDS_MORE_INFO",
    eventType: "DECISION_MADE",
    label: "Needs more information",
  },
  RESOLVE: {
    status: "RESOLVED",
    eventType: "STATUS_CHANGED",
    label: "Resolved",
  },
};

const requestInclude = {
  order: { include: { items: true } },
  items: { include: { orderItem: true } },
};

function resolveItemDecision(action, currentDecision) {
  if (action === "RESOLVE") {
    return currentDecision === "REJECTED" ? "REJECTED" : "APPROVED";
  }
  return ACTION_CONFIG[action].merchantDecision;
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      return auth.response;
    }

    const { merchant } = auth;
    const { id } = await params;
    const body = await request.json();
    const { action, merchantNote } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Return request ID is required." },
        { status: 400 }
      );
    }

    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid action. Use one of: ${VALID_ACTIONS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const existing = await prisma.returnRequest.findFirst({
      where: {
        id,
        merchantId: merchant.id,
      },
      include: requestInclude,
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Return request not found." },
        { status: 404 }
      );
    }

    const config = ACTION_CONFIG[action];
    const now = new Date();
    const previousStatus = existing.status;

    await prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        const itemData = {
          merchantDecision: resolveItemDecision(action, item.merchantDecision),
          decidedAt: now,
        };

        if (merchantNote !== undefined) {
          itemData.merchantNote = merchantNote.trim() || null;
        }

        await tx.returnItem.update({
          where: { id: item.id },
          data: itemData,
        });
      }

      await tx.returnRequest.updateMany({
        where: {
          id,
          merchantId: merchant.id,
        },
        data: {
          status: config.status,
          ...(action === "RESOLVE" ? { resolvedAt: now } : {}),
        },
      });

      const eventNote = [
        `Merchant action: ${config.label}`,
        merchantNote?.trim() ? `Note: ${merchantNote.trim()}` : null,
      ]
        .filter(Boolean)
        .join(" — ");

      await tx.returnEvent.create({
        data: {
          returnRequestId: id,
          eventType: config.eventType,
          actorType: "merchant",
          fromValue: previousStatus,
          toValue: config.status,
          note: eventNote,
          metadata: {
            action,
            merchantNote: merchantNote?.trim() || null,
            itemCount: existing.items.length,
          },
        },
      });
    });

    const updated = await prisma.returnRequest.findFirst({
      where: {
        id,
        merchantId: merchant.id,
      },
      include: requestInclude,
    });

    return NextResponse.json({
      success: true,
      message: `Return request ${config.label.toLowerCase()} successfully.`,
      request: mapReturnRequestToDashboard(updated),
    });
  } catch (error) {
    console.error("[PATCH /api/requests/[id]/action]", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
