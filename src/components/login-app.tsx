"use client";

import { FormEvent, useEffect, useState } from "react";
import { Languages, Loader2, Presentation } from "lucide-react";

type Language = "zh" | "en";

const copy = {
  zh: {
    title: "登录 ppt agent",
    subtitle: "使用本地账号进入局域网 PPT 生成服务。",
    username: "用户名",
    password: "密码",
    submit: "登录",
    loading: "登录中",
    error: "用户名或密码不正确",
    createHint: "如果还没有账号，请在服务器上运行 npm run user:add 创建。",
  },
  en: {
    title: "Sign in to ppt agent",
    subtitle: "Use a local account to access the LAN PPT generation service.",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    loading: "Signing in",
    error: "Invalid username or password",
    createHint: "If you do not have an account, create one on the server with npm run user:add.",
  },
} as const;

export function LoginApp() {
  const [language, setLanguage] = useState<Language>("zh");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const t = copy[language];

  useEffect(() => {
    const saved = window.localStorage.getItem("ppt-agent-language");
    if (saved === "zh" || saved === "en") setLanguage(saved);
  }, []);

  function toggleLanguage() {
    const next = language === "zh" ? "en" : "zh";
    setLanguage(next);
    window.localStorage.setItem("ppt-agent-language", next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError(t.error);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-rail bg-white p-6 shadow-panel">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-bold">
              <Presentation size={19} className="text-cobalt" />
              ppt agent
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight">{t.title}</h1>
            <p className="mt-2 text-sm leading-6 text-quiet">{t.subtitle}</p>
          </div>
          <button type="button" onClick={toggleLanguage} className="header-button shrink-0">
            <Languages size={16} />
            {language === "zh" ? "EN" : "CN"}
          </button>
        </div>

        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">
            {t.username}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none transition focus:border-cobalt"
              autoComplete="username"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            {t.password}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-xl border border-rail bg-mist px-4 py-3 outline-none transition focus:border-cobalt"
              autoComplete="current-password"
            />
          </label>
          {error && <div className="rounded-xl bg-rose/10 px-4 py-3 text-sm text-rose">{error}</div>}
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="mt-1 flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:bg-cobalt disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? t.loading : t.submit}
          </button>
        </form>

        <p className="mt-5 text-xs leading-5 text-quiet">{t.createHint}</p>
      </div>
    </main>
  );
}
