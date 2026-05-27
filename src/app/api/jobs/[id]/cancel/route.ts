import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { safeSegment } from "@/lib/fs-utils";
import { cancelJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const job = await cancelJob(safeSegment(id), user.id);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cancel task" },
      { status: 409 },
    );
  }
}
