import { NextResponse } from "next/server";
import { captureException } from "@/lib/sentry";
import { runShopifySyncScheduler } from "@/lib/syncScheduler";

function getCronSecret() {
  const value = process.env.CRON_SECRET;
  return typeof value === "string" ? value.trim() : "";
}

function isAuthorizedCronRequest(request) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return { ok: false, reason: "missing_secret" };
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret}`) {
    return { ok: false, reason: "unauthorized" };
  }

  return { ok: true };
}

async function handleCronShopifySync(request) {
  const auth = isAuthorizedCronRequest(request);

  if (auth.reason === "missing_secret") {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  if (auth.reason === "unauthorized") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runShopifySyncScheduler({
      trigger: "cron",
      merchantLimit: 10,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      action: "cron_shopify_sync",
    });

    return NextResponse.json(
      {
        ok: false,
        error: "Shopify sync scheduler failed. Please try again later.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  return handleCronShopifySync(request);
}

export async function POST(request) {
  return handleCronShopifySync(request);
}
