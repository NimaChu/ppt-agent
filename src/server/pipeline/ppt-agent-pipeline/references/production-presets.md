# Production Presets

Use this reference when implementing speed/cost/quality choices for a LAN or web PPT generation service.

## Quick

Goal: return an internal draft fast.

- Model work: clarify once, produce compact `outline.md` and `slide_plan.json`.
- Renderer: `pptxgenjs` or OOXML only.
- Vector route: skip unless the user explicitly asks for a complex visual page.
- QA: validate PPTX opens, slide count matches plan, scan placeholders, render first slide or a low-cost thumbnail.
- Expected issues: minor spacing and polish can remain if documented.
- Best for: brainstorming, meeting prep, internal first drafts.

## Standard

Goal: coworker-facing deck with reliable structure and reasonable polish.

- Model work: produce claim spine, design system, and per-slide route.
- Renderer: `pptxgenjs`/OOXML base; route at most 20-30% of pages to the embedded vector path when they need visual composition.
- QA: render full preview/contact sheet, scan placeholders, check overflow/overlap/contrast manually or with a layout checker.
- Expected issues: no P0/P1; documented P2 acceptable only if user chose speed.
- Best for: normal department decks, training decks, weekly reports.

## Polished

Goal: leadership/client/external deck.

- Model work: lock story, audience, visual system, page rhythm, and required facts before rendering.
- Renderer: use company template for consistency; allow the embedded vector path for cover, section dividers, frameworks, and important infographics.
- QA: full preview, layout JSON/checker where available, fix-and-rerender loop until no known P1/P2.
- Expected issues: no known P0/P1/P2.
- Best for: executive summaries, proposals, investor-style narratives.

## Token Budgeting

- Spend tokens on planning once, then generate from structured artifacts.
- Keep `slide_plan.json` terse and stable; avoid prose-heavy per-slide instructions.
- Reuse layout recipes for repeated slide types.
- Regenerate only changed slides when user asks for revisions.
- Use deterministic scripts for packaging, preview generation, placeholder scans, and validation.
- Log model-visible inputs per stage so failed jobs can resume without re-reading everything.

## Routing Budget

Default maximum share of vector-rendered slides:

- `quick`: 0%
- `standard`: 20-30%
- `polished`: 30-50%, higher only for design-heavy decks

Native editable charts should stay in `pptxgenjs` even in `polished`; vector chart-like visuals are best for static conceptual charts and infographics.
