import { redirect } from "next/navigation";
import { getCurrentMerchant } from "@/lib/auth";

export default async function DashboardLayout({ children }) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    redirect("/");
  }
  return children;
}
