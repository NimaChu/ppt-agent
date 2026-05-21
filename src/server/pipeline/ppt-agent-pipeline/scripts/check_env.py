#!/usr/bin/env python3
"""Report portable ppt-agent pipeline dependencies as JSON."""

from __future__ import annotations

import json
import shutil
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = PIPELINE_DIR.parents[3]

COMMANDS = [
    "python3",
    "node",
    "npm",
    "soffice",
    "pdftoppm",
    "claude",
    "codex",
    "gemini",
    "cursor-agent",
    "cursor",
]


def path_status(path: Path) -> dict[str, object]:
    return {
        "path": str(path),
        "exists": path.exists(),
        "is_dir": path.is_dir(),
    }


def main() -> None:
    files = {
        "pipeline_skill": PIPELINE_DIR / "SKILL.md",
        "validator": SCRIPT_DIR / "validate_job.py",
        "templates_dir": PROJECT_ROOT / "data" / "templates",
        "template_importer": PROJECT_ROOT / "src" / "server" / "template-import" / "pptx_template_import.py",
    }
    report = {
        "project_root": str(PROJECT_ROOT),
        "pipeline_dir": str(PIPELINE_DIR),
        "files": {name: path_status(path) for name, path in files.items()},
        "commands": {cmd: shutil.which(cmd) for cmd in COMMANDS},
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
