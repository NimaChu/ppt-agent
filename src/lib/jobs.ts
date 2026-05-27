import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir, safeSegment, pathExists, writeTextAtomic } from "@/lib/fs-utils";
import { JOBS_DIR, PPT_AGENT_SKILL_DIR, PPTX_TO_SVG_SCRIPT, TEMPLATES_DIR, VALIDATE_JOB_SCRIPT } from "@/lib/paths";
import { selectAgentCli, spawnAgentCli } from "@/lib/agent-cli";
import { pythonCommand } from "@/lib/runtime";
import { getTemplate } from "@/lib/templates";
import type { AgentRunMode, AppUser, JobEvent, JobManifest, TemplateMeta } from "@/lib/types";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".svg", ".png", ".jpg", ".jpeg", ".webp"]);
const MAX_VALIDATION_REPAIR_ATTEMPTS = 1;
const MAX_CONCURRENT_JOBS = 2;
const configuredTimeoutMinutes = Number.parseInt(process.env.PPT_AGENT_JOB_TIMEOUT_MINUTES ?? "", 10);
const JOB_TIMEOUT_MINUTES = Number.isFinite(configuredTimeoutMinutes) && configuredTimeoutMinutes > 0 ? configuredTimeoutMinutes : 20;
const JOB_TIMEOUT_MS = JOB_TIMEOUT_MINUTES * 60 * 1000;

type ActiveRun = {
  mode: AgentRunMode;
  child?: ChildProcess;
  timeout: ReturnType<typeof setTimeout>;
  stopReason?: "cancelled" | "timeout";
};

type QueueState = {
  initialized: boolean;
  active: Map<string, ActiveRun>;
  lock: Promise<void>;
};

declare global {
  var __pptAgentQueueState: QueueState | undefined;
}

function queueState() {
  if (!globalThis.__pptAgentQueueState) {
    globalThis.__pptAgentQueueState = {
      initialized: false,
      active: new Map<string, ActiveRun>(),
      lock: Promise.resolve(),
    };
  }
  return globalThis.__pptAgentQueueState;
}

