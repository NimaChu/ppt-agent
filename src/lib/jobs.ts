import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir, safeSegment, pathExists } from "@/lib/fs-utils";
import { JOBS_DIR, PPT_AGENT_SKILL_DIR, TEMPLATES_DIR, VALIDATE_JOB_SCRIPT } from "@/lib/paths";
import { selectAgentCli, spawnAgentCli } from "@/lib/agent-cli";
import { pythonCommand } from "@/lib/runtime";
import { getTemplate } from "@/lib/templates";
import type { AppUser, JobEvent, JobManifest, Preset } from "@/lib/types";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".docx", ".pdf", ".pptx", ".xlsx", ".csv"]);

export function jobDir(jobId: string) {
  return path.join(JOBS_DIR, safeSegment(jobId, "job"));
}

function manifestPath(jobId: string) {
  return path.join(jobDir(jobId), "manifest.json");
}

function eventsPath(jobId: string) {
  return path.join(jobDir(jobId), "logs", "events.jsonl");
}

export async function appendEvent(jobId: string, event: JobEvent) {
  await ensureDir(path.join(jobDir(jobId), "logs"));
  await fs.appendFile(eventsPath(jobId), `${JSON.stringify(event)}\n`, "utf8");
}

export async function readManifest(jobId: string): Promise<JobManifest> {
  const raw = JSON.parse(await fs.readFile(manifestPath(jobId), "utf8")) as Partial<JobManifest>;
  return normalizeManifest(raw, jobId);
}

