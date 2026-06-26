import { NextResponse } from "next/server";
import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
  getAuditRequestContext,
  logUnauthorizedApiAccess,
  safeCreateAdminAuditLog,
} from "@/lib/adminAudit";
import { AUDIT_ACTORS, AUDIT_EVENTS, logAuditInfo } from "@/lib/audit";
import { handleApiError } from "@/lib/errors";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import {
  buildDefaultMerchantSettingsCreate,
  buildMerchantSettingsAuditMetadata,
  merchantSettingsUpdateSchema,
  serializeMerchantSettings,
} from "@/lib/merchantSettings";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import { parseJsonBody, validateBody } from "@/lib/validation";

const MERCHANT_DEFAULTS_SELECT = {
  id: true,
  email: true,
  returnWindowDays: true,
  allowExchange: true,
  allowKeepItem: true,
  allowPartialRefund: true,
  allowStoreCredit: true,
  freeExchangeShipping: true,
};

async function loadMerchantDefaults(merchantId) {
  return prisma.merchant.findUnique({
    where: { id: merchantId },
    select: MERCHANT_DEFAULTS_SELECT,
  });
}

async function ensureMerchantSettings(merchantId) {
  const merchantDefaults = await loadMerchantDefaults(merchantId);

  if (!merchantDefaults) {
    return null;
  }

  return prisma.merchantSettings.upsert({
    where: { merchantId },
    create: buildDefaultMerchantSettingsCreate(merchantDefaults),
    update: {},
  });
}

export async function GET(request) {
  let merchant = null;

  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      await logUnauthorizedApiAccess(request, {
        routeName: "merchant-settings-get",
        resourceId: "/api/settings",
        method: "GET",
      });
      return auth.response;
    }

    merchant = auth.merchant;
    const settings = await ensureMerchantSettings(merchant.id);

    if (!settings) {
      return NextResponse.json(
        { success: false, message: "Merchant not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      settings: serializeMerchantSettings(settings),
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id ?? null,
      shopDomain: merchant?.shopDomain ?? null,
      action: "merchant_settings_get",
    });

    return handleApiError(error, {
      context: "merchant-settings-get",
      fallbackMessage: "Unable to load merchant settings.",
      fallbackCode: "MERCHANT_SETTINGS_LOAD_ERROR",
    });
  }
}

export async function PUT(request) {
  let merchant = null;

  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      await logUnauthorizedApiAccess(request, {
        routeName: "merchant-settings-put",
        resourceId: "/api/settings",
        method: "PUT",
      });
      return auth.response;
    }

    merchant = auth.merchant;

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }

    const validated = validateBody(merchantSettingsUpdateSchema, parsed.data);
    if (!validated.ok) {
      return validated.response;
    }

    const existing = await ensureMerchantSettings(merchant.id);
    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Merchant not found." },
        { status: 404 },
      );
    }

    const updateData = validated.data;

    const updated = await prisma.merchantSettings.update({
      where: { merchantId: merchant.id },
      data: updateData,
    });

    const auditMetadata = buildMerchantSettingsAuditMetadata(existing, updated);

    if (auditMetadata.changedFields.length > 0) {
      logAuditInfo(AUDIT_EVENTS.MERCHANT_SETTINGS_UPDATED, {
        actorType: AUDIT_ACTORS.MERCHANT,
        ...auditMetadata,
      });

      await safeCreateAdminAuditLog({
        merchantId: merchant.id,
        eventType: ADMIN_AUDIT_EVENTS.MERCHANT_SETTINGS_UPDATED,
        actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
        severity: ADMIN_AUDIT_SEVERITY.INFO,
        resourceType: "MERCHANT_SETTINGS",
        resourceId: updated.id,
        message: "Merchant settings updated",
        metadata: auditMetadata,
        ...getAuditRequestContext(request),
      });
    }

    return NextResponse.json({
      success: true,
      settings: serializeMerchantSettings(updated),
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id ?? null,
      shopDomain: merchant?.shopDomain ?? null,
      action: "merchant_settings_put",
    });

    return handleApiError(error, {
      context: "merchant-settings-put",
      fallbackMessage: "Unable to update merchant settings.",
      fallbackCode: "MERCHANT_SETTINGS_UPDATE_ERROR",
    });
  }
}
