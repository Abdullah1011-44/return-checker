import { returnRequests } from "@/lib/returnRequests";

export async function GET() {
  return Response.json({
    success: true,
    requests: returnRequests,
  });
}
