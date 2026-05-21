import { redirect } from "next/navigation";
import { AdminApp } from "@/components/admin-app";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <AdminApp currentUser={user} />;
}
