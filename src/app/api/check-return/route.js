import { buildOrderCheckResponse, findMockOrder } from "@/lib/mockOrders";

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

    const order = findMockOrder(orderNumber, email);

    if (!order) {
      return Response.json({
        success: true,
        orderFound: false,
        orderNumber: orderNumber.replace("#", "").trim(),
        customerEmail: email,
        orderEligible: false,
        items: [],
      });
    }

    return Response.json(buildOrderCheckResponse(order));
  } catch {
    return Response.json(
      { success: false, message: "Something went wrong." },
      { status: 500 }
    );
  }
}
