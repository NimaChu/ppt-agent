import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { importUploadedPptxTemplate } from "@/lib/template-import";
import { deleteTemplate, listTemplates } from "@/lib/templates";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminUser();
    return NextResponse.json({ templates: await listTemplates() });
  } catch (error) {
    return authError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) throw new Error("请上传 PPTX/POTX 文件");

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("PPTX file is required");
    const result = await importUploadedPptxTemplate({
      file,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      tags: splitTags(String(formData.get("tags") ?? "")),
    });
    return NextResponse.json({ template: result });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return NextResponse.json({ error: error.message }, { status: 401 });
      if (error.message === "Forbidden") return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Template import failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdminUser();
    const body = (await request.json().catch(() => null)) as { templateId?: string } | null;
    if (!body?.templateId) throw new Error("Template ID is required");
    const result = await deleteTemplate(body.templateId);
    return NextResponse.json({ template: result });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return NextResponse.json({ error: error.message }, { status: 401 });
      if (error.message === "Forbidden") return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Template delete failed" }, { status: 500 });
  }
}

function splitTags(value: string) {
  return value
    .split(/[,，/、;；\s]+/g)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function authError(error: unknown) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "Forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 500 });
}
