import { NextResponse } from "next/server";
import {
  AUDIT_ACTORS,
  AUDIT_EVENTS,
  safeCreateAuditEvent,
} from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { buildReturnStatusEmail } from "@/lib/emailTemplates";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";
import { logUnauthorizedApiAccess } from "@/lib/adminAudit";
import {
  createApiErrorResponse,
  handleApiError,
  logSafeError,
} from "@/lib/errors";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
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
    auditEvent: AUDIT_EVENTS.MERCHANT_ACTION_APPROVE,
    label: "Approved",
  },
  REJECT: {
    status: "REJECTED",
    merchantDecision: "REJECTED",
    auditEvent: AUDIT_EVENTS.MERCHANT_ACTION_REJECT,
    label: "Rejected",
  },
  NEEDS_MORE_INFO: {
    status: "IN_REVIEW",
    merchantDecision: "NEEDS_MORE_INFO",
    auditEvent: AUDIT_EVENTS.MERCHANT_ACTION_NEEDS_MORE_INFO,
    label: "Needs more information",
  },
  RESOLVE: {
    status: "RESOLVED",
    auditEvent: AUDIT_EVENTS.MERCHANT_ACTION_RESOLVE,
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
    return {
      sent: false,
      error: "CUSTOMER_EMAIL_MISSING",
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

  const emailResult = await sendEmail({
    to: customerEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  if (emailResult.success) {
    return { sent: true };
  }

  return {
    sent: false,
    error: emailResult.error ?? "EMAIL_SEND_FAILED",
  };
}

async function logEmailAuditEvent({ returnRequestId, action, emailResult }) {
  const sent = emailResult.sent === true;

  await safeCreateAuditEvent({
    returnRequestId,
    eventType: sent ? AUDIT_EVENTS.EMAIL_SENT : AUDIT_EVENTS.EMAIL_FAILED,
    actorType: AUDIT_ACTORS.SYSTEM,
    note: sent
      ? "Customer notification email sent"
      : "Customer notification email failed",
    metadata: {
      provider: "resend",
      action,
      recipientType: "customer",
      ...(sent
        ? {}
        : { reason: emailResult.error ?? "EMAIL_SEND_FAILED" }),
    },
  });
}

export async function PATCH(request, { params }) {
  let merchant = null;

  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: "merchant-action",
      limit: 30,
      windowMs: 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult);
    }

    const auth = await requireMerchantForRoute();
    if (auth.response) {
      await logUnauthorizedApiAccess(request, {
        routeName: "merchant-action",
        resourceId: "/api/requests/[id]/action",
        method: "PATCH",
      });

      return createApiErrorResponse("Unauthorized", 401, "UNAUTHORIZED");
    }

    merchant = auth.merchant;
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
      return createApiErrorResponse(
        "Return request not found",
        404,
        "RETURN_REQUEST_NOT_FOUND"
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
    });

    await safeCreateAuditEvent({
      returnRequestId: id,
      eventType: config.auditEvent,
      actorType: AUDIT_ACTORS.MERCHANT,
      fromValue: previousStatus,
      toValue: config.status,
      note: merchantNote?.trim() || `Merchant action: ${config.label}`,
      metadata: {
        action,
        itemDecisionCount: existing.items.length,
        hasMerchantNote: Boolean(merchantNote?.trim()),
      },
    });

    const updated = await prisma.returnRequest.findFirst({
      where: {
        id,
        merchantId: merchant.id,
      },
      include: requestInclude,
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
        logSafeError("merchant-action-email", emailError);
        email = {
          sent: false,
          error: "EMAIL_SEND_FAILED",
        };
      }

      await logEmailAuditEvent({
        returnRequestId: id,
        action,
        emailResult: email,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Return request ${config.label.toLowerCase()} successfully.`,
      request: mapReturnRequestToDashboard(updated),
      email:
        email.sent === true
          ? { sent: true }
          : shouldSendEmailNotification(existing, action)
            ? { sent: false, error: "Email notification failed" }
            : { sent: false },
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id || null,
      shopDomain: merchant?.shopDomain || null,
      action: "merchant_action",
    });

    return handleApiError(error, {
      context: "merchant-action",
      fallbackMessage: "Unable to update return request. Please try again.",
      fallbackCode: "MERCHANT_ACTION_ERROR",
    });
  }
}
