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
  buildRecoveryRulesAuditMetadata,
  listMerchantRecoveryRules,
  merchantRecoveryRulesPutSchema,
  rejectClientMerchantId,
  rejectDisallowedRuleTypes,
  serializeMerchantRecoveryRule,
  upsertMerchantRecoveryRules,
} from "@/lib/merchantRecoveryRules";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import {
  parseJsonBody,
  validateBody,
  validationErrorResponse,
} from "@/lib/validation";

export async function GET(request) {
  let merchant = null;

  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      await logUnauthorizedApiAccess(request, {
        routeName: "merchant-recovery-rules-get",
        resourceId: "/api/merchant/recovery-rules",
        method: "GET",
      });
      return auth.response;
    }

    merchant = auth.merchant;
    const rules = await listMerchantRecoveryRules(merchant.id, prisma);

    return NextResponse.json({
      success: true,
      rules: rules.map(serializeMerchantRecoveryRule),
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id ?? null,
      shopDomain: merchant?.shopDomain ?? null,
      action: "merchant_recovery_rules_get",
    });

    return handleApiError(error, {
      context: "merchant-recovery-rules-get",
      fallbackMessage: "Unable to load recovery rules.",
      fallbackCode: "MERCHANT_RECOVERY_RULES_LOAD_ERROR",
    });
  }
}

export async function PUT(request) {
  let merchant = null;

  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      await logUnauthorizedApiAccess(request, {
        routeName: "merchant-recovery-rules-put",
        resourceId: "/api/merchant/recovery-rules",
        method: "PUT",
      });
      return auth.response;
    }

    merchant = auth.merchant;

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }

    const merchantIdError = rejectClientMerchantId(parsed.data);
    if (merchantIdError) {
      return validationErrorResponse(null, [
        { path: "body", message: merchantIdError },
      ]);
    }

    const disallowedTypeError = rejectDisallowedRuleTypes(parsed.data);
    if (disallowedTypeError) {
      return validationErrorResponse(null, [
        { path: "rules", message: disallowedTypeError },
      ]);
    }

    const validated = validateBody(merchantRecoveryRulesPutSchema, parsed.data);
    if (!validated.ok) {
      return validated.response;
    }

    const { beforeRules, afterRules } = await upsertMerchantRecoveryRules(
      merchant.id,
      validated.data.rules,
      prisma,
    );

    const auditMetadata = buildRecoveryRulesAuditMetadata(
      beforeRules,
      afterRules,
    );

    if (auditMetadata.changedFields.length > 0) {
      logAuditInfo(AUDIT_EVENTS.MERCHANT_RECOVERY_RULES_UPDATED, {
        actorType: AUDIT_ACTORS.MERCHANT,
        merchantId: merchant.id,
        ...auditMetadata,
      });

      await safeCreateAdminAuditLog({
        merchantId: merchant.id,
        eventType: ADMIN_AUDIT_EVENTS.MERCHANT_RECOVERY_RULES_UPDATED,
        actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
        severity: ADMIN_AUDIT_SEVERITY.INFO,
        resourceType: "MERCHANT_RECOVERY_RULE",
        resourceId: merchant.id,
        message: "Merchant recovery rules updated",
        metadata: auditMetadata,
        ...getAuditRequestContext(request),
      });
    }

    return NextResponse.json({
      success: true,
      rules: afterRules.map(serializeMerchantRecoveryRule),
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id ?? null,
      shopDomain: merchant?.shopDomain ?? null,
      action: "merchant_recovery_rules_put",
    });

    return handleApiError(error, {
      context: "merchant-recovery-rules-put",
      fallbackMessage: "Unable to update recovery rules.",
      fallbackCode: "MERCHANT_RECOVERY_RULES_UPDATE_ERROR",
    });
  }
}
