---
name: ppt-agent-pipeline
description: Service-oriented AI PowerPoint generation workflow for LAN or web agents. Use when designing, implementing, optimizing, or operating a backend agent that creates or edits editable .pptx decks from chat requirements, source files, templates, or company style rules; when combining pptxgenjs/OOXML editing, embedded vector-to-PowerPoint rendering, and preview/layout QA; or when deciding which PPT generation route to use for a production-like service.
---

# PPT Agent Pipeline

Use this skill to build, optimize, or run a service-ready PPT generation pipeline. The goal is not a single magic renderer; it is a routing layer that combines three strengths:

- `pptxgenjs` and OOXML editing for stable service generation, templates, native charts, precise edits, low latency, and low token use.
- Embedded `spec_lock`, SVG quality checks, and vector-to-PowerPoint paths for complex visual pages and editable vector design drafts.
- Presentations-style claim planning, previews/contact sheets, layout inspection, and fix-and-verify QA for client-ready quality.

## Bundled Runtime

This pipeline is bundled with the ppt-agent web app. The web app may call any supported, already logged-in coding-agent CLI, but the job contract and validator live inside this project.

Before relying on local toolchains, run from the app root:

```bash
python3 src/server/pipeline/ppt-agent-pipeline/scripts/check_env.py
```

Do not assume user-specific skill directories or downloaded tool folders exist on another machine. Prefer project-bundled templates, project-bundled validators, standard Node/Python tools, and packages available in the active agent CLI environment.

## Production Default

For a LAN chat-to-PPT service, default to:

1. Plan with a compact claim spine and `slide_plan.json`.
2. Render ordinary slides with `pptxgenjs` or template OOXML.
3. Route only visual-heavy slides to the embedded vector-to-PowerPoint module.
4. Generate slide previews/contact sheet and run a layout/placeholder QA pass.
5. Return `final.pptx` and previews. Retain `qa_report.md` only when the job explicitly enables the admin-facing QA report.

This keeps the fast/cheap renderer as the base while borrowing vector-design quality discipline and Presentations-style visual verification.

## Template Package Contract

When `request.json.template` is present, treat it as the selected PPT-generation template package:

- `kind: "deck-derived"`: a reusable style template distilled from a finished PowerPoint deck. Read `templateDir/SKILL.md`, `references/design_spec.md`, and `references/spec_lock.md` when present. Use `references/sample_svgs/` to learn page rhythm and reusable layout patterns, but do not copy the original deck's business content.
- `kind: "pptx-imported"`: a user/company PowerPoint reference imported into the app. Prefer OOXML/template-preserving routes when useful, read `references/manifest.json` if present, and preserve the source brand grammar while generating a new deck.
- `template.pptx`, when present, is a style/master reference and may be copied into the job workspace. Never overwrite it. The final deliverable must still be a new editable `output/final.pptx`.
- `references/brand/brand-spec.md`, when present, is the real-asset source of truth. Use its provided logo, product image, and UI screenshot files ahead of generic decoration or invented brand substitutes.
- Image files supplied with a job may be used as real logos, product imagery, or UI screenshots when the user's request identifies their role. Never invent a brand meaning or claim from an unlabeled upload.

Do not use screenshot-only HTML references as the main template source. HTML previews inside a template folder are for picker preview only.

## Generation Policy

The web app has one user-facing generation route: generate a complete editable PPTX directly from the selected template and source material. Do not introduce a pre-generation visual approval pause or user-visible quality preset.

- Use `pptxgenjs`/OOXML as the editable base route.
- When using `pptxgenjs`, all `x`, `y`, `w`, and `h` values are in inches. Use the actual selected layout dimensions (for example `LAYOUT_16x9` is 10 x 5.625 inches); never place shapes with raw `1280 x 720` pixel coordinates on an inch-based layout.
- `fontFace` must be one real PowerPoint font name, not a CSS font-family stack. For Chinese decks use a platform-appropriate installed CJK font or an explicit conservative fallback strategy.
- Use embedded vector work only on pages where it materially improves communication or template fidelity.
- The app produces baseline per-slide SVG previews directly from the final PPTX. Produce a higher-fidelity contact sheet only when a native renderer is already available, then run a blocking-defect scan.
- Keep revisions targeted: regenerate an affected slide rather than starting a second full planning cycle.

## Route The Job

Choose exactly one primary route per job, then add secondary modules only where they solve a concrete weakness.