export async function writeManifest(manifest: JobManifest) {
  manifest.updatedAt = new Date().toISOString();
  await fs.writeFile(manifestPath(manifest.id), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function updateJob(jobId: string, patch: Partial<JobManifest>, stage?: string) {
  const manifest = await readManifest(jobId);
  const next = { ...manifest, ...patch, stage: stage ?? patch.stage ?? manifest.stage };
  await writeManifest(next);
  if (patch.status || stage) {
    await appendEvent(jobId, {
      type: "status",
      status: next.status,
      stage: next.stage,
      at: new Date().toISOString(),
    });
  }
  return next;
}

export async function createJobFromForm(formData: FormData, user: AppUser) {
  const prompt = String(formData.get("prompt") ?? "").trim();
  const templateId = safeSegment(String(formData.get("templateId") ?? "mckinsey-consulting"));
  const preset = normalizePreset(String(formData.get("preset") ?? "standard"));
  const template = await getTemplate(templateId);
  const jobId = `job-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const dir = jobDir(jobId);

  await Promise.all([
    ensureDir(path.join(dir, "uploads")),
    ensureDir(path.join(dir, "planning")),
    ensureDir(path.join(dir, "preview")),
    ensureDir(path.join(dir, "qa")),
    ensureDir(path.join(dir, "output")),
    ensureDir(path.join(dir, "logs")),
  ]);

  const uploads: string[] = [];
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  for (const file of files) {
    if (!file.name || file.size === 0) continue;
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      await appendEvent(jobId, {
        type: "log",
        stream: "system",
        message: `Skipped unsupported upload: ${file.name}`,
        at: new Date().toISOString(),
      });
      continue;
    }
    const safeName = safeSegment(file.name, `upload${ext}`);
    const target = path.join(dir, "uploads", safeName);
    await fs.writeFile(target, Buffer.from(await file.arrayBuffer()));
    uploads.push(safeName);
  }

  const now = new Date().toISOString();
  const agent = selectAgentCli();
  const manifest: JobManifest = {
    id: jobId,
    userId: user.id,
    title: titleFromPrompt(prompt),
    conversationId: jobId,
    messages: [
      {
        role: "user",
        text: prompt,
        at: now,
      },
    ],
    status: "queued",
    stage: "queued",
    createdAt: now,
    updatedAt: now,
    templateId,
    preset,
    agentId: agent?.id,
    agentCommand: agent?.command,
    prompt,
    uploads,
    artifacts: {},
  };

  await writeManifest(manifest);
  await fs.writeFile(path.join(dir, "transcript.md"), `# User request\n\n${prompt || "(empty)"}\n`, "utf8");
  await fs.writeFile(
    path.join(dir, "request.json"),
    `${JSON.stringify(
      {
        preset,
        prompt,
        templateId,
        templateDir: path.join(TEMPLATES_DIR, templateId),
        template: template
          ? {
              id: template.id,
              kind: template.kind,
              name: template.localized?.name ?? { zh: template.name, en: template.name },
              purpose: template.localized?.purpose ?? { zh: template.purpose, en: template.purpose },
              style: template.localized?.style ?? { zh: template.style, en: template.style },
              tags: template.localized?.tags ?? { zh: template.tags, en: template.tags },
              templateDir: path.join(TEMPLATES_DIR, templateId),
              templatePptxPath: template.templatePath,
              designSpecPath: template.designSpecPath,
              specLockPath: template.specLockPath,
              sampleSvgDir: template.sampleSvgDir,
              sourceExample: template.sourceExample,
              templateStrength: template.templateStrength,
            }
          : null,
        uploads: uploads.map((name) => path.join(dir, "uploads", name)),
        skill: "$ppt-agent-pipeline",
        pipelineDir: PPT_AGENT_SKILL_DIR,
        pipelineSkillPath: path.join(PPT_AGENT_SKILL_DIR, "SKILL.md"),
        agent: agent
          ? {
              id: agent.id,
              label: agent.label,
              command: agent.command,
            }
          : null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await appendEvent(jobId, { type: "status", status: "queued", stage: "queued", at: now });

  startAgentJob(jobId).catch(async (error) => {
    await failJob(jobId, error instanceof Error ? error.message : String(error));
  });

  return manifest;
}

export async function listJobsForUser(userId: string) {
  await ensureDir(JOBS_DIR);
  const entries = await fs.readdir(JOBS_DIR, { withFileTypes: true }).catch(() => []);
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await readManifest(entry.name);
        } catch {
          return null;
        }
      }),
  );
  return manifests
    .filter((manifest): manifest is JobManifest => manifest !== null && manifest.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function readManifestForUser(jobId: string, userId: string) {
  const manifest = await readManifest(jobId);
  if (manifest.userId !== userId) return null;
  return manifest;
}

function normalizePreset(value: string): Preset {
  return value === "quick" || value === "polished" ? value : "standard";
}

async function failJob(jobId: string, message: string) {
  await appendEvent(jobId, { type: "error", message, at: new Date().toISOString() });
  await updateJob(jobId, { status: "failed", error: message }, "failed");
}

async function buildAgentPrompt(jobId: string) {
  const dir = jobDir(jobId);
  const manifest = await readManifest(jobId);
  const templateDir = path.join(TEMPLATES_DIR, manifest.templateId);
  const pipelineSkillPath = path.join(PPT_AGENT_SKILL_DIR, "SKILL.md");
  const python = pythonCommand();
  return `You are running as the local coding-agent backend for the ppt agent web app.

Use the project-bundled ppt-agent pipeline instructions at ${pipelineSkillPath} as the contract for this job. If your runtime cannot load Codex skills directly, still read and follow that file's visible rules: produce editable PPTX through the service-oriented ppt-agent-pipeline workflow.

Job workspace: ${dir}
Request JSON: ${path.join(dir, "request.json")}
Uploads directory: ${path.join(dir, "uploads")}
Template directory: ${templateDir}
Pipeline directory: ${PPT_AGENT_SKILL_DIR}

Template usage contract:
- Read ${path.join(templateDir, "SKILL.md")} first when it exists.
- Read request.json.template for exact template metadata and paths.
- If references/design_spec.md exists, use it as the primary reusable style and layout specification.
- If references/spec_lock.md exists, treat it as the strongest color, typography, spacing, icon, and image contract.
- If references/sample_svgs/ exists, study the reusable page rhythm and layout patterns only; do not copy the original deck text or business content.
- If template.pptx exists, use it as a PowerPoint master/style reference when useful, but still produce a new editable output/final.pptx for the user's request.
- This app intentionally removed screenshot-only HTML visual references. Selected templates are PPT-generation templates.

You must keep all artifacts inside the job workspace and satisfy this output contract:
- planning/outline.md
- planning/design_system.json
- planning/slide_plan.json, shaped as { "slides": [...] } or a slide array. Every slide object must include title, claim, layout, and route. Use route "pptxgenjs" for native editable pptxgenjs slides unless another allowed route is explicitly required.
- output/final.pptx
- preview/contact-sheet.png when preview rendering is possible
- qa/qa_report.md

JSON artifact rules:
- Write strict UTF-8 JSON only. Do not use Markdown fences, comments, trailing commas, or unescaped quotes inside strings.
- Escape all double quotes that appear in Chinese or English prose, for example 神奇的\\"魔法屋\\".
- Before your final response, run ${python} -m json.tool on planning/design_system.json and planning/slide_plan.json, then fix any JSON error.

Use the templateId and templateDir recorded in request.json. Prefer editable native PPT objects and the service-oriented route from $ppt-agent-pipeline. Do not use screenshot-only PPT slides as the main output. Log concise progress in your final response.`;
}

async function startAgentJob(jobId: string) {
  await updateJob(jobId, { status: "running" }, "running");
  const agent = selectAgentCli();
  if (!agent) {
    await failJob(jobId, "No supported coding-agent CLI found. Install or log in to Claude Code, Codex, Gemini, Cursor Agent, Trae Agent, or OpenCode.");
    return;
  }
  await appendEvent(jobId, {
    type: "log",
    stream: "system",
    message: `Starting ${agent.label}: ${agent.command}`,
    at: new Date().toISOString(),
  });

  const child = spawnAgentCli(await buildAgentPrompt(jobId), jobDir(jobId));

  child.stdout.on("data", (chunk) => {
    void appendEvent(jobId, {
      type: "log",
      stream: "stdout",
      message: String(chunk),
      at: new Date().toISOString(),
    });
  });
  child.stderr.on("data", (chunk) => {
    void appendEvent(jobId, {
      type: "log",
      stream: "stderr",
      message: String(chunk),
      at: new Date().toISOString(),
    });
  });
  child.on("error", (error) => {
    void failJob(jobId, `Could not start Agent CLI: ${error.message}`);
  });
  child.on("close", (code) => {
    void (async () => {
      if (code !== 0) {
        await failJob(jobId, `Agent CLI exited with code ${code ?? "unknown"}`);
        return;
      }
      await validateAndComplete(jobId);
    })();
  });
}

async function validateAndComplete(jobId: string) {
  await updateJob(jobId, { status: "validating" }, "validating");
  const dir = jobDir(jobId);
  await normalizeSlidePlanForValidation(jobId);
  const validator = spawn(pythonCommand(), [VALIDATE_JOB_SCRIPT, dir, "--require-final"], {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let errorOutput = "";
  validator.stdout.on("data", (chunk) => {
    output += String(chunk);
    void appendEvent(jobId, { type: "log", stream: "stdout", message: String(chunk), at: new Date().toISOString() });
  });
  validator.stderr.on("data", (chunk) => {
    errorOutput += String(chunk);
    void appendEvent(jobId, { type: "log", stream: "stderr", message: String(chunk), at: new Date().toISOString() });
  });
  validator.on("close", (code) => {
    void (async () => {
      if (code !== 0) {
        await failJob(jobId, formatValidationFailure(errorOutput || output || String(code)));
        return;
      }
      const artifacts = await collectArtifacts(jobId);
      const manifest = await updateJob(jobId, { status: "complete", artifacts }, "complete");
      await appendEvent(jobId, { type: "done", at: new Date().toISOString() });
      await writeManifest(manifest);
    })();
  });
}

async function normalizeSlidePlanForValidation(jobId: string) {
  const slidePlanPath = path.join(jobDir(jobId), "planning", "slide_plan.json");
  if (!(await pathExists(slidePlanPath))) return;
  const raw = await fs.readFile(slidePlanPath, "utf8");
  try {
    const plan = JSON.parse(raw) as unknown;
    const slides = Array.isArray(plan)
      ? plan
      : plan && typeof plan === "object" && Array.isArray((plan as { slides?: unknown }).slides)
        ? (plan as { slides: unknown[] }).slides
        : null;
    if (!slides) return;
    let changed = false;
    const normalized = slides.map((slide) => {
      if (!slide || typeof slide !== "object" || Array.isArray(slide)) return slide;
      const next = { ...(slide as Record<string, unknown>) };
      if (!next.route) {
        next.route = typeof next.renderer === "string" ? normalizeRoute(next.renderer) : "pptxgenjs";
        changed = true;
      }
      return next;
    });
    if (!changed) return;
    const nextPlan = Array.isArray(plan) ? normalized : { ...(plan as Record<string, unknown>), slides: normalized };
    await fs.writeFile(slidePlanPath, `${JSON.stringify(nextPlan, null, 2)}\n`, "utf8");
    await appendEvent(jobId, {
      type: "log",
      stream: "system",
      message: "Normalized slide_plan.json: added missing route fields before validation.",
      at: new Date().toISOString(),
    });
  } catch (error) {
    if (await recoverInvalidSlidePlan(jobId, raw)) {
      await appendEvent(jobId, {
        type: "log",
        stream: "system",
        message: "Recovered invalid slide_plan.json from final PPTX slide count before validation.",
        at: new Date().toISOString(),
      });
      return;
    }
    await appendEvent(jobId, {
      type: "log",
      stream: "system",
      message: `Could not normalize slide_plan.json: ${error instanceof Error ? error.message : String(error)}`,
      at: new Date().toISOString(),
    });
  }
}

async function recoverInvalidSlidePlan(jobId: string, raw: string) {
  const slidePlanPath = path.join(jobDir(jobId), "planning", "slide_plan.json");
  const pptxCount = await countFinalPptxSlides(jobId);
  const inferred = inferSlidesFromMalformedPlan(raw);
  const slideCount = pptxCount ?? inferred.length;
  if (!slideCount || slideCount < 1) return false;

  const slides = Array.from({ length: slideCount }, (_, index) => {
    const partial = inferred[index] ?? {};
    const title = cleanRecoveredText(partial.title) || `Slide ${index + 1}`;
    const claim = cleanRecoveredText(partial.claim) || title;
    const layout = cleanRecoveredText(partial.layout) || "recovered";
    const route = normalizeRoute(cleanRecoveredText(partial.route) || "pptxgenjs");
    return { title, claim, layout, route };
  });

  await fs.writeFile(slidePlanPath, `${JSON.stringify({ slides }, null, 2)}\n`, "utf8");
  return true;
}

function inferSlidesFromMalformedPlan(raw: string) {
  const titles = extractMalformedStringValues(raw, "title");
  const claims = extractMalformedStringValues(raw, "claim");
  const layouts = extractMalformedStringValues(raw, "layout");
  const routes = extractMalformedStringValues(raw, "route");
  const count = Math.max(titles.length, claims.length, layouts.length, routes.length);
  return Array.from({ length: count }, (_, index) => ({
    title: titles[index],
    claim: claims[index],
    layout: layouts[index],
    route: routes[index],
  }));
}

function extractMalformedStringValues(raw: string, key: string) {
  const values: string[] = [];
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"\\r\\n]*)`, "g");
  for (const match of raw.matchAll(pattern)) {
    if (match[1]) values.push(match[1]);
  }
  return values;
}

function cleanRecoveredText(value?: string) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

async function countFinalPptxSlides(jobId: string) {
  const finalPptx = path.join(jobDir(jobId), "output", "final.pptx");
  if (!(await pathExists(finalPptx))) return null;
  const script = [
    "import re, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as z:",
    "    names = z.namelist()",
    "slides = [name for name in names if re.match(r'^ppt/slides/slide[0-9]+\\.xml$', name)]",
    "print(len(slides))",
  ].join("\n");
  return new Promise<number | null>((resolve) => {
    const child = spawn(pythonCommand(), ["-c", script, finalPptx], {
      cwd: jobDir(jobId),
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const count = Number(output.trim());
      resolve(Number.isFinite(count) && count > 0 ? count : null);
    });
  });
}

function normalizeRoute(value: string) {
  const route = value.toLowerCase().replace(/[-\s]+/g, "_");
  if (route === "pptxgenjs" || route === "ooxml" || route === "vector" || route === "ppt_master" || route === "presentations" || route === "manual") {
    return route;
  }
  return "pptxgenjs";
}

function formatValidationFailure(output: string) {
  const report = parseJsonObject(output);
  if (report && typeof report === "object") {
    const data = report as {
      slide_plan_count?: number;
      final_slide_count?: number | null;
      errors?: string[];
      warnings?: string[];
    };
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const parts = [
      `Job validation failed: slide_plan=${data.slide_plan_count ?? "unknown"}, final_pptx=${data.final_slide_count ?? "unknown"}.`,
    ];
    if (errors.length) parts.push(`Errors: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? `; +${errors.length - 8} more` : ""}.`);
    if (warnings.length) parts.push(`Warnings: ${warnings.slice(0, 4).join("; ")}${warnings.length > 4 ? `; +${warnings.length - 4} more` : ""}.`);
    return parts.join(" ");
  }
  return `Job validation failed: ${sanitizeMessage(output)}`;
}

async function collectArtifacts(jobId: string) {
  const dir = jobDir(jobId);
  const candidates = {
    "final.pptx": path.join(dir, "output", "final.pptx"),
    "contact-sheet.png": path.join(dir, "preview", "contact-sheet.png"),
    "qa_report.md": path.join(dir, "qa", "qa_report.md"),
  };
  const artifacts: Record<string, string> = {};
  for (const [name, file] of Object.entries(candidates)) {
    if (await pathExists(file)) artifacts[name] = `/api/jobs/${jobId}/artifacts/${name}`;
  }
  return artifacts;
}

export async function artifactStream(jobId: string, name: string) {
  const dir = jobDir(jobId);
  const fileMap: Record<string, string> = {
    "final.pptx": path.join(dir, "output", "final.pptx"),
    "contact-sheet.png": path.join(dir, "preview", "contact-sheet.png"),
    "qa_report.md": path.join(dir, "qa", "qa_report.md"),
  };
  const file = fileMap[name] ?? path.join(dir, "preview", safeSegment(name));
  if (!(await pathExists(file))) return null;
  return createReadStream(file);
}

export async function readEvents(jobId: string, offset = 0, sanitize = false) {
  const file = eventsPath(jobId);
  if (!(await pathExists(file))) return { events: [] as string[], offset };
  const buffer = await fs.readFile(file);
  const next = buffer.subarray(offset);
  const lines = next
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      if (!sanitize) return [line];
      try {
        const event = sanitizeEvent(JSON.parse(line) as JobEvent);
        return event ? [JSON.stringify(event)] : [];
      } catch {
        return [];
      }
    });
  return { events: lines, offset: buffer.length };
}

