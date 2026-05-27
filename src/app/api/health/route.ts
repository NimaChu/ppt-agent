import { NextResponse } from "next/server";
import { pathExists } from "@/lib/fs-utils";
import { VALIDATE_JOB_SCRIPT } from "@/lib/paths";
import { listTemplates } from "@/lib/templates";
import { detectAgentClis } from "@/lib/agent-cli";
import { ensureJobQueueStarted } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET() {
  const agents = detectAgentClis();
  const selectedAgent = agents.find((agent) => agent.selected) ?? null;
  const templates = await listTemplates();
  const validatorExists = await pathExists(VALIDATE_JOB_SCRIPT);
  const queue = await ensureJobQueueStarted();

  return NextResponse.json({
    ok: Boolean(selectedAgent) && validatorExists && templates.length > 0,
    selectedAgent,
    agents,
    validatorExists,
    templateCount: templates.length,
    queue,
  });
}
