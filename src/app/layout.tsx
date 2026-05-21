import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ppt agent",
  description: "Local chat-to-PPT generator powered by Codex and ppt-agent-pipeline.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

