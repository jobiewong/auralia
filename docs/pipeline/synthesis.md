# Synthesis & assembly

Synthesis generates one audio clip per span using the assigned voices, then assembles all clips into a single WAV output file. It runs as a FastAPI background job, gated behind a set of readiness checks.

## Status

Backend synthesis is implemented and the frontend production UI is complete.

## Prerequisites

Synthesis will refuse to run (`422`) unless all of the following are true:

- Segmentation exists for the document.
- Attribution exists for the document.
- No attribution row has `needs_review = true`.
- No attributed dialogue speaker is `UNKNOWN`.
- `NARRATOR` has a voice mapping.
- Every non-UNKNOWN dialogue speaker used in attributed spans has a voice mapping.
- All mapped voices validate successfully.
- No mapped voice uses `clone` mode (only `designed` and `hifi_clone` are supported for synthesis).

These checks are deterministic and run synchronously before the background job is created.

## Job lifecycle

**`POST /api/synthesize`** — `{ "document_id": "..." }` → returns immediately with `{ synthesis_job: { id, document_id, status } }`.

The synthesis job runs asynchronously via FastAPI `BackgroundTasks`. The DB job row is the source of truth for status. Status values: `pending → running → completed | failed`.

**`POST /api/synthesize?force=true`** — resets any existing synthesis rows for the document and creates a new job.

**`GET /api/synthesis/{job_id}/output`** — streams the final assembled WAV.

**`GET /api/synthesis/{job_id}/manifest`** — returns the JSON manifest.

**Errors:**
- `404` — document or job not found.
- `409` — synthesis already exists; use `?force=true`.
- `422` — readiness gate failed with a list of specific blockers.

## Audio generation

For each span in document order:

1. **Voice selection:** narration spans use the `NARRATOR` voice mapping; dialogue spans use their attributed speaker's voice mapping.
2. **Sentence chunking:** if a span contains more than 3 sentences, it's split into chunks of at most 3 sentences each. Chunking is deterministic.
3. **Qwen synthesis:** each chunk is synthesized to a WAV via `qwen_tts.py` (the isolated subprocess).
4. **Chunk merge:** chunk WAVs are concatenated (with a configurable inter-chunk pause, default 325ms) into a single span WAV.
5. **Caching:** span clips are keyed by a hash of `(span text, voice id + profile fields, Qwen settings, chunking policy, synthesis version)`. On re-run, matching cached clips are reused.
6. **Segment row:** a `synthesis_segments` row is written with `span_id`, `audio_path`, `duration_ms`, `chunk_count`, `cache_key`, and `text_hash`.

## Final assembly

After all span clips are generated, FFmpeg concatenates them in span offset order using the concat demuxer. A configurable inter-span pause (default 400ms) is inserted between clips. The output is a single WAV file.

## Output layout

```
data/outputs/
  <document_id>/
    <job_id>/
      segments/
        <span_id>.wav      (one per span)
      chunks/
        <span_id>/
          <chunk_index>.wav
      output.wav           (final assembled audiobook)
      manifest.json        (span metadata + audio paths)
```

## Manifest format

```json
{
  "job_id": "...",
  "document_id": "...",
  "segments": [
    {
      "span_id": "...",
      "text": "...",
      "type": "narration",
      "speaker": "NARRATOR",
      "voice_id": "voice_...",
      "duration_ms": 2340,
      "audio_path": "data/outputs/.../segments/....wav"
    }
  ]
}
```

## Configuration

| Variable                                | Default | Description                              |
|-----------------------------------------|---------|------------------------------------------|
| `AURALIA_OUTPUT_STORAGE_PATH`           | `data/outputs` | Root path for synthesis output files |
| `AURALIA_SYNTHESIS_SPAN_PAUSE_MS`       | `400`   | Silence inserted between spans (ms)      |
| `AURALIA_SYNTHESIS_CHUNK_PAUSE_MS`      | `325`   | Silence inserted between sentence chunks (ms) |

## Code structure

```
apps/api/src/auralia_api/synthesis/
  __init__.py
  schemas.py   # Pydantic request/response models
  storage.py   # SQLite inserts/queries (mirrors Drizzle schema)
  service.py   # job planning, readiness gate, orchestration
  audio.py     # sentence chunking, WAV concatenation with FFmpeg
```

Tests: `tests/synthesis/` — uses `AURALIA_QWEN_TTS_TEST_FAKE=1` for WAV generation in tests; FFmpeg assembly tests skip cleanly when FFmpeg is unavailable.

## Frontend UI

The synthesis screen is a compact production view showing:
- Readiness state (blocked / ready / running / failed / completed) with a specific blockers list.
- A "Start synthesis" button when ready; disabled with visible blockers when not.
- Progress: current job status, span count progress, elapsed time.
- Output playback and manifest/download links after completion.
- A voice assignment helper showing `NARRATOR` first, then only speakers used in attributed dialogue, with links back to the Cast/Text views for corrections.
