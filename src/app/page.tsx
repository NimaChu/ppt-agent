import { redirect } from "next/navigation";
import { PptAgentApp } from "@/components/ppt-agent-app";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <PptAgentApp user={user} />;
}
