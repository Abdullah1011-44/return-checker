import { requireMerchant } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_RECOVERY_ANALYTICS_RANGE,
  RECOVERY_ANALYTICS_RANGES,
} from "@/lib/recoveryAnalytics";
import { loadMerchantRecoveryExportCsv } from "@/lib/recoveryAnalyticsExport";
import { captureException } from "@/lib/sentry";

/**
 * @param {URLSearchParams} searchParams
 */
function resolveRecoveryRangeParam(searchParams) {
  const raw = searchParams.get("range");

  if (raw == null || String(raw).trim() === "") {
    return { ok: true, range: DEFAULT_RECOVERY_ANALYTICS_RANGE };
  }

  const normalized = String(raw).trim().toLowerCase();
  if (!RECOVERY_ANALYTICS_RANGES.includes(normalized)) {
    return { ok: false, range: null };
  }

  return { ok: true, range: normalized };
}

export async function GET(request) {
  let merchant = null;

  try {
    const url = new URL(request.url);

    if (url.searchParams.has("merchantId")) {
      return Response.json(
        {
          success: false,
          message: "merchantId cannot be supplied by the client.",
        },
        { status: 400 },
      );
    }

    const rangeResult = resolveRecoveryRangeParam(url.searchParams);
    if (!rangeResult.ok) {
      return Response.json(
        {
          success: false,
          message: "Invalid range. Use 7d, 30d, or 90d.",
        },
        { status: 400 },
      );
    }

    merchant = await requireMerchant();

    const exportResult = await loadMerchantRecoveryExportCsv(
      prisma,
      merchant.id,
      { range: rangeResult.range },
    );

    return new Response(exportResult.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="recovery-analytics.csv"',
      },
    });
  } catch (error) {
    if (error?.status === 401 || error?.message === "Unauthorized") {
      return Response.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id ?? null,
      shopDomain: merchant?.shopDomain ?? null,
      action: "dashboard_recovery_export",
    });

    console.error("[GET /api/dashboard/recovery/export]", error);

    return Response.json(
      { success: false, message: "Failed to export recovery analytics." },
      { status: 500 },
    );
  }
}
