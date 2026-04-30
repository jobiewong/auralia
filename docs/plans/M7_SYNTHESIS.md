# Voice Synthesis Plan

## Summary

Implement document-level synthesis as a FastAPI background job that starts only after attribution review is complete and all used speakers have voices assigned. The backend will synthesize one audio clip per original span, internally chunking spans longer than three sentences into smaller Qwen calls, then merging those chunks back into a single span clip. Final output is one WAV file plus a JSON manifest.

## Backend Changes

- Add `auralia_api.synthesis` with `schemas.py`, `storage.py`, `service.py`, and `audio.py`.
- Add `POST /api/synthesize?force=false`:
  - Body: `{ document_id: string }`.
  - Returns immediately with `{ synthesis_job: { id, document_id, status } }`.
  - Uses FastAPI `BackgroundTasks`; persisted DB state remains the source of truth.
  - Returns `409` if synthesis already exists unless `force=true`.
- Add file endpoints:
  - `GET /api/synthesis/{job_id}/output` for the final WAV.
  - `GET /api/synthesis/{job_id}/manifest` for the generated manifest JSON.
- Add migration/schema support for job diagnostics:
  - `synthesis_jobs.error_report`
  - `synthesis_jobs.stats`
  - `synthesis_jobs.manifest_path`
  - optional segment metadata such as `cache_key`, `text_hash`, `chunk_count`, `duration_ms`.
- Store outputs under `data/outputs/<document_id>/<job_id>/`:
  - `segments/<span_id>.wav`
  - `chunks/<span_id>/<chunk_index>.wav`
  - `output.wav`
  - `manifest.json`

## Synthesis Rules

- Gate synthesis until:
  - segmentation exists,
  - attribution exists,
  - no attribution has `needs_review = true`,
  - no dialogue speaker is `UNKNOWN`,
  - `NARRATOR` has a voice mapping,
  - every non-UNKNOWN dialogue speaker used in attributed spans has a voice mapping,
  - mapped voices validate successfully,
  - mapped voices are `designed` or `hifi_clone`; plain `clone` voices are blocked with a clear `422`.
- Voice selection:
  - narration spans use speaker key `NARRATOR`,
  - dialogue spans use their attributed speaker.
- Span generation:
  - each original span produces one final span WAV and one `synthesis_segments` row,
  - if a span has more than three sentences, split it into deterministic sentence chunks of at most three sentences,
  - synthesize each chunk with the same mapped voice,
  - concatenate chunk WAVs into the span WAV.
- Assembly:
  - concatenate span WAVs in offset order using FFmpeg,
  - insert fixed default pauses between span clips,
  - produce one final WAV.
- Caching:
  - cache span clips by a hash of span text, voice id/profile fields, Qwen settings, chunking policy, and synthesis version,
  - reuse matching generated span WAVs on rerun when safe,
  - still write fresh job/manifest rows for each forced run.

## Frontend UI Proposal

- Keep the synthesis page as a compact production screen, not a wizard.
- Top summary band:
  - readiness state: blocked, ready, running, failed, completed,
  - blockers list: review flags, unknown speakers, missing narrator voice, missing speaker voices, unsupported clone voices,
  - counts: spans, dialogue speakers, mapped voices, generated clips.
- Main controls:
  - primary "Start synthesis" button when ready,
  - disabled button with visible blockers when not ready,
  - long-press/destructive "Regenerate" when output already exists,
  - output audio player and manifest/download links after completion.
- Progress area:
  - current job status from diagnostics polling,
  - generated span count vs total,
  - elapsed time using existing persisted job timestamps,
  - failed-job error summary with enough detail to fix the mapping or runtime config.
- Voice assignment helper:
  - show `NARRATOR` first,
  - then only speakers actually used in attributed dialogue,
  - link back to Cast/Text review for correction rather than duplicating the full editor.

## Test Plan

- Unit tests:
  - synthesis gate rejects missing attribution, `needs_review`, `UNKNOWN`, missing `NARRATOR`, missing speaker mappings, invalid voices, and unsupported `clone`,
  - sentence chunker splits spans into max-three-sentence chunks and preserves exact text reconstruction,
  - cache key changes when text, voice, or Qwen settings change.
- API tests:
  - `POST /api/synthesize` creates a background job row,
  - existing job returns `409`; `force=true` resets synthesis rows only,
  - successful fake-Qwen run writes segment rows, final WAV path, manifest path, and completed status,
  - failed Qwen/FFmpeg run stores `failed` plus `error_report`.
- Integration-style tests:
  - use `AURALIA_QWEN_TTS_TEST_FAKE=1` to generate tiny WAVs,
  - verify FFmpeg assembly path when FFmpeg is available; otherwise skip with a clear reason.
- Existing checks:
  - `pytest tests/ -q`
  - `ruff check apps/api/src tests`
  - `mypy apps/api/src/auralia_api`
  - web typecheck after adding frontend API bindings.

## Assumptions

- v1 uses FastAPI background tasks, not a separate persistent worker loop.
- v1 produces one WAV plus one JSON manifest per document/chapter.
- Review flags are a hard synthesis blocker.
- Reruns are blocked unless `force=true`.
- Plain `clone` voices remain unsupported for synthesis until their generation contract is defined.
