import { promises as fs } from "node:fs";
import path from "node:path";
import { TEMPLATES_DIR } from "@/lib/paths";
import type { LocalizedText, TemplateKind, TemplateMeta } from "@/lib/types";
import { isInside, pathExists, safeSegment } from "@/lib/fs-utils";

type LocalizedArray = { zh: string[]; en: string[] };

type TemplateJson = {
  id?: string;
  kind?: TemplateKind;
  name?: string | LocalizedText;
  purpose?: string | LocalizedText;
  style?: string | LocalizedText;
  tags?: string[] | LocalizedArray;
  aspectRatio?: string;
  hasPptxTemplate?: boolean;
  sourceExample?: string;
  designSpecPath?: string;
  specLockPath?: string;
  sampleSvgDir?: string;
  templateStrength?: string;
};

export async function listTemplates(): Promise<TemplateMeta[]> {
  const entries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true }).catch(() => []);
  const templates: TemplateMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(TEMPLATES_DIR, entry.name);
    const metaPath = path.join(dir, "template.json");
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as TemplateJson;
      const hasPptxTemplate = await pathExists(path.join(dir, "template.pptx"));
      const designSpecPath = resolveOptionalTemplatePath(dir, meta.designSpecPath ?? "references/design_spec.md");
      const specLockPath = resolveOptionalTemplatePath(dir, meta.specLockPath ?? "references/spec_lock.md");
      const sampleSvgDir = resolveOptionalTemplatePath(dir, meta.sampleSvgDir ?? "references/sample_svgs");
      const name = normalizeLocalizedText(meta.name, entry.name);
      const purpose = normalizeLocalizedText(meta.purpose, "");
      const style = normalizeLocalizedText(meta.style, "");
      const tags = normalizeLocalizedArray(meta.tags);
      templates.push({
        id: meta.id ?? entry.name,
        kind: meta.kind ?? "deck-derived",
        name: name.en,
        purpose: purpose.en,
        style: style.en,
        tags: tags.en,
        localized: {
          name,
          purpose,
          style,
          tags,
        },
        aspectRatio: meta.aspectRatio ?? "16:9",
        hasPptxTemplate,
        sourceExample: meta.sourceExample,
        designSpecPath,
        specLockPath,
        sampleSvgDir,
        templateStrength: meta.templateStrength,
        previewPath: `/api/templates/${entry.name}/preview`,
        examplePath: `/api/templates/${entry.name}/example`,
        templatePath: hasPptxTemplate ? path.join(dir, "template.pptx") : undefined,
      });
    } catch {
      // Skip malformed template folders; the UI should show only usable entries.
    }
  }

  const preferredOrder = [
    "mckinsey-consulting",
    "google-work-report",
    "dark-tech-agent",
    "anthropic-agent-consulting",
    "image-text-editorial",
    "corporate-strategy-report",
  ];
  return templates.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a.id);
    const bIndex = preferredOrder.indexOf(b.id);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }
    return a.name.localeCompare(b.name);
  });
}

export async function getTemplate(id: string) {
  const templates = await listTemplates();
  return templates.find((template) => template.id === id) ?? null;
}

export async function deleteTemplate(id: string) {
  const segment = safeSegment(id, "");
  if (!segment || segment !== id) throw new Error("Invalid template ID");
  const dir = path.resolve(TEMPLATES_DIR, segment);
  const root = path.resolve(TEMPLATES_DIR);
  if (!isInside(root, dir)) throw new Error("Invalid template path");
  if (!(await pathExists(path.join(dir, "template.json")))) throw new Error("Template not found");
  await fs.rm(dir, { recursive: true, force: true });
  return { id: segment };
}

export function templateDir(id: string) {
  return path.join(TEMPLATES_DIR, id);
}

function normalizeLocalizedText(value: string | LocalizedText | undefined, fallback: string): LocalizedText {
  if (typeof value === "string") return { zh: value || fallback, en: value || fallback };
  return {
    zh: value?.zh || value?.en || fallback,
    en: value?.en || value?.zh || fallback,
  };
}

function normalizeLocalizedArray(value: string[] | LocalizedArray | undefined) {
  if (Array.isArray(value)) return { zh: value, en: value };
  return {
    zh: value?.zh ?? value?.en ?? [],
    en: value?.en ?? value?.zh ?? [],
  };
}

function resolveOptionalTemplatePath(dir: string, relativePath: string | undefined) {
  if (!relativePath) return undefined;
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.join(dir, relativePath);
}
