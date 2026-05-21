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

## Blocking Defects

- Text clipped by its box or slide edge.
- Overlapping text, icons, charts, or footers.
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

For service logs, write all issues to `qa/qa_report.md` with slide number, severity, fix, and verification status.

Contact-sheet review should answer:

- Does the story flow make sense at thumbnail scale?
- Are page rhythms varied enough, or is every slide the same card grid?
- Are dense slides still readable?
- Are title sizes, footer placement, and accent colors consistent?
- Do section pages and ending pages feel intentional?

For vector-rendered slides, run SVG or layout checks before export. Treat `spec_lock` drift as a warning for `quick`/`standard` and a blocker for `polished`.

## Severity

- P0: file cannot open, corrupted PPTX, missing final artifact.
- P1: wrong fact, unreadable slide, clipped content, major template break.
- P2: visible alignment, spacing, contrast, or polish issue.
- P3: minor taste issue that does not block internal draft delivery.

Internal drafts may ship with documented P2/P3 issues only when the user requested speed. Polished or external decks should have no known P1/P2 issues.

## QA Report Shape

Keep `qa/qa_report.md` short but structured:

- Artifact paths and slide count.
- Preview/contact-sheet path.
- Checks run and commands used.
- Findings by severity and slide number.
- Fixes applied.
- Residual risk and whether it is acceptable for the selected preset.
