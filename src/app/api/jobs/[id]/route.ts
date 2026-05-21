import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { safeSegment } from "@/lib/fs-utils";
import { readManifestForUser } from "@/lib/jobs";
import type { JobManifest } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireCurrentUser();
    const job = await readManifestForUser(safeSegment(id), user.id);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ job: stripUserHiddenArtifacts(job, user.role) });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}

function stripUserHiddenArtifacts(job: JobManifest, role: "admin" | "user") {
  if (role === "admin") return job;
  const artifacts = { ...job.artifacts };
  delete artifacts["qa_report.md"];
  return { ...job, artifacts };
}
