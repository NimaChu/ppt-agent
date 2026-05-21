import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { safeSegment } from "@/lib/fs-utils";
import { templateDir } from "@/lib/templates";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const templateId = safeSegment(id);
  const language = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "zh";
  const file = path.join(templateDir(templateId), "example.html");
  try {
    const html = localizeTemplateExample(await fs.readFile(file, "utf8"), language);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Template example not found" }, { status: 404 });
  }
}

function localizeTemplateExample(html: string, language: "zh" | "en") {
  const next = html.replace(/<html lang="[^"]*">/, `<html lang="${language === "zh" ? "zh-CN" : "en"}">`);
  return next.replace(
    /<([a-z0-9]+)([^>]*?)\sdata-i18n([^>]*?)>([\s\S]*?)<\/\1>/gi,
    (match, tag: string, attrs: string, attrsAfter: string) => {
      const allAttrs = `${attrs} ${attrsAfter}`;
      const value = readDataAttr(allAttrs, language);
      if (!value) return match;
      return `<${tag}${attrs}${attrsAfter}>${value}</${tag}>`;
    },
  );
}

function readDataAttr(attrs: string, language: "zh" | "en") {
  const match = attrs.match(new RegExp(`data-${language}="([^"]*)"`));
  return match ? match[1] : null;
}
