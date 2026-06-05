import { redirect } from "next/navigation";
import { requireMerchant } from "@/lib/auth";

export default async function AnalyticsLayout({ children }) {
  try {
    await requireMerchant();
  } catch {
    redirect("/");
  }
  return children;
}
