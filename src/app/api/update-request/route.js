import { returnRequests } from "@/lib/returnRequests";

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, status, merchantNote, merchantDecision } = body;

    if (!id) {
      return Response.json(
        { success: false, message: "Request ID is required." },
        { status: 400 }
      );
    }

    // Find the request in the array by id
    const existing = returnRequests.find((r) => r.id === id);

    if (!existing) {
      return Response.json(
        { success: false, message: "Request not found." },
        { status: 404 }
      );
    }

    // Update only the fields that were sent
    if (status)           existing.status           = status;
    if (merchantNote !== undefined) existing.merchantNote = merchantNote;
    if (merchantDecision) existing.merchantDecision = merchantDecision;

    // Always save when the merchant last touched this
    existing.updatedAt = new Date().toISOString();

    return Response.json({
      success: true,
      message: "Request updated successfully.",
      request: existing,
    });
  } catch {
    return Response.json(
      { success: false, message: "Something went wrong." },
      { status: 500 }
    );
  }
}