| Situation | Primary route | Add-on |
|---|---|---|
| LAN/web service MVP, company templates, repeatable decks | `pptxgenjs` or native OOXML generation in the job workspace | Preview/contact-sheet QA loop |
| Editing an existing `.pptx`, reusing a template, preserving master/layout grammar | OOXML unpack/edit/clean/pack in the job workspace | Slide-level visual QA |
| Complex cover, infographic, highly designed visual page, unusual canvas ratio | Embedded vector module | `spec_lock` + SVG checker + native PPTX export |
| Board/investor/strategy deck where narrative quality matters most | Presentations workflow as quality bar | Use service renderer only after claim spine and design system are locked |
| Data chart must remain editable as a chart | `pptxgenjs` native `addChart` | Do not turn that chart into a static visual insert |
| Poster/story/social/A4 output plus PPT handoff | Flexible canvas format | Export PPTX plus SVG/PDF previews |

Default for a production-ish LAN service: `pptxgenjs` or OOXML as the primary renderer, with the embedded vector module only for selected visual slides and Presentations as the QA bar, not the default service runtime.

## Service Pipeline

Use this artifact contract for every backend job:

1. Create a job workspace: `jobs/<job_id>/`.
2. Persist inputs: `request.json`, uploaded sources, selected template, and chat transcript.
3. Normalize sources into `sources.md` or structured tables.
4. Produce `outline.md`: audience, goal, page count, core claims.
5. Produce `design_system.json`: palette, fonts, chart style, icon policy, template choice.
6. Produce `slide_plan.json`: one record per slide with claim, proof object, layout, renderer route, source refs, and editability requirements.
7. Generate the draft `.pptx` using the selected primary route.
8. Render previews to PDF/PNG/JPG.
9. Run QA, fix issues, and re-render affected slides. Write `qa_report.md` only when `request.json.retainQaReport` is `true`; normal user jobs retain validation failures for repair but not a narrative QA report.
10. Return `final.pptx`, preview images/contact sheet, and a short change log to the web app.

Keep all intermediate files under the job workspace. Never overwrite a user template; copy it into the job workspace first.
An editable PPTX with text objects outside its slide bounds, or major text-to-text collisions inside the canvas, is a failed deliverable, even when its ZIP structure and slide count are valid.

Run the job contract validator before returning a completed job:

```bash
python3 src/server/pipeline/ppt-agent-pipeline/scripts/validate_job.py jobs/<job_id>
```

## Agent Conversation Rules

For a web chat agent, collect enough detail to avoid arbitrary decks:

- Purpose and audience.
- Desired page count or time limit.
- Source material and required facts.
- Company template or style constraints.
- Whether charts need to remain data-editable.
- Any explicit visual emphasis or delivery deadline.

Ask one compact clarification bundle when these are missing. After that, make conservative choices and proceed.

## Cost And Token Controls

- Keep user conversation summarization separate from slide generation. Write requirements once into `request.json` and reuse structured artifacts.
- Do not ask the model to rewrite a whole deck for a single-slide edit; patch `slide_plan.json` and regenerate affected slides.
- Prefer deterministic layout components for repeated slide types.
- Reserve vector-heavy rendering for slides whose visual complexity justifies higher token and time cost.
- Cache previews and source normalization outputs by job/version.
- For batches, reuse template layout recipes and structured planning outputs before expanding visual complexity.

## Quality Gate

Every generated deck must pass at least one render-and-fix loop:

1. Convert the `.pptx` to PDF or slide images.
2. Inspect for text overflow, overlaps, low contrast, broken images, wrong page order, leftover placeholders, bad wrapping, and chart label collisions.
3. Fix the source route, not only the rendered preview.
4. Re-render affected slides.
5. Do not ship until the final pass has no blocking visual or content defects.

P0/P1 defects always block delivery. When an admin-facing QA report is enabled, record any visible residual P2 issue there; otherwise fix visible P2 issues when feasible before delivery without persisting a report.

For detailed service architecture, routing, and QA guidance, read only the relevant reference:

- `references/service-architecture.md`
- `references/toolchain-router.md`
- `references/render-qa.md`

## Implementation Bias

- Prefer native editable objects over screenshots.
- Prefer native charts when users may update data later.
- Prefer company templates for repeatable internal use.
- Prefer deterministic scripts for fragile Office packaging steps.
- Treat vector-rendered pages as high-value visual inserts, not the default for every service job.
- Treat Codex Presentations as the quality model and optional Codex-local workflow, not the first service API to depend on.
