import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, pathExists, safeSegment } from "@/lib/fs-utils";
import { TEMPLATES_DIR } from "@/lib/paths";
import { pythonCommand } from "@/lib/runtime";

const INTERNAL_TEMPLATE_IMPORT_SCRIPT = path.join(process.cwd(), "src/server/template-import/pptx_template_import.py");
const INTERNAL_TEMPLATE_IMPORT_CWD = path.dirname(INTERNAL_TEMPLATE_IMPORT_SCRIPT);

type LocalizedInput = {
  zh: string;
  en: string;
};

export async function importUploadedPptxTemplate(input: {
  file: File;
  name: string;
  description: string;
  tags: string[];
}) {
  const name = input.name.trim();
  const description = input.description.trim();
  const tags = input.tags.map((tag) => tag.trim()).filter(Boolean);
  if (!name) throw new Error("模板名称不能为空");
  if (!description) throw new Error("模板描述不能为空");
  if (!tags.length) throw new Error("模板标签不能为空");
  const ext = path.extname(input.file.name).toLowerCase();
  if (ext !== ".pptx" && ext !== ".potx") throw new Error("Only .pptx and .potx uploads are supported");

  const templateId = buildTemplateId(name);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-agent-template-"));
  const uploadPath = path.join(tmpRoot, `${templateId}.pptx`);
  const importDir = path.join(tmpRoot, "imported");
  try {
    await fs.writeFile(uploadPath, Buffer.from(await input.file.arrayBuffer()));
    await runCommand(pythonCommand(), [INTERNAL_TEMPLATE_IMPORT_SCRIPT, uploadPath, "-o", importDir], INTERNAL_TEMPLATE_IMPORT_CWD);

    const svgDir = (await pathExists(path.join(importDir, "svg-flat"))) ? path.join(importDir, "svg-flat") : path.join(importDir, "svg");
    const targetDir = path.join(TEMPLATES_DIR, templateId);
    await writeTemplatePackage({
      targetDir,
      templateId,
      kind: "pptx-imported",
      sourceExample: input.file.name,
      name: { zh: name, en: name },
      purpose: { zh: "", en: "" },
      style: { zh: description, en: description },
      tags: { zh: tags, en: tags },
      templateStrength: "Imported PowerPoint template/reference deck.",
      designSpecPath: (await pathExists(path.join(importDir, "summary.md"))) ? path.join(importDir, "summary.md") : undefined,
      manifestPath: (await pathExists(path.join(importDir, "manifest.json"))) ? path.join(importDir, "manifest.json") : undefined,
      svgDir,
      templatePptxPath: uploadPath,
    });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
  return { id: templateId };
}

function buildTemplateId(name: string) {
  const base = safeSegment(name, "template").toLowerCase();
  return `${base}-${randomUUID().slice(0, 8)}`;
}

async function writeTemplatePackage(input: {
  targetDir: string;
  templateId: string;
  kind: "deck-derived" | "pptx-imported";
  sourceExample: string;
  name: LocalizedInput;
  purpose: LocalizedInput;
  style: LocalizedInput;
  tags: {
    zh: string[];
    en: string[];
  };
  templateStrength: string;
  designSpecPath?: string;
  specLockPath?: string;
  manifestPath?: string;
  svgDir: string;
  templatePptxPath?: string;
}) {
  await fs.rm(input.targetDir, { recursive: true, force: true });
  await Promise.all([
    ensureDir(input.targetDir),
    ensureDir(path.join(input.targetDir, "references", "sample_svgs")),
  ]);

  const sampleSvgFiles = await copySampleSvgs(input.svgDir, path.join(input.targetDir, "references", "sample_svgs"));
  if (input.designSpecPath) await fs.copyFile(input.designSpecPath, path.join(input.targetDir, "references", "design_spec.md"));
  if (input.specLockPath) await fs.copyFile(input.specLockPath, path.join(input.targetDir, "references", "spec_lock.md"));
  if (input.manifestPath) await fs.copyFile(input.manifestPath, path.join(input.targetDir, "references", "manifest.json"));
  if (input.templatePptxPath) await fs.copyFile(input.templatePptxPath, path.join(input.targetDir, "template.pptx"));

  const firstSvgPath = sampleSvgFiles[0] ? path.join(input.targetDir, "references", "sample_svgs", sampleSvgFiles[0]) : undefined;
  const firstSvg = firstSvgPath ? await fs.readFile(firstSvgPath, "utf8") : "";
  await Promise.all([
    fs.writeFile(path.join(input.targetDir, "template.json"), `${JSON.stringify(buildTemplateJson(input), null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(input.targetDir, "SKILL.md"), buildSkillMd(input), "utf8"),
    fs.writeFile(path.join(input.targetDir, "example.md"), buildExampleMd(input), "utf8"),
    fs.writeFile(path.join(input.targetDir, "example.html"), buildExampleHtml(input, firstSvg), "utf8"),
  ]);
  if (firstSvgPath) await writePreviewPng(firstSvgPath, path.join(input.targetDir, "preview.png"));
}

function buildTemplateJson(input: {
  templateId: string;
  kind: "deck-derived" | "pptx-imported";
  sourceExample: string;
  name: LocalizedInput;
  purpose: LocalizedInput;
  style: LocalizedInput;
  tags: {
    zh: string[];
    en: string[];
  };
  templateStrength: string;
}) {
  return {
    id: input.templateId,
    kind: input.kind,
    name: input.name,
    purpose: input.purpose,
    style: input.style,
    tags: input.tags,
    aspectRatio: "16:9",
    sourceExample: input.sourceExample,
    designSpecPath: "references/design_spec.md",
    specLockPath: "references/spec_lock.md",
    sampleSvgDir: "references/sample_svgs",
    templateStrength: input.templateStrength,
  };
}

function buildSkillMd(input: { templateId: string; name: LocalizedInput; kind: string; templateStrength: string }) {
  return `# ${input.name.en}

Use this template when the user selects \`${input.templateId}\` in ppt agent.

- Template kind: \`${input.kind}\`
- Strength: ${input.templateStrength}
- Read \`references/design_spec.md\` for reusable visual rules.
- Read \`references/spec_lock.md\` when present for locked colors, typography, spacing, icons, and image policy.
- Study \`references/sample_svgs/\` for page rhythm and reusable layout patterns.
- Do not copy original sample deck text or business claims into a new user deck.
- Prefer editable PowerPoint objects; use vector-to-PowerPoint conversion only for visual-heavy pages.
`;
}

function buildExampleMd(input: { name: LocalizedInput; purpose: LocalizedInput; style: LocalizedInput }) {
  return `# ${input.name.en}

${input.purpose.en}

${input.style.en}
`;
}

function buildExampleHtml(input: { templateId: string; name: LocalizedInput; purpose: LocalizedInput; style: LocalizedInput }, svg: string) {
  const safeSvg = svg.replace(/<script[\s\S]*?<\/script>/gi, "");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.name.en)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body, main { width: 100%; height: 100%; }
      body { margin: 0; background: #f8fafc; }
      main { display: grid; place-items: center; padding: 0; }
      .frame { width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: white; }
      .frame svg { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <main>
      <section class="frame">${safeSvg}</section>
    </main>
  </body>
</html>
`;
}

async function copySampleSvgs(sourceDir: string, targetDir: string) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const svgFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".svg"))
    .map((entry) => entry.name)
    .sort(sortSlideNames);
  for (const [index, file] of svgFiles.entries()) {
    const targetName = `${String(index + 1).padStart(2, "0")}-${safeSegment(file)}`;
    await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, targetName));
  }
  return svgFiles.map((file, index) => `${String(index + 1).padStart(2, "0")}-${safeSegment(file)}`);
}

function sortSlideNames(a: string, b: string) {
  return slideNumber(a) - slideNumber(b) || a.localeCompare(b);
}

function slideNumber(name: string) {
  const match = name.match(/(?:slide_|slide)(\d+)/i) ?? name.match(/^(\d+)/);
  return match ? Number(match[1]) : 9999;
}

async function writePreviewPng(svgPath: string, outputPath: string) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-agent-preview-"));
  try {
    await runCommand("qlmanage", ["-t", "-s", "640", "-o", tmpDir, svgPath], process.cwd());
    const png = path.join(tmpDir, `${path.basename(svgPath)}.png`);
    if (await pathExists(png)) {
      await fs.copyFile(png, outputPath);
      return;
    }
  } catch {
    // Fall through to a placeholder. The HTML preview remains the richer preview.
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
  await fs.writeFile(outputPath, placeholderPng());
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function placeholderPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lp3m1wAAAABJRU5ErkJggg==",
    "base64",
  );
}
