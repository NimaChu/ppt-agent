"use client";

import {
  AlertCircle,
  KeyRound,
  CheckCircle2,
  Clipboard,
  Copy,
  FileText,
  History,
  Languages,
  Loader2,
  LogOut,
  Plus,
  Paperclip,
  Play,
  Presentation,
  Settings2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AgentCliStatus, AppUser, JobManifest, JobStatus, Preset, TemplateMeta } from "@/lib/types";

type Language = "zh" | "en";

type LogLine = {
  at: string;
  stream: string;
  message: string;
};

type Health = {
  ok: boolean;
  selectedAgent: AgentCliStatus | null;
  agents: AgentCliStatus[];
  validatorExists: boolean;
  templateCount: number;
};

const busyStatuses: JobStatus[] = ["uploading", "queued", "running", "previewing", "validating"];

const copy = {
  zh: {
    history: "历史记录",
    newChat: "新对话",
    accountAdmin: "账号管理",
    changePassword: "修改密码",
    diagnostics: "诊断信息",
    logout: "退出",
    promptTitle: "想做什么 PPT？",
    promptIntro: "直接描述需求，上传材料，选择一个 PPT 生成模板。我会把工作拆成结构规划、PPT 生成、预览校验和下载交付几步展示给你。",
    placeholder: "告诉我你想生成什么 PPT，也可以上传资料...",
    defaultPrompt: "基于上传材料生成一份面向内部同事的培训 PPT，要求结构清晰、可编辑、包含练习页和总结页。",
    upload: "上传文档",
    files: "个文件",
    generate: "生成 PPT",
    templateFallback: "默认模板",
    noHistory: "还没有历史记录。",
    historyHint: "生成过的 PPT 会出现在这里。",
    current: "当前",
    visualRef: "视觉参考",
    templatePanel: "模板与预览",
    templatePanelHint: "选择一个 PPT 生成模板，右侧预览展示模板的版式和视觉节奏。",
    templatePptx: "含 PPT 模板",
    templateDerived: "成品沉淀",
    templateImported: "导入模板",
    diagnosticsTitle: "诊断信息",
    diagnosticsHint: "用于排查任务状态，已隐藏文档内容和本地路径。",
    copyAll: "复制全部",
    copied: "已复制",
    noLogs: "还没有诊断输出。",
    engine: "执行器",
    validator: "校验器",
    job: "任务",
    stage: "阶段",
    lines: "行",
    passwordTitle: "修改密码",
    currentPassword: "当前密码",
    nextPassword: "新密码",
    savePassword: "保存密码",
    passwordSaved: "密码已更新",
    passwordFailed: "密码修改失败",
    close: "关闭",
    preset: { quick: "快速", standard: "标准", polished: "精修" },
    status: {
      idle: { title: "准备生成", text: "输入需求、选择模板，上传材料后开始。" },
      uploading: { title: "正在上传", text: "正在保存材料。" },
      queued: { title: "任务已创建", text: "需求已接收，正在准备生成。" },
      running: { title: "正在生成 PPT", text: "系统正在规划结构、整理素材并生成可编辑 PPT。" },
      previewing: { title: "正在生成预览", text: "正在整理页面预览和 contact sheet。" },
      validating: { title: "正在校验", text: "正在确认输出文件和 QA 报告是否齐全。" },
      complete: { title: "生成完成", text: "结果已准备好，可以下载。" },
      failed: { title: "生成失败", text: "任务没有完成，已保留必要排障信息，请联系管理员处理。" },
    },
    workflow: [
      { key: "queued", title: "已接收需求", description: "保存上传文件、模板和生成参数。" },
      { key: "running", title: "正在规划和生成", description: "生成大纲、设计系统和可编辑 PPT。" },
      { key: "validating", title: "正在校验结果", description: "检查 PPTX、预览文件和 QA 报告。" },
      { key: "complete", title: "生成完成", description: "可以下载 PPT、预览图和 QA 记录。" },
    ],
    artifacts: {
      "final.pptx": "下载 PPTX",
      "contact-sheet.png": "查看 Contact Sheet",
      "qa_report.md": "查看 QA 报告",
    },
  },
  en: {
    history: "History",
    newChat: "New chat",
    accountAdmin: "Accounts",
    changePassword: "Password",
    diagnostics: "Diagnostics",
    logout: "Sign out",
    promptTitle: "What deck do you need?",
    promptIntro: "Describe the deck, upload source files, and pick a visual template. I will show planning, generation, validation, and delivery in plain steps.",
    placeholder: "Tell me what PPT you want to generate, or upload source files...",
    defaultPrompt: "Create an internal training deck from the uploaded materials. Make it clear, editable, and include practice and summary slides.",
    upload: "Upload files",
    files: "files",
    generate: "Generate PPT",
    templateFallback: "Default template",
    noHistory: "No history yet.",
    historyHint: "Generated PPT tasks will appear here.",
    current: "Current",
    visualRef: "Visual reference",
    templatePanel: "Templates",
    templatePanelHint: "Choose a PPT generation template. The preview shows layout and visual rhythm.",
    templatePptx: "PPT template",
    templateDerived: "Derived",
    templateImported: "Imported",
    diagnosticsTitle: "Diagnostics",
    diagnosticsHint: "For troubleshooting. Document content and local paths are hidden.",
    copyAll: "Copy all",
    copied: "Copied",
    noLogs: "No diagnostic output yet.",
    engine: "Engine",
    validator: "Validator",
    job: "Job",
    stage: "Stage",
    lines: "lines",
    passwordTitle: "Change password",
    currentPassword: "Current password",
    nextPassword: "New password",
    savePassword: "Save password",
    passwordSaved: "Password updated",
    passwordFailed: "Could not change password",
    close: "Close",
    preset: { quick: "Quick", standard: "Standard", polished: "Polished" },
    status: {
      idle: { title: "Ready", text: "Enter requirements, choose a template, and upload source files." },
      uploading: { title: "Uploading", text: "Saving files to the local task workspace." },
      queued: { title: "Task created", text: "The request is ready for generation." },
      running: { title: "Generating PPT", text: "Planning the structure, arranging content, and building an editable deck." },
      previewing: { title: "Preparing preview", text: "Preparing preview pages and a contact sheet." },
      validating: { title: "Validating", text: "Checking output files and the QA report." },
      complete: { title: "Done", text: "Your results are ready to download." },
      failed: { title: "Failed", text: "The task did not finish. Troubleshooting details are kept for an admin." },
    },
    workflow: [
      { key: "queued", title: "Request received", description: "Saved uploaded files, template, and generation settings." },
      { key: "running", title: "Planning and generating", description: "Creating the outline, design system, and editable PPT." },
      { key: "validating", title: "Validating outputs", description: "Checking PPTX, preview assets, and QA report." },
      { key: "complete", title: "Complete", description: "Download the PPT, previews, and QA notes." },
    ],
    artifacts: {
      "final.pptx": "Download PPTX",
      "contact-sheet.png": "View Contact Sheet",
      "qa_report.md": "View QA Report",
    },
  },
} as const;

