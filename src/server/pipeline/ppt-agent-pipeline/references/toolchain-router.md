# Toolchain Router

Use this reference when selecting or combining local PPT toolchains.

## Route A: Native PowerPoint Generation (`pptxgenjs` / OOXML)

Use for:

- Service-first generation where stability matters.
- Company templates and brand-controlled decks.
- Existing `.pptx` edits.
- Native editable charts.
- Precise slide insertion, deletion, and text replacement.

Important constraints:

- `pptxgenjs` does not natively support gradient fills; use images or simpler fills.
- Use proper bullet options, not Unicode bullet characters.
- Use fresh option objects for repeated shapes because `pptxgenjs` mutates options.
- Render after every non-trivial edit; XML-valid output can still look wrong.

## Route B: Embedded Vector-To-PowerPoint

Use for:

- Complex visual pages where SVG is easier for the model to author than direct PPT objects.
- Highly designed cover pages, visual frameworks, infographics, and alternate canvas formats.
- Editable vector output where a screenshot would be unacceptable.

Important constraints:

- Native charts are not the strength; chart-like outputs are usually editable shapes, not Excel-bound charts.
- Use it as a module for selected slides in a service pipeline unless the whole deck needs its visual/canvas model.

## Route C: Presentation Quality Bar

Use for:

- High-polish deck planning.
- Reference-beating work, investor/strategy narratives, and design QA standards.
- Learning the expected story and contact-sheet quality bar.

Important constraints:

- It is heavier than a simple LAN service renderer.

## Hybrid Pattern

For most internal web-agent jobs:

1. Plan with Presentations-style claim spine and design system.
2. Render common slides with `pptxgenjs` or template OOXML.
3. Render complex visual inserts with the embedded vector-to-PowerPoint path.
4. Merge or insert visual slides into the final deck.
5. Run preview/contact-sheet QA over the final `.pptx`.
6. Patch the source route and rerender, never patch only the bitmap preview.

## Practical Ranking

For the LAN chat-to-PPT service case:

| Dimension | Best default | Why |
|---|---|---|
| Speed | `pptxgenjs` / OOXML | deterministic scripts and fewer model-authored layout details |
| Token use | `pptxgenjs` / OOXML | layouts/components can be reused as code |
| General visual quality | presentation-quality planning | strongest planning and preview discipline |
| Complex editable visuals | embedded vector path | SVG is easier to author for frameworks and infographics |
| Data-editable charts | `pptxgenjs` | creates native chart objects |
| Service maintainability | `pptxgenjs` / OOXML base | easiest to queue, retry, diff, and patch |

Use this ranking as a routing bias, not a hard rule.

## Decision Rules

- Need user-editable data chart: choose `pptxgenjs`.
- Need pixel-rich visual composition but still editable shapes: choose the embedded vector route for that slide.
- Need to preserve a corporate deck template: choose OOXML editing.
- Need a one-off, high-quality deck: use the presentation quality bar before rendering.
- Need repeatable LAN product behavior: choose `pptxgenjs`/OOXML as the base and wrap everything in job artifacts.
- Need many similar decks: create reusable slide recipes before improving prompts.
- Need high polish under time pressure: generate the deck once, inspect the contact sheet, then revise only slides that warrant stronger visual treatment.

## Anti-Patterns

- Sending every slide through a vector-heavy route by default for an internal service.
- Using screenshot-only slides when the user expects editable PPT.
- Letting the model invent data to make a chart look complete.
- Replanning the full deck for a small wording or one-slide edit.
- Treating a valid PPTX ZIP as sufficient QA without rendered previews.
