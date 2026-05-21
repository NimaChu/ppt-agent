import { createReadStream } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { safeSegment, pathExists } from "@/lib/fs-utils";
import { templateDir } from "@/lib/templates";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = path.join(templateDir(safeSegment(id)), "preview.png");
  if (!(await pathExists(file))) {
    return NextResponse.json({ error: "Template preview not found" }, { status: 404 });
  }
  return new Response(createReadStream(file) as unknown as BodyInit, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}

