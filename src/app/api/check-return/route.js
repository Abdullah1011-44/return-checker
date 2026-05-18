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

    const cleanOrderNumber = orderNumber.replace("#", "").trim();

    // Known orders — eligibility only
    const orders = [
      { orderNumber: "1001", email: "test1@gmail.com", eligible: true },
      { orderNumber: "1002", email: "test2@gmail.com", eligible: true },
      { orderNumber: "1003", email: "test3@gmail.com", eligible: false },
    ];

    const match = orders.find(
      (o) =>
        o.orderNumber === cleanOrderNumber &&
        o.email.toLowerCase() === email.toLowerCase()
    );

    if (!match) {
      return Response.json({ success: true, status: "not_found" });
    }

    if (match.eligible) {
      return Response.json({ success: true, status: "approved" });
    }

    return Response.json({ success: true, status: "rejected" });
  } catch {
    return Response.json(
      { success: false, message: "Something went wrong." },
      { status: 500 }
    );
  }
}