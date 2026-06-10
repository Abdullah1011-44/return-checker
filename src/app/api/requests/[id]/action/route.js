import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { buildReturnStatusEmail } from "@/lib/emailTemplates";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { prisma } from "@/lib/prisma";
import {
  merchantActionBodySchema,
  parseJsonBody,
  returnRequestIdSchema,
  validationErrorResponse,
} from "@/lib/validation";

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
  merchant: true,
  order: { include: { items: true } },
  items: { include: { orderItem: true } },
};

function resolveItemDecision(action, currentDecision) {
  if (action === "RESOLVE") {
    return currentDecision === "REJECTED" ? "REJECTED" : "APPROVED";
  }
  return ACTION_CONFIG[action].merchantDecision;
}

function shouldSendEmailNotification(existing, action) {
  const config = ACTION_CONFIG[action];
  const statusChanged = existing.status !== config.status;

  const decisionsChanged = existing.items.some((item) => {
    const nextDecision = resolveItemDecision(action, item.merchantDecision);
    return item.merchantDecision !== nextDecision;
  });

  return statusChanged || decisionsChanged;
}

function mapReturnItemsForEmail(returnRequest) {
  return returnRequest.items.map((returnItem) => ({
    title: returnItem.orderItem?.productName ?? "Item",
    productName: returnItem.orderItem?.productName ?? "Item",
    sku: returnItem.orderItem?.sku ?? "",
    quantity: returnItem.orderItem?.quantity ?? 1,
  }));
}

async function sendReturnActionEmail({
  returnRequest,
  action,
  merchantNote,
  statusLabel,
}) {
  const customerEmail =
    returnRequest?.order?.customerEmail?.trim() ||
    returnRequest?.customerEmail?.trim() ||
    null;

  const orderNumber =
    returnRequest?.order?.orderNumber || "Unknown";

  if (!customerEmail) {
    console.log("[Email Flow] Email result", {
      success: false,
      error: "CUSTOMER_EMAIL_MISSING",
    });
    return {
      sent: false,
      error: "CUSTOMER_EMAIL_MISSING",
      customerEmail: "",
    };
  }

  const emailContent = buildReturnStatusEmail({
    customerEmail,
    orderNumber,
    merchantName:
      returnRequest.merchant?.shopName ||
      returnRequest.merchant?.shopDomain ||
      "Return Recovery Copilot",
    status: statusLabel,
    action,
    merchantNote:
      merchantNote?.trim() ||
      returnRequest.items.find((item) => item.merchantNote)?.merchantNote ||
      "",
    items: mapReturnItemsForEmail(returnRequest),
  });

  console.log("[Email Flow] Attempting customer email", {
    hasRecipient: Boolean(customerEmail),
    action,
    orderNumber,
  });

  const emailResult = await sendEmail({
    to: customerEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  console.log("[Email Flow] Email result", {
    success: emailResult.success,
    error: emailResult.error || null,
  });

  if (emailResult.success) {
    return { sent: true, customerEmail };
  }

  return {
    sent: false,
    customerEmail,
    error: emailResult.error ?? "EMAIL_SEND_FAILED",
  };
}

async function logEmailAuditEvent({
  returnRequestId,
  action,
  status,
  customerEmail,
  emailResult,
}) {
  try {
    const sent = emailResult.sent === true;

    await prisma.returnEvent.create({
      data: {
        returnRequestId,
        eventType: sent ? "CUSTOMER_EMAIL_SENT" : "CUSTOMER_EMAIL_FAILED",
        actorType: "SYSTEM",
        fromValue: null,
        toValue: customerEmail || null,
        note: sent
          ? "Customer notification email sent"
          : "Customer notification email failed",
        metadata: {
          action,
          status,
          emailSent: sent,
          ...(sent
            ? {}
            : { error: emailResult.error ?? "EMAIL_SEND_FAILED" }),
        },
      },
    });
  } catch {
    console.error("[Audit] Email event failed");
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      return auth.response;
    }

    const { merchant } = auth;
    const { id: rawId } = await params;

    const idResult = returnRequestIdSchema.safeParse(rawId);
    if (!idResult.success) {
      return validationErrorResponse(idResult.error);
    }

    const id = idResult.data;

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }

    const validated = merchantActionBodySchema.safeParse(parsed.data);
    if (!validated.success) {
      return validationErrorResponse(validated.error);
    }

    const { action, merchantNote } = validated.data;

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

    console.log("[Email Flow] Full request loaded", {
      requestId: id,
      hasFullRequest: Boolean(updated),
      hasCustomerEmail: Boolean(
        updated?.order?.customerEmail || updated?.customerEmail
      ),
      orderNumber: updated?.order?.orderNumber || "Unknown",
      action,
    });

    let email = { sent: false };

    if (shouldSendEmailNotification(existing, action)) {
      try {
        email = await sendReturnActionEmail({
          returnRequest: updated,
          action,
          merchantNote,
          statusLabel: config.label,
        });
      } catch (emailError) {
        console.error("[PATCH /api/requests/[id]/action] email failed", {
          message:
            emailError instanceof Error ? emailError.message : "Unknown error",
        });
        email = {
          sent: false,
          error: "EMAIL_SEND_FAILED",
          customerEmail:
            updated.order?.customerEmail?.trim() ||
            updated.customerEmail?.trim() ||
            "",
        };
      }

      await logEmailAuditEvent({
        returnRequestId: id,
        action,
        status: config.status,
        customerEmail: email.customerEmail ?? "",
        emailResult: email,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Return request ${config.label.toLowerCase()} successfully.`,
      request: mapReturnRequestToDashboard(updated),
      email: {
        sent: email.sent === true,
        ...(email.sent
          ? {}
          : email.error
            ? { error: email.error }
            : {}),
      },
    });
  } catch (error) {
    console.error("[PATCH /api/requests/[id]/action]", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
