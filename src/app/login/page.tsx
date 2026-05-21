import { redirect } from "next/navigation";
import { LoginApp } from "@/components/login-app";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return <LoginApp />;
}
