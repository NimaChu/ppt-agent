import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { safeSegment } from "@/lib/fs-utils";
import { artifactStream, readManifestForUser } from "@/lib/jobs";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  "final.pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "contact-sheet.png": "image/png",
  "qa_report.md": "text/markdown; charset=utf-8",
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const user = await requireCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = safeSegment(id);
  const manifest = await readManifestForUser(jobId, user.id).catch(() => null);
  if (!manifest) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  const safeName = safeSegment(name);
  if (safeName === "qa_report.md" && user.role !== "admin") {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }
  const stream = await artifactStream(jobId, safeName);
  if (!stream) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

  return new Response(stream as unknown as BodyInit, {
    headers: {
      "content-type": CONTENT_TYPES[safeName] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${safeName}"`,
    },
  });
}
