import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";

export async function GET() {
  try {
    const returnRequests = await prisma.returnRequest.findMany({
      orderBy: { submittedAt: "desc" },
      include: {
        order: {
          include: {
            items: true,
          },
        },
        items: {
          include: {
            orderItem: true,
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    const requests = returnRequests.map(mapReturnRequestToDashboard);

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("[GET /api/requests]", error);
    return NextResponse.json(
      { success: false, message: "Failed to load return requests." },
      { status: 500 }
    );
  }
}
