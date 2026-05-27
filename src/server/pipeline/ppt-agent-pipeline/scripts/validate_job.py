#!/usr/bin/env python3
"""Validate a ppt-agent-pipeline job workspace.

The script checks the artifact contract used by the skill. It is intentionally
lightweight: it does not judge visual quality, but it catches missing files,
bad JSON, slide-plan shape problems, absent final artifacts and, when
requested, an absent admin-facing QA report.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


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

PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS = {"p": PML_NS, "a": DML_NS}


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


def validate_pptx_text_bounds(path: Path, errors: list[str]) -> None:
    """Reject editable text shapes that were generated fully off the slide canvas."""
    if not path.exists():
        return
    try:
        with zipfile.ZipFile(path) as zf:
            presentation = ElementTree.fromstring(zf.read("ppt/presentation.xml"))
            size = presentation.find("p:sldSz", NS)
            if size is None:
                return
            width = int(size.attrib.get("cx", "0"))
            height = int(size.attrib.get("cy", "0"))
            slide_names = sorted(
                (
                    name
                    for name in zf.namelist()
                    if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
                ),
                key=lambda name: int(re.search(r"\d+", name).group()),
            )
            outside_slides: list[str] = []
            for index, name in enumerate(slide_names, 1):
                root = ElementTree.fromstring(zf.read(name))
                outside_count = 0
                for shape in root.findall(".//p:sp", NS):
                    text = "".join(node.text or "" for node in shape.findall(".//a:t", NS)).strip()
                    if not text:
                        continue
                    transform = shape.find("./p:spPr/a:xfrm", NS)
                    if transform is None:
                        continue
                    offset = transform.find("a:off", NS)
                    extent = transform.find("a:ext", NS)
                    if offset is None or extent is None:
                        continue
                    x = int(offset.attrib.get("x", "0"))
                    y = int(offset.attrib.get("y", "0"))
                    cx = int(extent.attrib.get("cx", "0"))
                    cy = int(extent.attrib.get("cy", "0"))
                    visible = cx > 0 and cy > 0 and x < width and y < height and x + cx > 0 and y + cy > 0
                    if not visible:
                        outside_count += 1
                if outside_count:
                    outside_slides.append(f"{index} ({outside_count})")
            if outside_slides:
                errors.append(
                    "text shapes outside slide canvas on slides "
                    + ", ".join(outside_slides)
                    + "; check PPTX coordinate units (PptxGenJS positions are inches, not pixels)"
                )
    except (KeyError, ValueError, ElementTree.ParseError, zipfile.BadZipFile):
        # Corrupt/invalid PPTX is already reported by the structural slide-count check.
        return


def validate_pptx_text_overlaps(path: Path, errors: list[str]) -> None:
    """Reject large stacked text regions, such as a title covered by a claim bar."""
    if not path.exists():
        return
    try:
        with zipfile.ZipFile(path) as zf:
            slide_names = sorted(
                (
                    name
                    for name in zf.namelist()
                    if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
                ),
                key=lambda name: int(re.search(r"\d+", name).group()),
            )
            overlap_slides: list[str] = []
            min_overlap = 73152  # 0.08 inches in EMU; avoid flagging optical-edge padding.
            wide_overlap = 2743200  # 3 inches; avoid false positives for inline labels/footers.
            for index, name in enumerate(slide_names, 1):
                root = ElementTree.fromstring(zf.read(name))
                boxes: list[tuple[str, int, int, int, int]] = []
                for shape in root.findall(".//p:sp", NS):
                    text = "".join(node.text or "" for node in shape.findall(".//a:t", NS)).strip()
                    if len(text) <= 2:
                        continue
                    transform = shape.find("./p:spPr/a:xfrm", NS)
                    if transform is None:
                        continue
                    offset = transform.find("a:off", NS)
                    extent = transform.find("a:ext", NS)
                    if offset is None or extent is None:
                        continue
                    x = int(offset.attrib.get("x", "0"))
                    y = int(offset.attrib.get("y", "0"))
                    cx = int(extent.attrib.get("cx", "0"))
                    cy = int(extent.attrib.get("cy", "0"))
                    if cx > 0 and cy > 0:
                        boxes.append((text, x, y, cx, cy))

                pair_count = 0
                for left_index, (_, x1, y1, w1, h1) in enumerate(boxes):
                    for _, x2, y2, w2, h2 in boxes[left_index + 1 :]:
                        overlap_w = min(x1 + w1, x2 + w2) - max(x1, x2)
                        overlap_h = min(y1 + h1, y2 + h2) - max(y1, y2)
                        vertically_stacked = abs(y1 - y2) >= min_overlap
                        if overlap_w < wide_overlap or overlap_h < min_overlap or not vertically_stacked:
                            continue
                        intersection = overlap_w * overlap_h
                        smaller_area = min(w1 * h1, w2 * h2)
                        if smaller_area and intersection / smaller_area >= 0.20:
                            pair_count += 1
                if pair_count:
                    overlap_slides.append(f"{index} ({pair_count} pair{'s' if pair_count != 1 else ''})")
            if overlap_slides:
                errors.append(
                    "substantial overlapping wide text regions on slides "
                    + ", ".join(overlap_slides)
                    + "; inspect rendered previews and keep title, claim bar, and body regions separate"
                )
    except (KeyError, ValueError, ElementTree.ParseError, zipfile.BadZipFile):
        # Corrupt/invalid PPTX is already reported by the structural slide-count check.
        return


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
        help="require output/final.pptx and individual slide previews",
    )
    parser.add_argument(
        "--require-qa",
        action="store_true",
        help="require admin-facing qa/qa_report.md",
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
    elif final.exists() and final_slides is None:
        errors.append("invalid final PPTX: output/final.pptx")
    if args.require_qa and not qa.exists():
        errors.append("missing QA report: qa/qa_report.md")

    if final_slides is not None and slide_count and final_slides != slide_count:
        warnings.append(
            f"final slide count ({final_slides}) differs from slide_plan count ({slide_count})"
        )
    if final_slides is not None:
        validate_pptx_text_bounds(final, errors)
        validate_pptx_text_overlaps(final, errors)
        preview_files = sorted(
            path
            for path in (job / "preview").glob("slide*.*")
            if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".svg", ".webp"}
        )
        if args.require_final and len(preview_files) < final_slides:
            errors.append(
                f"missing individual slide previews: expected {final_slides}, found {len(preview_files)}"
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
