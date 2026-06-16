import { NextResponse } from "next/server";
import { getCurrentMerchant } from "@/lib/auth";
import { requireAdmin } from "@/lib/adminAuth";

export async function GET() {
  const merchant = await getCurrentMerchant();

  if (!merchant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    requireAdmin(merchant);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    message: "Admin access granted",
  });
}
