import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { createJobFromForm, listJobsForUser } from "@/lib/jobs";
import type { JobManifest } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const jobs = await listJobsForUser(user.id);
    return NextResponse.json({ jobs: jobs.map((job) => stripUserHiddenArtifacts(job, user.role)) });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const formData = await request.formData();
    const manifest = await createJobFromForm(formData, user);
    return NextResponse.json({ jobId: manifest.id });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create job" },
      { status: 500 },
    );
  }
}

function stripUserHiddenArtifacts(job: JobManifest, role: "admin" | "user") {
  if (role === "admin") return job;
  const artifacts = { ...job.artifacts };
  delete artifacts["qa_report.md"];
  return { ...job, artifacts };
}
