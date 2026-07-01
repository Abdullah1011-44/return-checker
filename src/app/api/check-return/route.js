import { handleApiError } from "@/lib/errors";
import {
  evaluateCheckReturnItemDecisions,
  mergeCheckItemWithDecision,
} from "@/lib/itemRecoveryDecisions";
import { buildOrderCheckResponse, findMockOrder } from "@/lib/mockOrders";
import {
  buildOrderCheckApiResponse,
  findCustomerOrderForReturn,
  orderNotFoundMessage,
  resolveMerchantForCustomerFlow,
} from "@/lib/orderLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { captureException } from "@/lib/sentry";
import {
  checkReturnSchema,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/validation";

export async function POST(request) {
  let merchant = null;

  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: "check-return",
      limit: 20,
      windowMs: 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult);
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }

    const validated = checkReturnSchema.safeParse(parsed.data);
    if (!validated.success) {
      return validationErrorResponse(validated.error);
    }

    const { orderNumber, email } = validated.data;

    merchant = await resolveMerchantForCustomerFlow();

    const order = await findCustomerOrderForReturn({
      orderNumber,
      email,
      merchant,
    });

    if (order) {
      const orderCheck = await buildOrderCheckApiResponse(order);
      // Per-item product exclusion (pre-flight) + offer ladder for non-excluded items.
      // Recovery rules load inside evaluateCheckReturnItemDecisions when not on order.
      const { itemDecisions, hasExcludedItems, serializePolicyResult } =
        await evaluateCheckReturnItemDecisions({
          order,
          merchantId: order.merchantId,
          merchant: order.merchant,
          settings: order.merchantSettings,
          recoveryRules: order.recoveryRules,
        });

      const items = orderCheck.items.map((checkItem) =>
        mergeCheckItemWithDecision(
          checkItem,
          itemDecisions.find((decision) => decision.itemId === checkItem.id),
        ),
      );

      // TODO: Persist policyResult after schema support is added.
      return Response.json({
        ...orderCheck,
        items,
        hasExcludedItems,
        itemDecisions,
        policyResult: serializePolicyResult(),
      });
    }

    // Merchant session: never fall back to demo mock data
    if (merchant) {
      return Response.json({
        success: true,
        orderFound: false,
        orderNumber: orderNumber.replace(/^#/, ""),
        customerEmail: email,
        orderEligible: false,
        items: [],
        message: orderNotFoundMessage(merchant),
      });
    }

    // Public flow (no merchant session): allow mock orders for local dev/testing
    const mockOrder = findMockOrder(orderNumber, email);
    if (mockOrder) {
      return Response.json(buildOrderCheckResponse(mockOrder));
    }

    return Response.json({
      success: true,
      orderFound: false,
      orderNumber: orderNumber.replace(/^#/, ""),
      customerEmail: email,
      orderEligible: false,
      items: [],
      message: orderNotFoundMessage(null),
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id || null,
      shopDomain: merchant?.shopDomain || null,
      action: "check_return",
    });

    return handleApiError(error, {
      context: "check-return",
      fallbackMessage: "Unable to check return eligibility. Please try again.",
      fallbackCode: "CHECK_RETURN_ERROR",
    });
  }
}
