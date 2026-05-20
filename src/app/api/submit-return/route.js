import { returnRequests } from "@/lib/returnRequests";

export async function POST(request) {
  try {
    const body = await request.json();
    const { orderNumber, email, reason, comment, selectedOption, proofImage } = body;

    if (!orderNumber || !email || !reason || !selectedOption) {
      return Response.json(
        { success: false, message: "Missing required fields." },
        { status: 400 }
      );
    }

    const scoreMap = {
      wrong_size:    92,
      damaged_item:  55,
      changed_mind:  70,
      late_delivery: 74,
      other:         60,
    };

    const riskMap = {
      wrong_size:    "Low",
      damaged_item:  "High",
      changed_mind:  "Low",
      late_delivery: "Medium",
      other:         "Medium",
    };

    const actionMap = {
      wrong_size:    "Exchange Product",
      damaged_item:  "Manual Review",
      changed_mind:  "Store Credit",
      late_delivery: "Partial Refund",
      other:         "Manual Review",
    };

    const newRequest = {
      id:              Date.now(),
      orderNumber:     orderNumber.replace("#", "").trim(),
      email,
      reason,
      customerComment: comment || "",
      selectedOption,
      recoveryScore:   scoreMap[reason] ?? 60,
      riskLevel:       riskMap[reason]  ?? "Medium",
      bestAction:      actionMap[reason] ?? "Manual Review",
      status:          "Pending Review",
      createdAt:       new Date().toISOString(),
      proofImage:      proofImage || "",   // ← base64 string or empty
    };

    returnRequests.push(newRequest);

    return Response.json({
      success: true,
      message: "Request submitted. Merchant will review your request.",
    });
  } catch {
    return Response.json(
      { success: false, message: "Something went wrong." },
      { status: 500 }
    );
  }
}