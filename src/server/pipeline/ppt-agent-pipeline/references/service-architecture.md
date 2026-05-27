# Service Architecture

Use this reference when building the LAN/web backend around the PPT agent.

## Minimal Components

- Web chat UI: collects requirements, uploads files, shows job status and previews.
- Agent orchestrator: maintains conversation state, chooses route, writes job artifacts.
- Job runner: executes PPT generation in an isolated workspace.
- Preview renderer: converts `.pptx` to PDF and slide images.
- Artifact store: keeps source files, generated PPTX, previews and logs; keeps narrative QA reports only for administrator jobs.
- Queue: required once more than one user can submit jobs at the same time.

For a local network MVP, a single FastAPI/Express service plus a background worker is enough. Add Redis/RQ, BullMQ, Celery, or another queue when jobs become concurrent or long-running.

## Job Workspace

Recommended layout:

```text
jobs/<job_id>/
  request.json
  transcript.md
  sources/
  normalized/sources.md
  planning/outline.md
  planning/design_system.json
  planning/slide_plan.json
  working/
    renderer/
    vector/
    ooxml/
  preview/
    contact-sheet.png
    slide-001.png
  qa/qa_report.md       # optional, administrator jobs only
  logs/
    stages.jsonl
  output/final.pptx
```

Persist `request.json`, `slide_plan.json`, validator failures and repair feedback on failure. Persist `qa_report.md` only for jobs with administrator-facing QA enabled.

Recommended `request.json` keys:

- `generation_mode`: currently `direct`, reserved only for future measured workflow variants.
- `audience`, `purpose`, `page_count`, `language`.
- `template_id` or copied template path.
- `editable_charts_required`: boolean.
- `allowed_routes`: subset of `pptxgenjs`, `ooxml`, `vector`.
- `source_policy`: whether placeholders are allowed when facts are missing.

Recommended `slide_plan.json` slide keys:

- `title`, `claim`, `proof_object`, `layout`, `route`.
- `source_refs`: source file/page/row identifiers.
- `editable_requirements`: chart/table/text/image constraints.
- `qa_expectations`: known risk areas such as dense text or chart labels.

Before returning a completed job, run:

```bash
python3 ${SKILL_DIR}/scripts/validate_job.py jobs/<job_id> --require-final
```

When running from the ppt-agent app root, the bundled validator path is:

```bash
python3 src/server/pipeline/ppt-agent-pipeline/scripts/validate_job.py jobs/<job_id> --require-final
```

Add `--require-qa` only for administrator jobs that retain `qa/qa_report.md`.

## API Shape

Keep the service API boring:

- `POST /jobs`: create a generation job from prompt, files, template id, and options.
- `GET /jobs/:id`: return status, current stage, warnings, and artifact links.
- `POST /jobs/:id/messages`: add user feedback or edit instructions.
- `POST /jobs/:id/revise`: regenerate one requested slide from user feedback.
- `GET /jobs/:id/download`: return the final `.pptx`.

Generation can be async. Return a job id immediately, then stream or poll status.

Use explicit job stages: `queued`, `clarifying`, `normalizing`, `planning`, `rendering`, `previewing`, `qa`, `fixing`, `complete`, `failed`, `cancelled`.

## Backend Agent Contract

The agent must write structured artifacts before generating the deck:

- `outline.md`: claims and deck flow.
- `design_system.json`: palette, fonts, template, chart style.
- `slide_plan.json`: per-slide title, claim, proof object, route, source refs.

Do not let the renderer invent missing facts. If required source data is absent, mark the slide as needing user input or use a clearly labeled placeholder only when the user allowed drafting.

For edits, preserve the same contract:

- Patch `request.json` with the user's new instruction.
- Patch only affected slide records in `slide_plan.json`.
- Regenerate affected slides or affected OOXML parts.
- Re-render previews for changed slides and refresh the contact sheet.
- Append the change to `logs/stages.jsonl`, and to `qa/qa_report.md` only when administrator-facing QA retention is enabled.

## Security Defaults

- Restrict file access to the job workspace and approved template/assets directories.
- Scan uploaded file names and normalize them before writing to disk.
- Do not execute arbitrary user-provided scripts or macros from uploaded Office files.
- Disable external network fetches by default for intranet deployments unless explicitly needed.
- Log model prompts and tool outputs only if the organization accepts that data retention.

## Operational Defaults

- Give each job a timeout and cancellation path.
- Cache rendered previews, but regenerate them after every deck edit.
- Keep original user uploads immutable.
- Version templates by id, not by mutable path alone.
- Return partial artifacts on failure: plan, logs, preview of completed slides, and a clear error stage.
- Keep model prompts stage-scoped so failed jobs resume from the latest structured artifact rather than re-reading the whole transcript.
- Store renderer decisions per slide; route drift is a debugging signal.
