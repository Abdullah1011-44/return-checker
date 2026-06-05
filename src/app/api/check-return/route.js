import { buildOrderCheckResponse, findMockOrder } from "@/lib/mockOrders";
import {
  buildOrderCheckApiResponse,
  findCustomerOrderForReturn,
  orderNotFoundMessage,
  resolveMerchantForCustomerFlow,
} from "@/lib/orderLookup";

export async function POST(request) {
  try {
    const body = await request.json();
    const { orderNumber, email } = body;

    if (!orderNumber || !email) {
      return Response.json(
        { success: false, message: "Please enter order number and email." },
        { status: 400 }
      );
    }

    const merchant = await resolveMerchantForCustomerFlow();

    const order = await findCustomerOrderForReturn({
      orderNumber,
      email,
      merchant,
    });

    if (order) {
      return Response.json(buildOrderCheckApiResponse(order));
    }

    // Merchant session: never fall back to demo mock data
    if (merchant) {
      return Response.json({
        success: true,
        orderFound: false,
        orderNumber: orderNumber.replace("#", "").trim(),
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
      orderNumber: orderNumber.replace("#", "").trim(),
      customerEmail: email,
      orderEligible: false,
      items: [],
      message: orderNotFoundMessage(null),
    });
  } catch {
    return Response.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
