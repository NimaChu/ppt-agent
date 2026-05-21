#!/usr/bin/env python3
"""Validate a ppt-agent-pipeline job workspace.

The script checks the artifact contract used by the skill. It is intentionally
lightweight: it does not judge visual quality, but it catches missing files,
bad JSON, slide-plan shape problems, and absent final/QA artifacts.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Any


REQUIRED_DIRS = [
    "sources",
    "planning",
    "preview",
    "qa",
    "output",
]

REQUIRED_FILES = [
    "request.json",
    "planning/outline.md",
    "planning/design_system.json",
    "planning/slide_plan.json",
]


def read_json(path: Path, errors: list[str]) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"missing file: {path}")
    except json.JSONDecodeError as exc:
        errors.append(f"invalid JSON: {path} ({exc})")
    return None


def count_pptx_slides(path: Path) -> int | None:
    if not path.exists():
        return None
    try:
        with zipfile.ZipFile(path) as zf:
            return len(
                [
                    name
                    for name in zf.namelist()
                    if name.startswith("ppt/slides/slide") and name.endswith(".xml")
                ]
            )
    except zipfile.BadZipFile:
        return None


def validate_slide_plan(plan: Any, errors: list[str], warnings: list[str]) -> int:
    if isinstance(plan, dict) and isinstance(plan.get("slides"), list):
        slides = plan["slides"]
    elif isinstance(plan, list):
        slides = plan
    else:
        errors.append("planning/slide_plan.json must be a list or an object with slides[]")
        return 0

    required_keys = {"title", "claim", "layout", "route"}
    allowed_routes = {"pptxgenjs", "ooxml", "vector", "ppt_master", "presentations", "manual"}
    for idx, slide in enumerate(slides, 1):
        if not isinstance(slide, dict):
            errors.append(f"slide {idx}: must be an object")
            continue
        missing = sorted(required_keys - set(slide))
        if missing:
            errors.append(f"slide {idx}: missing keys {missing}")
        route = slide.get("route")
        if route and route not in allowed_routes:
            warnings.append(f"slide {idx}: unknown route {route!r}")
    return len(slides)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_dir", type=Path, help="job workspace directory")
    parser.add_argument(
        "--require-final",
        action="store_true",
        help="require output/final.pptx and qa/qa_report.md",
    )
    args = parser.parse_args()

    job = args.job_dir.resolve()
    errors: list[str] = []
    warnings: list[str] = []

    if not job.exists():
        errors.append(f"job directory does not exist: {job}")
    elif not job.is_dir():
        errors.append(f"job path is not a directory: {job}")

    for rel in REQUIRED_DIRS:
        path = job / rel
        if not path.is_dir():
            warnings.append(f"missing recommended directory: {rel}/")

    for rel in REQUIRED_FILES:
        path = job / rel
        if not path.exists():
            errors.append(f"missing required file: {rel}")

    request = read_json(job / "request.json", errors)
    design = read_json(job / "planning" / "design_system.json", errors)
    plan = read_json(job / "planning" / "slide_plan.json", errors)

    slide_count = validate_slide_plan(plan, errors, warnings) if plan is not None else 0

    if isinstance(request, dict):
        preset = request.get("preset", "standard")
        if preset not in {"quick", "standard", "polished"}:
            warnings.append(f"request.json preset should be quick|standard|polished, got {preset!r}")

    if isinstance(design, dict):
        for key in ("palette", "fonts"):
            if key not in design:
                warnings.append(f"design_system.json missing recommended key: {key}")

    final = job / "output" / "final.pptx"
    qa = job / "qa" / "qa_report.md"
    final_slides = count_pptx_slides(final)
    if args.require_final:
        if final_slides is None:
            errors.append("missing or invalid final PPTX: output/final.pptx")
        if not qa.exists():
            errors.append("missing QA report: qa/qa_report.md")
    elif final.exists() and final_slides is None:
        errors.append("invalid final PPTX: output/final.pptx")

    if final_slides is not None and slide_count and final_slides != slide_count:
        warnings.append(
            f"final slide count ({final_slides}) differs from slide_plan count ({slide_count})"
        )

    report = {
        "job_dir": str(job),
        "ok": not errors,
        "slide_plan_count": slide_count,
        "final_slide_count": final_slides,
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
