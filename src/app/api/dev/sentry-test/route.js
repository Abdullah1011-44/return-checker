import { NextResponse } from "next/server";
import { captureException } from "@/lib/sentry";

/**
 * GET /api/dev/sentry-test
 *
 * Development-only route to verify Sentry captureException wiring.
 * Disabled in production (404).
 */
export async function GET(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { success: false, message: "Not found" },
      { status: 404 },
    );
  }

  try {
    throw new Error("Sentry test error from ReturnRadar");
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: null,
      shopDomain: null,
      action: "sentry_test",
    });

    return NextResponse.json({
      success: true,
      message: "Sentry test error captured",
    });
  }
}