export function PptAgentApp({ user }: { user: AppUser }) {
  const [language, setLanguage] = useState<Language>("zh");
  const t = copy[language];
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [history, setHistory] = useState<JobManifest[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [preset, setPreset] = useState<Preset>("standard");
  const [prompt, setPrompt] = useState<string>(t.defaultPrompt);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [stage, setStage] = useState("idle");
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<JobManifest | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("ppt-agent-language");
    if (saved === "zh" || saved === "en") setLanguage(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ppt-agent-language", language);
  }, [language]);

  useEffect(() => {
    setPrompt((current) => {
      const other = language === "zh" ? copy.en.defaultPrompt : copy.zh.defaultPrompt;
      return current === other ? copy[language].defaultPrompt : current;
    });
  }, [language]);

  useEffect(() => {
    void fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => {
        setTemplates(data.templates ?? []);
        setTemplateId((current) =>
          data.templates?.some((template: TemplateMeta) => template.id === current)
            ? current
            : (data.templates?.[0]?.id ?? current),
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Templates failed to load"));
    void fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
    void loadHistory();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs, debugOpen]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? templates[0],
    [templates, templateId],
  );

  const debugText = useMemo(
    () => logs.map((line) => `[${line.at}] [${line.stream}] ${line.message}`).join("\n"),
    [logs],
  );

  async function loadHistory() {
    const res = await fetch("/api/jobs");
    if (!res.ok) return;
    const data = await res.json();
    setHistory(data.jobs ?? []);
  }

  async function refreshJob(id = jobId) {
    if (!id) return;
    const res = await fetch(`/api/jobs/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setJob(data.job);
    setStatus(data.job.status);
    setStage(data.job.stage);
    void loadHistory();
  }

  function connectEvents(id: string) {
    const source = new EventSource(`/api/jobs/${id}/events`);
    source.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      if (data.status) setStatus(data.status);
      if (data.stage) setStage(data.stage);
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      const next = { at: data.at, stream: data.stream, message: data.message };
      setLogs((prev) => {
        if (prev.some((line) => line.at === next.at && line.stream === next.stream && line.message === next.message)) return prev;
        return [...prev, next].slice(-120);
      });
    });
    source.addEventListener("error", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.message) setError(data.message);
      } catch {
        setError(
          user.role === "admin"
            ? language === "zh"
              ? "任务流中断，请展开诊断信息查看。"
              : "The task stream stopped. Open diagnostics for details."
            : language === "zh"
              ? "任务流中断，请联系管理员查看诊断信息。"
              : "The task stream stopped. Ask an admin to check diagnostics.",
        );
      }
      void refreshJob(id);
      source.close();
    });
    source.addEventListener("done", () => {
      void refreshJob(id);
      source.close();
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLogs([]);
    setJob(null);
    setJobId("");
    setStatus("uploading");
    setStage("uploading");

    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("templateId", selectedTemplate?.id ?? templateId);
    formData.append("preset", preset);
    for (const file of files) formData.append("files", file);

    const res = await fetch("/api/jobs", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      setStatus("failed");
      setError(data.error ?? (language === "zh" ? "创建任务失败" : "Could not create task"));
      return;
    }

    setJobId(data.jobId);
    setStatus("queued");
    setStage("queued");
    connectEvents(data.jobId);
    void refreshJob(data.jobId);
  }

  function selectHistoryItem(item: JobManifest) {
    setHistoryOpen(false);
    setJob(item);
    setJobId(item.id);
    setPrompt(item.prompt);
    setTemplateId(item.templateId);
    setPreset(item.preset);
    setStatus(item.status);
    setStage(item.stage);
    setFiles([]);
    setLogs([]);
    setError(item.error ?? "");
    if (busyStatuses.includes(item.status)) connectEvents(item.id);
  }

  async function copyDebug() {
    await navigator.clipboard.writeText(debugText || "No diagnostic output yet.");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  function newChat() {
    setPrompt(copy[language].defaultPrompt);
    setFiles([]);
    setStatus("idle");
    setStage("idle");
    setJobId("");
    setJob(null);
    setLogs([]);
    setError("");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const canSubmit = prompt.trim().length > 0 && !busyStatuses.includes(status);
  const hasRun = Boolean(jobId) || status !== "idle";

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-ink">
      <header className="sticky top-0 z-20 border-b border-rail bg-white/86 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-bold">
            <Presentation size={18} className="text-cobalt" />
            <span>ppt agent</span>
            <span className="hidden rounded-full bg-mist px-2 py-1 text-xs font-semibold text-quiet sm:inline">
              {user.name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={newChat} className="header-button">
              <Plus size={16} />
              {t.newChat}
            </button>
            <button type="button" onClick={() => setHistoryOpen(true)} className="header-button">
              <History size={16} />
              {t.history}
            </button>
            {user.role === "admin" && (
              <a href="/admin" className="header-button">
                <UserRound size={16} />
                {t.accountAdmin}
              </a>
            )}
            <button type="button" onClick={() => setPasswordOpen(true)} className="header-button">
              <KeyRound size={16} />
              {t.changePassword}
            </button>
            <button type="button" onClick={() => setLanguage(language === "zh" ? "en" : "zh")} className="header-button">
              <Languages size={16} />
              {language === "zh" ? "EN" : "CN"}
            </button>
            {user.role === "admin" && (
              <button type="button" onClick={() => setDebugOpen(true)} className="header-button">
                <Settings2 size={16} />
                {t.diagnostics}
              </button>
            )}
            <button type="button" onClick={logout} className="header-button">
              <LogOut size={16} />
              {t.logout}
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-65px)] max-w-7xl gap-4 px-4 pb-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col">
          <div className="flex-1 space-y-5 py-6">
            <AssistantIntro language={language} />

            {hasRun && (
              <>
                <UserBubble prompt={prompt} files={files} selectedTemplate={selectedTemplate} preset={preset} language={language} />
                <WorkflowBubble
                  status={status}
                  stage={stage}
                  error={error}
                  jobId={jobId}
                  job={job}
                  language={language}
                  showQaReport={user.role === "admin"}
                />
              </>
            )}
          </div>

          <form onSubmit={submit} className="sticky bottom-0 border-t border-rail bg-[#f7f8fb]/95 py-4 backdrop-blur">
            <div className="rounded-2xl border border-rail bg-white p-3 shadow-panel">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="max-h-52 min-h-28 w-full resize-y rounded-xl border-0 bg-mist p-4 text-[15px] leading-7 outline-none"
                placeholder={t.placeholder}
              />

              <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <PresetSelector preset={preset} onChange={setPreset} language={language} />
                  <label className="flex cursor-pointer items-center gap-2 rounded-full border border-rail bg-white px-3 py-2 text-sm font-semibold text-quiet transition hover:border-cobalt hover:text-cobalt">
                    <Paperclip size={16} />
                    {t.upload}
                    <input
                      type="file"
                      multiple
                      accept=".md,.txt,.docx,.pdf,.pptx,.xlsx,.csv"
                      onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                      className="hidden"
                    />
                  </label>
                  {files.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-mist px-3 py-2 text-sm text-quiet">
                      <Upload size={15} />
                      {files.length} {t.files}
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:bg-cobalt disabled:cursor-not-allowed disabled:bg-slate-400 lg:w-auto"
                >
                  {busyStatuses.includes(status) ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                  {t.generate}
                </button>
              </div>

              {files.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {files.map((file) => (
                    <span key={`${file.name}-${file.size}`} className="flex max-w-full items-center gap-2 rounded-full bg-mist px-3 py-1.5 text-xs text-quiet">
                      <FileText size={14} />
                      <span className="max-w-48 truncate">{file.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </form>
        </div>

        <TemplateSidebar
          templates={templates}
          selectedTemplate={selectedTemplate}
          selectedTemplateId={templateId}
          onChange={setTemplateId}
          language={language}
        />
      </section>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        jobs={history}
        currentJobId={jobId}
        onSelect={selectHistoryItem}
        language={language}
      />
      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} language={language} />
      {user.role === "admin" && (
        <DebugDrawer
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          logs={logs}
          copied={copied}
          onCopy={copyDebug}
          health={health}
          jobId={jobId}
          stage={stage}
          language={language}
          logEndRef={logEndRef}
        />
      )}
    </main>
  );
}

function AssistantIntro({ language }: { language: Language }) {
  const t = copy[language];
  return (
    <div className="flex gap-3">
      <Avatar tone="assistant" />
      <div className="max-w-3xl rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-rail">
        <h1 className="text-xl font-bold tracking-tight">{t.promptTitle}</h1>
        <p className="mt-2 text-sm leading-6 text-quiet">{t.promptIntro}</p>
      </div>
    </div>
  );
}

function UserBubble({
  prompt,
  files,
  selectedTemplate,
  preset,
  language,
}: {
  prompt: string;
  files: File[];
  selectedTemplate?: TemplateMeta;
  preset: Preset;
  language: Language;
}) {
  const t = copy[language];
  const templateDisplay = selectedTemplate ? getTemplateDisplay(selectedTemplate, language) : null;
  return (
    <div className="flex justify-end">
      <div className="max-w-3xl rounded-2xl bg-ink px-5 py-4 text-white shadow-sm">
        <p className="whitespace-pre-wrap text-sm leading-6">{prompt}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-200">
          <span className="rounded-full bg-white/10 px-3 py-1">{templateDisplay?.name ?? t.templateFallback}</span>
          <span className="rounded-full bg-white/10 px-3 py-1">{t.preset[preset]}</span>
          <span className="rounded-full bg-white/10 px-3 py-1">
            {files.length} {t.files}
          </span>
        </div>
      </div>
    </div>
  );
}

function WorkflowBubble({
  status,
  stage,
  error,
  jobId,
  job,
  language,
  showQaReport,
}: {
  status: JobStatus;
  stage: string;
  error: string;
  jobId: string;
  job: JobManifest | null;
  language: Language;
  showQaReport: boolean;
}) {
  const t = copy[language];
  const currentIndex = workflowIndex(status);
  const visibleArtifacts = Object.entries(job?.artifacts ?? {}).filter(([name]) => showQaReport || name !== "qa_report.md");
  return (
    <div className="flex gap-3">
      <Avatar tone={status === "failed" ? "error" : "assistant"} />
      <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-sm ring-1 ring-rail">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">{t.status[status].title}</h2>
            <p className="mt-1 text-sm leading-6 text-quiet">{t.status[status].text}</p>
          </div>
          {jobId && <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-quiet">{jobId}</span>}
        </div>

        <div className="grid gap-3">
          {t.workflow.map((step, index) => {
            const state = stepState(index, currentIndex, status);
            return (
              <div key={step.key} className="flex gap-3 rounded-xl border border-rail bg-mist/60 p-3">
                <StepIcon state={state} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{step.title}</span>
                    {stage === step.key && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-cobalt">{language === "zh" ? "进行中" : "Active"}</span>}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-quiet">{step.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {error && <div className="mt-4 rounded-xl bg-rose/10 px-4 py-3 text-sm leading-6 text-rose">{error}</div>}

        {visibleArtifacts.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {visibleArtifacts.map(([name, href]) => (
              <a
                key={name}
                href={href}
                className="rounded-xl border border-rail px-4 py-3 text-sm font-bold text-cobalt transition hover:border-cobalt hover:bg-blue-50"
              >
                {artifactLabel(name, language)}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateSidebar({
  templates,
  selectedTemplate,
  selectedTemplateId,
  onChange,
  language,
}: {
  templates: TemplateMeta[];
  selectedTemplate?: TemplateMeta;
  selectedTemplateId: string;
  onChange: (id: string) => void;
  language: Language;
}) {
  const t = copy[language];
  const selectedDisplay = selectedTemplate ? getTemplateDisplay(selectedTemplate, language) : null;
  return (
    <aside className="min-w-0 py-0 lg:py-6">
      <div className="sticky top-[82px] grid max-h-[calc(100vh-98px)] gap-3 overflow-auto rounded-2xl border border-rail bg-white p-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold">
            <Presentation size={17} className="text-cobalt" />
            {t.templatePanel}
          </div>
          <p className="mt-1 text-xs leading-5 text-quiet">{t.templatePanelHint}</p>
        </div>

        {selectedTemplate && (
          <div className="rounded-xl border border-rail p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{selectedDisplay?.name}</div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-quiet">{selectedDisplay?.style}</div>
              </div>
              <span className="shrink-0 rounded-full bg-mist px-2 py-1 text-[11px] font-semibold text-quiet">
                {templateKindLabel(selectedTemplate, language)}
              </span>
            </div>
            <div className="aspect-video overflow-hidden rounded-lg border border-rail bg-white">
              <iframe
                key={`${selectedTemplate.id}-${language}`}
                src={`${selectedTemplate.examplePath}?lang=${language}`}
                title={`${selectedDisplay?.name ?? selectedTemplate.name} preview`}
                sandbox=""
                className="h-full w-full origin-top-left bg-white sm:h-[166.67%] sm:w-[166.67%] sm:scale-[0.6]"
              />
            </div>
          </div>
        )}

        <TemplatePicker templates={templates} selectedTemplateId={selectedTemplateId} onChange={onChange} language={language} />
      </div>
    </aside>
  );
}

function TemplatePicker({
  templates,
  selectedTemplateId,
  onChange,
  language,
}: {
  templates: TemplateMeta[];
  selectedTemplateId: string;
  onChange: (id: string) => void;
  language: Language;
}) {
  return (
    <div className="grid w-full min-w-0 gap-2">
      {templates.map((template) => (
        <TemplateOption
          key={template.id}
          template={template}
          selected={selectedTemplateId === template.id}
          onSelect={() => onChange(template.id)}
          language={language}
        />
      ))}
    </div>
  );
}

function TemplateOption({
  template,
  selected,
  onSelect,
  language,
}: {
  template: TemplateMeta;
  selected: boolean;
  onSelect: () => void;
  language: Language;
}) {
  const display = getTemplateDisplay(template, language);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-3 rounded-xl border p-2 text-left transition ${
        selected ? "border-cobalt bg-blue-50" : "border-rail bg-white hover:border-cobalt/50"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={template.previewPath} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{display.name}</span>
        <span className="mt-1 block truncate text-xs text-quiet">{display.tags.slice(0, 3).join(" / ")}</span>
      </span>
    </button>
  );
}

function getTemplateDisplay(template: TemplateMeta, language: Language) {
  return {
    name: template.localized?.name?.[language] ?? template.name,
    style: template.localized?.style?.[language] ?? template.style,
    purpose: template.localized?.purpose?.[language] ?? template.purpose,
    tags: template.localized?.tags?.[language] ?? template.tags,
  };
}

function templateKindLabel(template: TemplateMeta, language: Language) {
  const t = copy[language];
  if (template.kind === "pptx-imported") return template.hasPptxTemplate ? t.templatePptx : t.templateImported;
  return t.templateDerived;
}

function PresetSelector({ preset, onChange, language }: { preset: Preset; onChange: (preset: Preset) => void; language: Language }) {
  const t = copy[language];
  return (
    <div className="grid grid-cols-3 rounded-full bg-mist p-1 text-sm font-semibold">
      {(["quick", "standard", "polished"] as Preset[]).map((item) => (
        <button
          type="button"
          key={item}
          onClick={() => onChange(item)}
          className={`rounded-full px-3 py-1.5 transition ${
            preset === item ? "bg-white text-cobalt shadow-sm" : "text-quiet hover:text-ink"
          }`}
        >
          {t.preset[item]}
        </button>
      ))}
    </div>
  );
}

function HistoryDrawer({
  open,
  onClose,
  jobs,
  currentJobId,
  onSelect,
  language,
}: {
  open: boolean;
  onClose: () => void;
  jobs: JobManifest[];
  currentJobId: string;
  onSelect: (job: JobManifest) => void;
  language: Language;
}) {
  const t = copy[language];
  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-full max-w-sm flex-col border-r border-rail bg-white shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between border-b border-rail px-4 py-3">
        <div>
          <div className="text-sm font-bold">{t.history}</div>
          <div className="text-xs text-quiet">{t.historyHint}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-quiet hover:bg-mist">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-rail p-4 text-sm text-quiet">{t.noHistory}</div>
        ) : (
          <div className="grid gap-2">
            {jobs.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onSelect(item)}
                className={`rounded-xl border p-3 text-left transition hover:border-cobalt hover:bg-blue-50 ${
                  item.id === currentJobId ? "border-cobalt bg-blue-50" : "border-rail bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold">{item.title}</span>
                  <span className="shrink-0 rounded-full bg-mist px-2 py-0.5 text-[11px] font-semibold text-quiet">
                    {copy[language].status[item.status].title}
                  </span>
                </div>
                <div className="mt-2 text-xs text-quiet">{new Date(item.updatedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function PasswordDialog({
  open,
  onClose,
  language,
}: {
  open: boolean;
  onClose: () => void;
  language: Language;
}) {
  const t = copy[language];
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, nextPassword }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? t.passwordFailed);
      return;
    }
    setCurrentPassword("");
    setNextPassword("");
    setMessage(t.passwordSaved);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-rail bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-bold">
            <KeyRound size={18} className="text-cobalt" />
            {t.passwordTitle}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-quiet hover:bg-mist" aria-label={t.close}>
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm font-semibold">
            {t.currentPassword}
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            {t.nextPassword}
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt"
            />
          </label>
          {message && <div className="rounded-xl bg-mist px-4 py-3 text-sm text-quiet">{message}</div>}
          <button
            disabled={loading || !currentPassword || nextPassword.length < 6}
            className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-bold text-white hover:bg-cobalt disabled:bg-slate-400"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {t.savePassword}
          </button>
        </div>
      </form>
    </div>
  );
}

function DebugDrawer({
  open,
  onClose,
  logs,
  copied,
  onCopy,
  health,
  jobId,
  stage,
  language,
  logEndRef,
}: {
  open: boolean;
  onClose: () => void;
  logs: LogLine[];
  copied: boolean;
  onCopy: () => void;
  health: Health | null;
  jobId: string;
  stage: string;
  language: Language;
  logEndRef: RefObject<HTMLDivElement | null>;
}) {
  const t = copy[language];
  return (
    <aside className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-slate-800 bg-[#0b1120] text-slate-100 shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}>
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <div className="text-sm font-bold">{t.diagnosticsTitle}</div>
          <div className="text-xs text-slate-400">{t.diagnosticsHint}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-300 hover:bg-slate-800">
          <X size={18} />
        </button>
      </div>

      <div className="grid gap-2 border-b border-slate-800 p-4 text-xs text-slate-300">
        <div>
          {t.engine}: {health?.selectedAgent ? health.selectedAgent.label : "checking"}
        </div>
        <div>{t.validator}: {health?.validatorExists ? "ready" : "missing"}</div>
        <div>{t.job}: {jobId || "none"}</div>
        <div>{t.stage}: {stage}</div>
      </div>

      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <span className="text-xs text-slate-400">
          {logs.length} {t.lines}
        </span>
        <button type="button" onClick={onCopy} className="flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
          {copied ? t.copied : t.copyAll}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-5">
        {logs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
            <Clipboard size={28} />
            <span>{t.noLogs}</span>
          </div>
        ) : (
          logs.map((line, index) => (
            <div key={`${line.at}-${index}`} className="whitespace-pre-wrap break-words">
              <span className={line.stream === "stderr" ? "text-amber" : "text-cyan"}>[{line.stream}] </span>
              {line.message}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </aside>
  );
}

function Avatar({ tone }: { tone: "assistant" | "error" }) {
  return (
    <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-white ${tone === "error" ? "bg-rose" : "bg-cobalt"}`}>
      {tone === "error" ? "!" : "P"}
    </div>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "waiting" | "failed" }) {
  if (state === "done") return <CheckCircle2 className="mt-0.5 shrink-0 text-mint" size={20} />;
  if (state === "active") return <Loader2 className="mt-0.5 shrink-0 animate-spin text-cobalt" size={20} />;
  if (state === "failed") return <AlertCircle className="mt-0.5 shrink-0 text-rose" size={20} />;
  return <div className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-slate-300" />;
}

function workflowIndex(status: JobStatus) {
  if (status === "failed") return 1;
  if (status === "complete") return 3;
  if (status === "validating") return 2;
  if (status === "running" || status === "previewing") return 1;
  if (status === "queued" || status === "uploading") return 0;
  return -1;
}

function stepState(index: number, currentIndex: number, status: JobStatus) {
  if (status === "failed" && index === currentIndex) return "failed";
  if (index < currentIndex || status === "complete") return "done";
  if (index === currentIndex && status !== "idle") return "active";
  return "waiting";
}

function artifactLabel(name: string, language: Language) {
  return copy[language].artifacts[name as keyof typeof copy.zh.artifacts] ?? name;
}
