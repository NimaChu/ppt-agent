# Render QA

Use this reference when verifying a generated `.pptx`.

## Required Loop

1. Export the deck to PDF or slide images.
2. Build a contact sheet when the deck has more than 5 slides.
3. Inspect the rendered slides, not just the source code.
4. Fix source files or generation code.
5. Re-render affected slides.
6. Ship only after blocking defects are gone.

## Suggested Commands

Use LibreOffice when available:

```bash
soffice --headless --convert-to pdf --outdir preview output/final.pptx
pdftoppm -jpeg -r 150 preview/final.pdf preview/slide
```

If using the PowerPoint skill's helper scripts, prefer its `scripts/office/soffice.py` wrapper when present.

Before returning a final job artifact:

```bash
python3 ${SKILL_DIR}/scripts/validate_job.py jobs/<job_id> --require-final
```

When running from the ppt-agent app root, the bundled validator path is:

```bash
python3 src/server/pipeline/ppt-agent-pipeline/scripts/validate_job.py jobs/<job_id> --require-final
```

For administrator jobs that retain a narrative QA report, add `--require-qa`.

## Blocking Defects

- Text or other meaningful content written wholly outside the slide canvas because layout units were mis-scaled. `pptxgenjs` geometry is specified in inches, not 1280 x 720 pixel coordinates.
- Text clipped by its box or slide edge.
- Overlapping text, icons, charts, or footers. The bundled validator blocks major text-to-text collisions such as a title intersecting a claim bar; rendered review remains required for subtler visual defects.
- Placeholder text left in the deck.
- Missing images or broken media links.
- Low contrast that makes text unreadable.
- Wrong data, wrong page order, or missing required slide.
- Chart labels colliding or contradicting source data.
- Corporate template artifacts left unused or half-empty.

## Useful Checks

Text extraction:

```bash
python -m markitdown output/final.pptx
```

Placeholder scan:

```bash
python -m markitdown output/final.pptx | grep -iE "xxxx|lorem|ipsum|placeholder|todo|this.*(page|slide).*layout"
```

When `request.json.retainQaReport` is `true`, write issues to `qa/qa_report.md` with slide number, severity, fix, and verification status. For standard user jobs, retain only validator failures needed for repair.

Contact-sheet review should answer:

- Does the story flow make sense at thumbnail scale?
- Are page rhythms varied enough, or is every slide the same card grid?
- Are dense slides still readable?
- Are title sizes, footer placement, and accent colors consistent?
- Do section pages and ending pages feel intentional?

For vector-rendered slides, run SVG or layout checks before export. Treat material `spec_lock` drift as a blocking template-fidelity defect.

## Internal Visual Review Rubric

For administrator jobs, record concise internal findings in `qa/qa_report.md`. Standard user jobs do not persist this report; users only need pass/fix progress.

Score each dimension from 1 to 10 and name concrete fixes when a dimension is below 8:

- Visual hierarchy: each slide has one obvious reading entry and one core claim.
- Craft quality: spacing, alignment, colors, typography and image crops are consistent.
- Communication function: every visual element clarifies content; unsupported filler metrics or decoration are absent.
- Style and brand consistency: selected template grammar and supplied brand assets remain consistent.
- Originality and restraint: the deck avoids generic AI decoration and repetitive page rhythm.

For PPT decks, visual hierarchy and communication function are blocking quality dimensions. Do not ship a job with a known issue below 8 in either dimension.

## Severity

- P0: file cannot open, corrupted PPTX, missing final artifact.
- P1: wrong fact, unreadable slide, clipped content, major template break.
- P2: visible alignment, spacing, contrast, or polish issue.
- P3: minor taste issue that does not block internal draft delivery.

P0/P1 issues must be fixed before delivery. Document residual P2/P3 concerns internally and fix visible P2 issues when feasible before delivery.

## QA Report Shape (When Enabled)

Keep `qa/qa_report.md` short but structured:

- Artifact paths and slide count.
- Preview/contact-sheet path.
- Checks run and commands used.
- Findings by severity and slide number.
- Fixes applied.
- Residual risk and whether it is acceptable for delivery.
