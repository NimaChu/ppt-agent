import path from "node:path";

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = process.env.PPT_AGENT_DATA_DIR
  ? path.resolve(process.env.PPT_AGENT_DATA_DIR)
  : path.join(PROJECT_ROOT, "data");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const AUTH_DIR = path.join(DATA_DIR, "auth");
export const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
export const PPT_AGENT_SKILL_DIR = path.join(PROJECT_ROOT, "src", "server", "pipeline", "ppt-agent-pipeline");
export const VALIDATE_JOB_SCRIPT = path.join(PPT_AGENT_SKILL_DIR, "scripts", "validate_job.py");
