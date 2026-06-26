import { NextResponse } from "next/server";
import { requireMerchant } from "@/lib/auth";

/** Require merchant session for API routes; returns 401 response if missing. */
export async function requireMerchantForRoute() {
  try {
    const merchant = await requireMerchant();
    return { merchant };
  } catch {
    return {
      response: NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      ),
    };
  }
}
