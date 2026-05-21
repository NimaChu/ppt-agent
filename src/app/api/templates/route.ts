import { NextResponse } from "next/server";
import { listTemplates } from "@/lib/templates";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ templates: await listTemplates() });
}

