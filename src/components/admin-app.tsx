"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileUp, Loader2, Plus, Presentation, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { AppUser, TemplateMeta } from "@/lib/types";

export function AdminApp({ currentUser }: { currentUser: AppUser }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [pptxFile, setPptxFile] = useState<File | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadUsers();
    void loadTemplates();
  }, []);

  async function loadUsers() {
    const res = await fetch("/api/admin/users");
    if (!res.ok) return;
    const data = await res.json();
    setUsers(data.users ?? []);
  }

  async function loadTemplates() {
    const res = await fetch("/api/admin/templates");
    if (!res.ok) return;
    const data = await res.json();
    setTemplates(data.templates ?? []);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, name, password, role }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error ?? "保存失败");
      return;
    }
    setMessage("账号已保存");
    setUsername("");
    setName("");
    setPassword("");
    setRole("user");
    void loadUsers();
  }

  async function importPptx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pptxFile) return;
    setTemplateLoading(true);
    setTemplateMessage("");
    const formData = new FormData();
    formData.append("file", pptxFile);
    formData.append("name", templateName);
    formData.append("description", templateDescription);
    formData.append("tags", templateTags);
    const res = await fetch("/api/admin/templates", { method: "POST", body: formData });
    await finishTemplateImport(res);
  }

  async function finishTemplateImport(res: Response) {
    setTemplateLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTemplateMessage(data.error ?? "模板导入失败");
      return;
    }
    setTemplateMessage("模板已导入");
    setTemplateName("");
    setTemplateDescription("");
    setTemplateTags("");
    setPptxFile(null);
    void loadTemplates();
  }

  async function deleteTemplate(template: TemplateMeta) {
    const templateName = template.localized?.name?.zh ?? template.name;
    if (!window.confirm(`确定删除模板「${templateName}」吗？`)) return;
    setDeletingTemplateId(template.id);
    setTemplateMessage("");
    const res = await fetch("/api/admin/templates", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: template.id }),
    });
    setDeletingTemplateId("");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTemplateMessage(data.error ?? "模板删除失败");
      return;
    }
    setTemplateMessage("模板已删除");
    void loadTemplates();
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-ink">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-quiet hover:text-cobalt">
              <ArrowLeft size={16} />
              返回 ppt agent
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">账号管理</h1>
            <p className="mt-1 text-sm text-quiet">当前管理员：{currentUser.name}</p>
          </div>
          <div className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-cobalt">Admin</div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
          <form onSubmit={submit} className="rounded-2xl border border-rail bg-white p-4 shadow-panel">
            <div className="mb-4 flex items-center gap-2 font-bold">
              <Plus size={18} className="text-cobalt" />
              新增或重置账号
            </div>
            <div className="grid gap-3">
              <label className="grid gap-2 text-sm font-semibold">
                用户名
                <input value={username} onChange={(event) => setUsername(event.target.value)} className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt" />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                显示名称
                <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt" />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                密码
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt" />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                角色
                <select value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "user")} className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
              {message && <div className="rounded-xl bg-mist px-4 py-3 text-sm text-quiet">{message}</div>}
              <button disabled={loading || !username.trim()} className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-bold text-white hover:bg-cobalt disabled:bg-slate-400">
                {loading && <Loader2 size={16} className="animate-spin" />}
                保存账号
              </button>
            </div>
          </form>

          <section className="rounded-2xl border border-rail bg-white p-4 shadow-panel">
            <div className="mb-4 flex items-center gap-2 font-bold">
              <UserRound size={18} className="text-cobalt" />
              已有账号
            </div>
            <div className="grid gap-2">
              {users.map((user) => (
                <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rail p-3">
                  <div>
                    <div className="font-bold">{user.name}</div>
                    <div className="text-sm text-quiet">@{user.username}</div>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-mist px-3 py-1 text-xs font-bold text-quiet">
                    {user.role === "admin" && <ShieldCheck size={14} className="text-cobalt" />}
                    {user.role === "admin" ? "管理员" : "普通用户"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-2xl border border-rail bg-white p-4 shadow-panel">
          <div className="mb-4 flex items-center gap-2 font-bold">
            <Presentation size={18} className="text-cobalt" />
            模板管理
          </div>

          <div className="grid gap-4">
            <form onSubmit={importPptx} className="grid max-w-3xl gap-3 rounded-xl border border-rail p-3">
              <div>
                <div className="font-bold">上传 PPT 生成模板</div>
                <p className="mt-1 text-sm text-quiet">上传公司母版或参考 PPT，ppt agent 会解析版式、主题、示例页并生成可复用模板。</p>
              </div>
              <div className="grid gap-3">
                <label className="grid gap-2 text-sm font-semibold">
                  名称
                  <input
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="公司战略汇报模板"
                    className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  描述
                  <textarea
                    value={templateDescription}
                    onChange={(event) => setTemplateDescription(event.target.value)}
                    placeholder="适合管理层汇报、年度总结、项目复盘，风格稳重简洁。"
                    rows={3}
                    className="resize-none rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  标签
                  <input
                    value={templateTags}
                    onChange={(event) => setTemplateTags(event.target.value)}
                    placeholder="咨询, 战略, 客户分析"
                    className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none focus:border-cobalt"
                  />
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-rail bg-mist px-4 py-3 text-sm font-semibold text-quiet hover:border-cobalt hover:text-cobalt">
                <FileUp size={16} />
                {pptxFile ? pptxFile.name : "选择 .pptx / .potx 文件"}
                <input
                  type="file"
                  accept=".pptx,.potx"
                  onChange={(event) => setPptxFile(event.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </label>
              <button disabled={templateLoading || !templateName.trim() || !templateDescription.trim() || !templateTags.trim() || !pptxFile} className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-bold text-white hover:bg-cobalt disabled:bg-slate-400">
                {templateLoading && <Loader2 size={16} className="animate-spin" />}
                上传并生成模板
              </button>
            </form>
          </div>

          {templateMessage && <div className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm text-quiet">{templateMessage}</div>}

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <div key={template.id} className="rounded-xl border border-rail p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold">{template.localized?.name?.zh ?? template.name}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-mist px-2 py-1 text-[11px] font-bold text-quiet">
                      {template.kind === "pptx-imported" ? "导入模板" : "成品沉淀"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void deleteTemplate(template)}
                      disabled={deletingTemplateId === template.id}
                      className="grid h-8 w-8 place-items-center rounded-full text-quiet hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      aria-label={`删除模板 ${template.localized?.name?.zh ?? template.name}`}
                      title="删除模板"
                    >
                      {deletingTemplateId === template.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  </div>
                </div>
                <div className="mt-2 line-clamp-2 text-sm leading-6 text-quiet">
                  {template.localized?.style?.zh ?? template.style}
                </div>
                <div className="mt-2 truncate text-xs font-semibold text-quiet">
                  {(template.localized?.tags?.zh ?? template.tags).slice(0, 4).join(" / ")}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