function normalizeManifest(raw: Partial<JobManifest>, jobId: string): JobManifest {
  const now = new Date().toISOString();
  const prompt = raw.prompt ?? "";
  return {
    id: raw.id ?? jobId,
    userId: raw.userId ?? "legacy",
    title: raw.title ?? titleFromPrompt(prompt),
    conversationId: raw.conversationId ?? raw.id ?? jobId,
    messages: raw.messages ?? (prompt ? [{ role: "user", text: prompt, at: raw.createdAt ?? now }] : []),
    status: raw.status ?? "failed",
    stage: raw.stage ?? raw.status ?? "failed",
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
    templateId: raw.templateId ?? "mckinsey-consulting",
    preset: raw.preset ?? "standard",
    agentId: raw.agentId,
    agentCommand: raw.agentCommand,
    prompt,
    uploads: raw.uploads ?? [],
    error: raw.error,
    artifacts: raw.artifacts ?? {},
  };
}

function titleFromPrompt(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled PPT";
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact;
}

function sanitizeEvent(event: JobEvent): JobEvent | null {
  if (event.type === "status" || event.type === "done" || event.type === "artifact") return event;
  if (event.type === "error") {
    const message = event.message.startsWith("Job validation failed")
      ? formatValidationFailure(event.message)
      : sanitizeMessage(event.message);
    return { ...event, message };
  }
  const message = summarizeLog(event.stream, event.message);
  return message ? { ...event, message } : null;
}

