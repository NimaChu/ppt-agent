export type JobStatus =
  | "idle"
  | "uploading"
  | "queued"
  | "running"
  | "previewing"
  | "validating"
  | "complete"
  | "failed";

export type Preset = "quick" | "standard" | "polished";

export type AgentCliId = "claude" | "codex" | "gemini" | "cursor";

export type AgentCliStatus = {
  id: AgentCliId;
  label: string;
  command: string;
  path: string | null;
  available: boolean;
  selected: boolean;
};

export type AppUser = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "user";
  createdAt: string;
};

export type StoredUser = AppUser & {
  passwordHash: string;
};

export type UserSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type ChatMessageSummary = {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
};

export type LocalizedText = {
  zh: string;
  en: string;
};

export type TemplateKind = "deck-derived" | "pptx-imported";

export type TemplateMeta = {
  id: string;
  kind: TemplateKind;
  name: string;
  purpose: string;
  style: string;
  tags: string[];
  localized?: {
    name?: LocalizedText;
    purpose?: LocalizedText;
    style?: LocalizedText;
    tags?: {
      zh: string[];
      en: string[];
    };
  };
  aspectRatio: string;
  hasPptxTemplate: boolean;
  sourceExample?: string;
  designSpecPath?: string;
  specLockPath?: string;
  sampleSvgDir?: string;
  templateStrength?: string;
  previewPath: string;
  examplePath: string;
  templatePath?: string;
};

export type JobManifest = {
  id: string;
  userId: string;
  title: string;
  conversationId: string;
  messages: ChatMessageSummary[];
  status: JobStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  templateId: string;
  preset: Preset;
  agentId?: AgentCliId;
  agentCommand?: string;
  prompt: string;
  uploads: string[];
  error?: string;
  artifacts: Record<string, string>;
};

export type JobEvent =
  | { type: "status"; status: JobStatus; stage: string; at: string }
  | { type: "log"; stream: "stdout" | "stderr" | "system"; message: string; at: string }
  | { type: "artifact"; name: string; path: string; at: string }
  | { type: "error"; message: string; at: string }
  | { type: "done"; at: string };