async function withQueueLock<T>(action: () => Promise<T>) {
  const state = queueState();
  const previous = state.lock;
  let release: () => void = () => undefined;
  state.lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

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
  await writeTextAtomic(manifestPath(manifest.id), `${JSON.stringify(manifest, null, 2)}\n`);
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
  await ensureJobQueueStarted();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const templateId = safeSegment(String(formData.get("templateId") ?? "mckinsey-consulting"));
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

  const sourceTemplateDir = path.join(TEMPLATES_DIR, templateId);
  const snapshotTemplateDir = path.join(dir, "template");
  const templateDir = (await pathExists(sourceTemplateDir)) ? snapshotTemplateDir : sourceTemplateDir;
  if (templateDir === snapshotTemplateDir) {
    await fs.cp(sourceTemplateDir, snapshotTemplateDir, { recursive: true });
  }

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
    templateDir,
    agentId: agent?.id,
    agentCommand: agent?.command,
    prompt,
    uploads,
    previewSlides: [],
    repairAttempts: 0,
    retainQaReport: user.role === "admin",
    runMode: "generation",
    queuedAt: now,
    artifacts: {},
  };

  await writeManifest(manifest);
  await fs.writeFile(path.join(dir, "transcript.md"), `# User request\n\n${prompt || "(empty)"}\n`, "utf8");
  await fs.writeFile(
    path.join(dir, "request.json"),
    `${JSON.stringify(
      {
        prompt,
        templateId,
        templateDir,
        retainQaReport: user.role === "admin",
        template: requestTemplateContext(template, templateDir),
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

  await enqueueJob(jobId, "generation");

  return readManifest(jobId);
}

async function listAllJobs() {
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
    .filter((manifest): manifest is JobManifest => manifest !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listJobsForUser(userId: string) {
  await ensureJobQueueStarted();
  return (await listAllJobs()).filter((manifest) => manifest.userId === userId);
}

export async function readManifestForUser(jobId: string, userId: string) {
  await ensureJobQueueStarted();
  const manifest = await readManifest(jobId);
  if (manifest.userId !== userId) return null;
  return manifest;
}

export async function ensureJobQueueStarted() {
  await withQueueLock(async () => {
    const state = queueState();
    if (state.initialized) return;
    state.initialized = true;
    const interrupted = (await listAllJobs()).filter((job) =>
      ["running", "repairing", "previewing", "validating"].includes(job.status),
    );
    for (const job of interrupted) {
      await appendEvent(job.id, {
        type: "log",
        stream: "system",
        message: "Service restarted while this task was running; returned it to the local queue.",
        at: new Date().toISOString(),
      });
      await updateJob(
        job.id,
        {
          status: "queued",
          runMode: job.runMode ?? (job.status === "repairing" ? "repair" : "generation"),
          queuedAt: new Date().toISOString(),
          queuePosition: undefined,
          startedAt: undefined,
          deadlineAt: undefined,
          error: undefined,
        },
        "queued",
      );
    }
    await pumpQueueLocked();
  });
  const state = queueState();
  return { maxConcurrentJobs: MAX_CONCURRENT_JOBS, activeJobs: state.active.size };
}

async function enqueueJob(jobId: string, mode: AgentRunMode) {
  await ensureJobQueueStarted();
  await withQueueLock(async () => {
    if (await isTerminalJob(jobId)) return;
    await updateJob(
      jobId,
      {
        status: "queued",
        runMode: mode,
        queuedAt: new Date().toISOString(),
        queuePosition: undefined,
        startedAt: undefined,
        deadlineAt: undefined,
        error: undefined,
      },
      "queued",
    );
    await pumpQueueLocked();
  });
}

async function pumpQueueLocked() {
  const state = queueState();
  const queued = (await listAllJobs())
    .filter((job) => job.status === "queued" && !state.active.has(job.id))
    .sort(
      (a, b) =>
        new Date(a.queuedAt ?? a.createdAt).getTime() - new Date(b.queuedAt ?? b.createdAt).getTime(),
    );
  while (state.active.size < MAX_CONCURRENT_JOBS && queued.length) {
    const job = queued.shift();
    if (!job) break;
    const mode = job.runMode ?? "generation";
    const startedAt = new Date().toISOString();
    const timeout = setTimeout(() => void timeoutActiveJob(job.id), JOB_TIMEOUT_MS);
    state.active.set(job.id, { mode, timeout });
    await updateJob(
      job.id,
      {
        status: mode === "repair" ? "repairing" : "running",
        queuePosition: undefined,
        startedAt,
        deadlineAt: new Date(Date.now() + JOB_TIMEOUT_MS).toISOString(),
      },
      mode === "repair" ? "repairing" : "running",
    );
    void executeActiveJob(job.id, mode);
  }
  await refreshQueuePositionsLocked();
}

async function refreshQueuePositionsLocked() {
  const state = queueState();
  const waiting = (await listAllJobs())
    .filter((job) => job.status === "queued" && !state.active.has(job.id))
    .sort(
      (a, b) =>
        new Date(a.queuedAt ?? a.createdAt).getTime() - new Date(b.queuedAt ?? b.createdAt).getTime(),
    );
  await Promise.all(
    waiting.map(async (job, index) => {
      const position = index + 1;
      if (job.queuePosition !== position) await updateJob(job.id, { queuePosition: position }, "queued");
    }),
  );
}

async function releaseActiveJob(jobId: string) {
  await withQueueLock(async () => {
    const state = queueState();
    const active = state.active.get(jobId);
    if (!active) return;
    clearTimeout(active.timeout);
    state.active.delete(jobId);
    await pumpQueueLocked();
  });
}

function setActiveChild(jobId: string, child: ChildProcess) {
  const active = queueState().active.get(jobId);
  if (active) active.child = child;
}

function stopChild(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const force = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 3000);
  force.unref();
}

async function enterActiveStage(jobId: string, status: JobManifest["status"]) {
  return withQueueLock(async () => {
    const active = queueState().active.get(jobId);
    if (!active || active.stopReason || (await isTerminalJob(jobId))) return false;
    await updateJob(jobId, { status }, status);
    return true;
  });
}

async function isTerminalJob(jobId: string) {
  const status = (await readManifest(jobId)).status;
  return status === "complete" || status === "failed" || status === "cancelled";
}

async function timeoutActiveJob(jobId: string) {
  await withQueueLock(async () => {
    const active = queueState().active.get(jobId);
    if (!active || (await isTerminalJob(jobId))) return;
    active.stopReason = "timeout";
    stopChild(active.child);
    await failJob(jobId, `Task exceeded the ${JOB_TIMEOUT_MINUTES}-minute time limit and was stopped.`);
  });
}

export async function cancelJob(jobId: string, userId: string) {
  await ensureJobQueueStarted();
  return withQueueLock(async () => {
    const manifest = await readManifest(jobId);
    if (manifest.userId !== userId) return null;
    if (manifest.status === "queued") {
      await appendEvent(jobId, {
        type: "log",
        stream: "system",
        message: "Queued task cancelled before generation started.",
        at: new Date().toISOString(),
      });
      await removeUnretainedQaReport(jobId, manifest);
      const cancelled = await updateJob(jobId, { status: "cancelled", queuePosition: undefined }, "cancelled");
      await pumpQueueLocked();
      return cancelled;
    }
    if (["running", "repairing", "previewing", "validating"].includes(manifest.status)) {
      const active = queueState().active.get(jobId);
      if (active) {
        active.stopReason = "cancelled";
        stopChild(active.child);
      }
      await appendEvent(jobId, {
        type: "log",
        stream: "system",
        message: "Running task interrupted by the user.",
        at: new Date().toISOString(),
      });
      await removeUnretainedQaReport(jobId, manifest);
      return updateJob(jobId, { status: "cancelled", queuePosition: undefined }, "cancelled");
    }
    throw new Error("Only queued or running jobs can be cancelled");
  });
}

async function failJob(jobId: string, message: string) {
  if (await isTerminalJob(jobId)) return;
  await removeUnretainedQaReport(jobId);
  const previewSlides = await collectPreviewSlides(jobId).catch(() => []);
  await appendEvent(jobId, { type: "error", message, at: new Date().toISOString() });
  await updateJob(jobId, { status: "failed", error: message, previewSlides }, "failed");
}

async function failActiveJob(jobId: string, message: string) {
  await withQueueLock(() => failJob(jobId, message));
}

async function removeUnretainedQaReport(jobId: string, manifest?: JobManifest) {
  const job = manifest ?? (await readManifest(jobId));
  if (job.retainQaReport === false) {
    await fs.rm(path.join(jobDir(jobId), "qa", "qa_report.md"), { force: true });
  }
}

async function buildAgentPrompt(jobId: string, mode: AgentRunMode) {
  const dir = jobDir(jobId);
  const manifest = await readManifest(jobId);
  const templateDir = manifest.templateDir ?? path.join(TEMPLATES_DIR, manifest.templateId);
  const pipelineSkillPath = path.join(PPT_AGENT_SKILL_DIR, "SKILL.md");
  const python = pythonCommand();
  const retainQaReport = manifest.retainQaReport !== false;
  const qaInstruction = retainQaReport
    ? "Write a concise internal visual review to qa/qa_report.md with findings, fixes and verification."
    : "Do not create or retain qa/qa_report.md for this user job. The application will run visual/layout validation and keep failure feedback only when a correction is needed.";
  const modeContract =
    mode === "repair"
      ? `This is an automatic validation repair pass of an already generated deck.
- Read qa/validation-feedback.md first. It contains the blocking validator reasons from the previous output.
- Review existing preview/slide-* pages when present to see the failed layout before making changes.
- Inspect the existing generation source and output/final.pptx, make the smallest correction that resolves those reasons, and regenerate output/final.pptx.
- Preserve source facts, template choice, slide count, narrative, and unaffected design decisions. Do not re-plan or re-extract source files.
- ${qaInstruction}`
      : mode === "revision"
      ? `This is a targeted slide revision of an already completed deck.
- Read planning/revision-request.md for the requested slide number and feedback.
- Preserve all unaffected slides, the selected template, brand assets, and overall visual grammar.
- Update only the requested slide unless a tiny consistency adjustment is necessary.
- Update output/final.pptx and affected planning metadata. The app will regenerate baseline slide previews from the corrected PPTX.
- ${qaInstruction}`
      : `This is the full deck generation pass.
- Create the concise structured plan once, then generate the complete editable deck without a separate visual approval checkpoint.
- Treat completed planning files as the locked brief. Do not redo source extraction, story planning, or broad template exploration unless a required input is actually missing or invalid.
- Prefer a single deterministic generation script and a focused fix pass. Do not spend turns probing optional preview tools; skip unavailable optional rendering cleanly and continue to final validation.`;
  const outputContract = `You must keep all artifacts inside the job workspace and satisfy this output contract:
- planning/outline.md
- planning/design_system.json
- planning/slide_plan.json, shaped as { "slides": [...] } or a slide array. Every slide object must include title, claim, layout, and route. Use route "pptxgenjs" for native editable pptxgenjs slides unless another allowed route is explicitly required.
- output/final.pptx
- individual preview pages are generated by the app from output/final.pptx; create preview/contact-sheet.png only if a high-fidelity renderer is already available
${retainQaReport ? "- qa/qa_report.md" : "- No qa/qa_report.md output is required or retained for this user job."}`;
  return `You are running as the local coding-agent backend for the ppt agent web app.

Use the project-bundled ppt-agent pipeline instructions at ${pipelineSkillPath} as the contract for this job. If your runtime cannot load Codex skills directly, still read and follow that file's visible rules: produce editable PPTX through the service-oriented ppt-agent-pipeline workflow.

Job workspace: ${dir}
Request JSON: ${path.join(dir, "request.json")}
Uploads directory: ${path.join(dir, "uploads")}
Template directory: ${templateDir}
Pipeline directory: ${PPT_AGENT_SKILL_DIR}

Generation phase:
${modeContract}

Template usage contract:
- Read ${path.join(templateDir, "SKILL.md")} first when it exists.
- Read request.json.template for exact template metadata and paths.
- If references/design_spec.md exists, use it as the primary reusable style and layout specification.
- If references/spec_lock.md exists, treat it as the strongest color, typography, spacing, icon, and image contract.
- If references/sample_svgs/ exists, study the reusable page rhythm and layout patterns only; do not copy the original deck text or business content.
- If references/brand/brand-spec.md exists, treat it as the real asset protocol: use listed logo, product images and UI screenshots before generic decoration.
- When uploads contain SVG, PNG, JPG or WEBP assets, use them as supplied visual evidence (for example a logo, product image or UI capture) when the request identifies their purpose; do not invent brand usage for unlabeled images.
- If template.pptx exists, use it as a PowerPoint master/style reference when useful, but still produce a new editable output/final.pptx for the user's request.
- This app intentionally removed screenshot-only HTML visual references. Selected templates are PPT-generation templates.

${outputContract}

JSON artifact rules:
- Write strict UTF-8 JSON only. Do not use Markdown fences, comments, trailing commas, or unescaped quotes inside strings.
- Escape all double quotes that appear in Chinese or English prose, for example 神奇的\\"魔法屋\\".
- Before your final response, run ${python} -m json.tool on planning/design_system.json and planning/slide_plan.json, then fix any JSON error.

Quality rules for full generation and revision:
- PptxGenJS positions and dimensions are inches, not pixels. If using LAYOUT_16x9, keep editable slide content inside its 10 x 5.625 inch bounds; never use raw 1280 x 720 coordinates on that layout.
- PptxGenJS fontFace must be a single real PowerPoint font family name, not a CSS-style comma-separated font stack; choose a font appropriate for the deck language.
- The bundled validator rejects text objects fully outside the slide canvas. Treat that as a blocking generation bug and fix the generation source before finishing.
- ${qaInstruction}
- The app generates baseline per-slide SVG previews directly from final.pptx before validation. If a native Office renderer is already available, you may additionally generate a higher-fidelity contact sheet; do not spend time probing optional renderers.
- Visible text-to-text collisions, including a title covered by a claim bar or content block, are blocking failures. Keep vertical regions distinct and inspect your geometry before finishing.
- Do not invent metrics, quotations, logos, or product imagery to fill empty space.

Use the templateId and templateDir recorded in request.json. Prefer editable native PPT objects and the service-oriented route from $ppt-agent-pipeline. Do not use screenshot-only PPT slides as the main output. Log concise progress in your final response.`;
}

async function executeActiveJob(jobId: string, mode: AgentRunMode) {
  try {
    const agent = selectAgentCli();
    if (!agent) {
      await failActiveJob(jobId, "No supported coding-agent CLI found. Install or log in to Claude Code, Codex, Gemini, Cursor Agent, Trae Agent, or OpenCode.");
      return;
    }
    await appendEvent(jobId, {
      type: "log",
      stream: "system",
      message:
        mode === "repair"
          ? `Starting automated validation repair with ${agent.label}: ${agent.command}`
          : `Starting ${agent.label}: ${agent.command}`,
      at: new Date().toISOString(),
    });

    if (await isTerminalJob(jobId)) return;
    const child = spawnAgentCli(await buildAgentPrompt(jobId, mode), jobDir(jobId));
    setActiveChild(jobId, child);
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
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (await isTerminalJob(jobId)) return;
    if (code !== 0) {
      await failActiveJob(jobId, `Agent CLI exited with code ${code ?? "unknown"}`);
      return;
    }
    await ensureSlidePreviews(jobId);
    if (await isTerminalJob(jobId)) return;
    await validateAndComplete(jobId);
  } catch (error) {
    await failActiveJob(jobId, error instanceof Error ? `Could not run Agent CLI: ${error.message}` : String(error));
  } finally {
    await removeUnretainedQaReport(jobId);
    await releaseActiveJob(jobId);
  }
}

export async function reviseJobSlide(jobId: string, user: AppUser, slideNumber: number, instruction: string) {
  const manifest = await readManifestForUser(jobId, user.id);
  if (!manifest || manifest.status !== "complete") throw new Error("Only completed jobs can be revised");
  if (!Number.isInteger(slideNumber) || slideNumber < 1) throw new Error("Valid slide number is required");
  const feedback = instruction.trim();
  if (!feedback) throw new Error("Revision instruction is required");
  const now = new Date().toISOString();
  await fs.writeFile(
    path.join(jobDir(jobId), "planning", "revision-request.md"),
    `# Targeted revision\n\n- Slide: ${slideNumber}\n- Requested at: ${now}\n\n${feedback}\n`,
    "utf8",
  );
  await updateJob(
    jobId,
    {
      status: "queued",
      error: undefined,
      repairAttempts: 0,
      lastValidationError: undefined,
      retainQaReport: user.role === "admin",
      runMode: "revision",
      queuedAt: now,
      messages: [...manifest.messages, { role: "user", text: `修改第 ${slideNumber} 页：${feedback}`, at: now }],
    },
    "queued",
  );
  await removeUnretainedQaReport(jobId, { ...manifest, retainQaReport: user.role === "admin" });
  await enqueueJob(jobId, "revision");
}

