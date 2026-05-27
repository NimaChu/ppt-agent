import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { safeSegment } from "@/lib/fs-utils";
import { reviseJobSlide } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireCurrentUser();
    const body = (await request.json().catch(() => null)) as { slideNumber?: number; instruction?: string } | null;
    await reviseJobSlide(safeSegment(id), user, Number(body?.slideNumber), String(body?.instruction ?? ""));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not revise slide" }, { status: 400 });
  }
}