function summarizeLog(stream: "stdout" | "stderr" | "system", message: string) {
  if (stream === "system") {
    if (/Starting Claude Code/i.test(message)) return "Generation engine started: Claude Code.";
    if (/Starting Codex CLI/i.test(message)) return "Generation engine started: Codex CLI.";
    if (/Starting Gemini CLI/i.test(message)) return "Generation engine started: Gemini CLI.";
    if (/Starting Cursor Agent/i.test(message)) return "Generation engine started: Cursor Agent.";
    if (/Starting Trae Agent/i.test(message)) return "Generation engine started: Trae Agent.";
    if (/Starting OpenCode/i.test(message)) return "Generation engine started: OpenCode.";
    if (/Normalized slide_plan/i.test(message)) return "Slide plan metadata was normalized before validation.";
    return sanitizeMessage(message);
  }
  if (stream === "stdout") {
    const validation = parseValidatorReport(message);
    if (validation) return validation;
    const summaries = message
      .split("\n")
      .map((line) => summarizeAgentJsonLine(line))
      .filter(Boolean);
    if (summaries.length) return summaries.slice(0, 3).join("\n");
    return null;
  }
  return sanitizeMessage(message);
}

function summarizeAgentJsonLine(line: string) {
  const parsed = parseJsonLine(line);
  if (!parsed) return null;
  if (parsed.type === "result") {
    if (parsed.subtype === "success") {
      const minutes = typeof parsed.duration_ms === "number" ? ` in ${Math.round(parsed.duration_ms / 6000) / 10} min` : "";
      return `Generation engine finished${minutes}; validating outputs.`;
    }
    if (parsed.is_error) return `Generation engine reported an error: ${sanitizeMessage(String(parsed.result ?? "unknown error"))}`;
  }
  if (parsed.type === "assistant") {
    const content = (parsed as { message?: { content?: Array<Record<string, unknown>> } }).message?.content ?? [];
    const tool = content.find((item) => item.type === "tool_use");
    if (tool?.name) {
      const input = tool.input as { description?: string; command?: string } | undefined;
      return `Tool: ${sanitizeMessage(input?.description || String(tool.name))}`;
    }
    const text = content.find((item) => item.type === "text");
    if (typeof text?.text === "string") return summarizeAssistantText(text.text);
  }
  if (parsed.type === "tool" || parsed.type === "tool_start" || parsed.type === "tool_call") {
    const name = parsed.name ?? parsed.tool ?? parsed.title;
    if (name) return `Tool: ${sanitizeMessage(String(name))}`;
  }
  if (parsed.type === "message" || parsed.type === "text") {
    const text = parsed.message ?? parsed.text ?? parsed.content;
    if (typeof text === "string") return summarizeAssistantText(text);
  }
  if (parsed.type === "user") {
    const result = (parsed as { tool_use_result?: unknown }).tool_use_result;
    return summarizeToolResult(result);
  }
  return null;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseValidatorReport(message: string) {
  const report = parseJsonObject(message);
  if (!report || typeof report !== "object" || !("ok" in report)) return null;
  const data = report as {
    ok?: boolean;
    slide_plan_count?: number;
    final_slide_count?: number | null;
    errors?: string[];
    warnings?: string[];
  };
  const base = data.ok
    ? `Validation passed: ${data.final_slide_count ?? data.slide_plan_count ?? "unknown"} slides.`
    : `Validation failed: slide_plan=${data.slide_plan_count ?? "unknown"}, final_pptx=${data.final_slide_count ?? "unknown"}.`;
  const errors = Array.isArray(data.errors) && data.errors.length ? ` Errors: ${data.errors.slice(0, 8).join("; ")}${data.errors.length > 8 ? `; +${data.errors.length - 8} more` : ""}.` : "";
  const warnings = Array.isArray(data.warnings) && data.warnings.length ? ` Warnings: ${data.warnings.slice(0, 3).join("; ")}${data.warnings.length > 3 ? `; +${data.warnings.length - 3} more` : ""}.` : "";
  return sanitizeMessage(`${base}${errors}${warnings}`);
}

function parseJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function summarizeAssistantText(text: string) {
  if (/Job Complete/i.test(text)) {
    const slideMatch = text.match(/Slides\*\*?:\s*(\d+)|(\d+)\s+slides/i);
    return `Generation summary ready${slideMatch ? `: ${slideMatch[1] ?? slideMatch[2]} slides` : ""}.`;
  }
  return null;
}

function summarizeToolResult(result: unknown) {
  if (!result) return null;
  const text =
    typeof result === "string"
      ? result
      : typeof result === "object" && result !== null && "stdout" in result
        ? String((result as { stdout?: unknown }).stdout ?? "")
        : "";
  if (!text.trim()) return null;
  const useful = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(File size|Slide count|Has |Output contract|Validation|final\.pptx|qa_report|slide_plan|planning\/|output\/|qa\/)/i.test(line))
    .slice(0, 6);
  return useful.length ? sanitizeMessage(`Tool result: ${useful.join("; ")}`) : null;
}

function sanitizeMessage(message: string) {
  return message
    .replace(/\/Users\/[^\s"',)]+/g, "[local-path]")
    .replace(/data\/jobs\/[^\s"',)]+/g, "[job-path]")
    .replace(/uploads\/[^\s"',)]+/g, "uploads/[file]")
    .replace(/[^\s"',()]+\.(pdf|docx|pptx|xlsx|csv|md|txt)/gi, "[file]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}