async function validateAndComplete(jobId: string) {
  if (!(await enterActiveStage(jobId, "validating"))) return;
  const dir = jobDir(jobId);
  const job = await readManifest(jobId);
  await removeUnretainedQaReport(jobId, job);
  await normalizeSlidePlanForValidation(jobId);
  const validatorArgs = [VALIDATE_JOB_SCRIPT, dir, "--require-final"];
  if (job.retainQaReport !== false) validatorArgs.push("--require-qa");
  const validator = spawn(pythonCommand(), validatorArgs, {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  setActiveChild(jobId, validator);

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
  await new Promise<void>((resolve, reject) => {
    validator.once("error", reject);
    validator.once("close", (code) => {
      void (async () => {
        if (await isTerminalJob(jobId)) return;
        if (code !== 0) {
          const validatorOutput = errorOutput || output || String(code);
          const failure = formatValidationFailure(validatorOutput);
          const manifest = await readManifest(jobId);
          const repairAttempts = manifest.repairAttempts ?? 0;
          if (repairAttempts < MAX_VALIDATION_REPAIR_ATTEMPTS) {
            const nextAttempt = repairAttempts + 1;
            await fs.writeFile(
              path.join(dir, "qa", "validation-feedback.md"),
              `# Validation feedback for automatic repair

- Attempt: ${nextAttempt} of ${MAX_VALIDATION_REPAIR_ATTEMPTS}
- Generated at: ${new Date().toISOString()}

## Blocking reason

${failure}

## Validator output

\`\`\`text
${validatorOutput.trim()}
\`\`\`
`,
              "utf8",
            );
            await appendEvent(jobId, {
              type: "log",
              stream: "system",
              message: `Validation failed; starting automatic repair pass ${nextAttempt}/${MAX_VALIDATION_REPAIR_ATTEMPTS}.`,
              at: new Date().toISOString(),
            });
            await updateJob(jobId, {
              repairAttempts: nextAttempt,
              lastValidationError: failure,
            });
            await enqueueJob(jobId, "repair");
            return;
          }
          await failActiveJob(jobId, `${failure} Automatic repair limit reached (${MAX_VALIDATION_REPAIR_ATTEMPTS}).`);
          return;
        }
        const [artifacts, previewSlides] = await Promise.all([collectArtifacts(jobId), collectPreviewSlides(jobId)]);
        await withQueueLock(async () => {
          const active = queueState().active.get(jobId);
          if (!active || active.stopReason || (await isTerminalJob(jobId))) return;
          const manifest = await updateJob(jobId, { status: "complete", artifacts, previewSlides }, "complete");
          await appendEvent(jobId, { type: "done", at: new Date().toISOString() });
          await writeManifest(manifest);
        });
      })()
        .then(resolve)
        .catch(reject);
    });
  });
}

async function ensureSlidePreviews(jobId: string) {
  if (await isTerminalJob(jobId)) return;
  const slideCount = await countFinalPptxSlides(jobId);
  if (!slideCount) return;
  const previewDir = path.join(jobDir(jobId), "preview");
  const existing = await fs.readdir(previewDir, { withFileTypes: true }).catch(() => []);
  const individualPreviews = existing.filter(
    (entry) => entry.isFile() && /^slide[-_].+\.(png|jpe?g|svg|webp)$/i.test(entry.name),
  );

  if (!(await enterActiveStage(jobId, "previewing"))) return;
  const generatedDir = path.join(previewDir, ".generated-svg");
  await fs.rm(generatedDir, { recursive: true, force: true });
  await ensureDir(generatedDir);

  const output = await new Promise<{ code: number | null; message: string }>((resolve) => {
    const child = spawn(
      pythonCommand(),
      [
        PPTX_TO_SVG_SCRIPT,
        path.join(jobDir(jobId), "output", "final.pptx"),
        "-o",
        generatedDir,
        "--inheritance-mode",
        "flat",
        "--embed-images",
      ],
      {
        cwd: jobDir(jobId),
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    setActiveChild(jobId, child);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => resolve({ code: null, message: error.message }));
    child.on("close", (code) => resolve({ code, message: stderr }));
  });
  if (output.code !== 0) {
    await appendEvent(jobId, {
      type: "log",
      stream: "system",
      message: `Could not prepare per-slide previews: ${output.message || `renderer exited with ${output.code ?? "unknown"}`}`,
      at: new Date().toISOString(),
    });
    await fs.rm(generatedDir, { recursive: true, force: true });
    return;
  }

  const generatedSlides = (await fs.readdir(path.join(generatedDir, "svg"), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /^slide_\d+\.svg$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  await Promise.all(
    [
      ...individualPreviews.map((entry) => fs.rm(path.join(previewDir, entry.name), { force: true })),
      fs.rm(path.join(previewDir, "contact-sheet.png"), { force: true }),
    ],
  );
  await Promise.all(
    generatedSlides.map((entry, index) =>
      fs.copyFile(
        path.join(generatedDir, "svg", entry.name),
        path.join(previewDir, `slide-${String(index + 1).padStart(3, "0")}.svg`),
      ),
    ),
  );
  await fs.rm(generatedDir, { recursive: true, force: true });
  await appendEvent(jobId, {
    type: "log",
    stream: "system",
    message: `Prepared ${generatedSlides.length} per-slide previews from final PPTX.`,
    at: new Date().toISOString(),
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

async function collectPreviewSlides(jobId: string) {
  const previewDir = path.join(jobDir(jobId), "preview");
  const entries = await fs.readdir(previewDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && /^slide[-_].+\.(png|jpe?g|svg|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => `/api/jobs/${jobId}/artifacts/${name}`);
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
    templateDir: raw.templateDir,
    agentId: raw.agentId,
    agentCommand: raw.agentCommand,
    prompt,
    uploads: raw.uploads ?? [],
    previewSlides: raw.previewSlides ?? [],
    repairAttempts: raw.repairAttempts ?? 0,
    lastValidationError: raw.lastValidationError,
    retainQaReport: raw.retainQaReport ?? true,
    runMode: raw.runMode,
    queuedAt: raw.queuedAt,
    queuePosition: raw.queuePosition,
    startedAt: raw.startedAt,
    deadlineAt: raw.deadlineAt,
    error: raw.error,
    artifacts: raw.artifacts ?? {},
  };
}

function requestTemplateContext(template: TemplateMeta | null, templateDir: string) {
  if (!template) return null;
  return {
    id: template.id,
    kind: template.kind,
    name: template.localized?.name ?? { zh: template.name, en: template.name },
    purpose: template.localized?.purpose ?? { zh: template.purpose, en: template.purpose },
    style: template.localized?.style ?? { zh: template.style, en: template.style },
    tags: template.localized?.tags ?? { zh: template.tags, en: template.tags },
    templateDir,
    templatePptxPath: template.templatePath ? path.join(templateDir, path.basename(template.templatePath)) : undefined,
    designSpecPath: template.designSpecPath ? snapshotReferencePath(template.designSpecPath, templateDir) : undefined,
    specLockPath: template.specLockPath ? snapshotReferencePath(template.specLockPath, templateDir) : undefined,
    sampleSvgDir: template.sampleSvgDir ? snapshotReferencePath(template.sampleSvgDir, templateDir) : undefined,
    brandSpecPath: template.brandSpecPath ? snapshotReferencePath(template.brandSpecPath, templateDir) : undefined,
    brandAssetDir: template.brandAssetDir ? snapshotReferencePath(template.brandAssetDir, templateDir) : undefined,
    sourceExample: template.sourceExample,
    templateStrength: template.templateStrength,
  };
}

function snapshotReferencePath(sourcePath: string, snapshotDir: string) {
  const sourceTemplateDir = path.dirname(path.dirname(sourcePath));
  const relative = path.relative(sourceTemplateDir, sourcePath);
  return path.join(snapshotDir, relative);
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
    if (/Starting automated validation repair with Claude Code/i.test(message)) return "Automatic validation repair started: Claude Code.";
    if (/Starting automated validation repair with Codex CLI/i.test(message)) return "Automatic validation repair started: Codex CLI.";
    if (/Starting automated validation repair with Gemini CLI/i.test(message)) return "Automatic validation repair started: Gemini CLI.";
    if (/Starting automated validation repair with Cursor Agent/i.test(message)) return "Automatic validation repair started: Cursor Agent.";
    if (/Starting automated validation repair with Trae Agent/i.test(message)) return "Automatic validation repair started: Trae Agent.";
    if (/Starting automated validation repair with OpenCode/i.test(message)) return "Automatic validation repair started: OpenCode.";
    if (/Starting Claude Code/i.test(message)) return "Generation engine started: Claude Code.";
    if (/Starting Codex CLI/i.test(message)) return "Generation engine started: Codex CLI.";
    if (/Starting Gemini CLI/i.test(message)) return "Generation engine started: Gemini CLI.";
    if (/Starting Cursor Agent/i.test(message)) return "Generation engine started: Cursor Agent.";
    if (/Starting Trae Agent/i.test(message)) return "Generation engine started: Trae Agent.";
    if (/Starting OpenCode/i.test(message)) return "Generation engine started: OpenCode.";
    if (/Prepared \d+ per-slide previews/i.test(message)) return message;
    if (/Could not prepare per-slide previews/i.test(message)) return sanitizeMessage(message);
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
      return `Generation engine finished${minutes}; preparing the next step.`;
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
    .replace(/[^\s"',()]+\.(pdf|docx|pptx|xlsx|csv|md|txt|svg|png|jpe?g|webp)/gi, "[file]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}
