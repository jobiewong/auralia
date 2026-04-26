## Overview

Building a local pipeline to turn prose (AO3/text files) into voice-cast audiobooks — fully offline, with a focus on character-aware TTS synthesis.

---

## Architecture

- **Backend:** FastAPI
- **Frontend:** React
- **Monorepo:** Turborepo for managing the backend/frontend packages together

---

## Tech Stack

- **Segmentation model:** Ollama running Qwen3 8B — used to split and tag text spans
- **Attribution model:** Ollama running Qwen3 8B (separate pass) — used to assign speakers to dialogue spans
- **TTS synthesis:** Local Qwen3-TTS — handles preview generation and voice-cast audio generation per character
- **Assembly:** FFmpeg — concatenates audio segments into final audiobook output
- **Validation layer:** hard-coded deterministic validators in backend (offset/overlap/coverage/schema checks)

---

## Pipeline Details

### 1. Ingestion: Scraping & Cleaning

Fetch prose from AO3 or local text files; strip HTML/tags and normalise whitespace before passing downstream.

### 2. Segmentation (Pass 1)

Split the cleaned text into spans, labelling each as `narration` or `dialogue`, and recording character offsets so spans can be precisely reassembled.

### 3. Attribution (Pass 2)

For each dialogue span, assign a speaker character using a second LLM pass — resolving pronouns and context where needed.

Unknown speakers must be returned as `UNKNOWN` and flagged for manual correction.

### 4. Voice Mapping + Manual QA Gate

A React UI lets you assign a local Qwen3-TTS voice profile to each detected character. Mappings and reusable voice profiles are stored in SQLite (with audio asset paths stored as filesystem references).

Any span with `speaker: UNKNOWN` (or low confidence) must be reviewed and corrected in the UI before synthesis can begin.

### 5. Synthesis & Export

Batch-generate audio for every span using the assigned voices, then concatenate with FFmpeg into a single (or chapter-split) output file.

---

## Data Contracts (Required)

Define explicit **SQLite-backed** contracts between every stage to prevent drift.

Storage model:

- **SQLite** (`data/db/auralia.sqlite`) for structured entities and pipeline state
- **Filesystem** for audio binaries (reference clips, generated segments, final outputs)
- File paths are stored in DB rows and validated before synthesis

### `cleaned_document` (table/contract example)

```json
{
  "source_id": "ao3:work:123456",
  "chapter_id": "ch_01",
  "title": "Chapter 1",
  "text": "...cleaned prose...",
  "text_length": 12345,
  "normalization": {
    "whitespace_normalized": true,
    "html_removed": true
  }
}
```

### `spans_pass1` (table/contract example)

```json
[
  {
    "id": "s_000001",
    "source_id": "ao3:work:123456",
    "chapter_id": "ch_01",
    "type": "narration",
    "text": "...",
    "start": 0,
    "end": 124
  }
]
```

### `spans_pass2_attributed` (table/contract example)

```json
[
  {
    "id": "s_000014",
    "type": "dialogue",
    "text": "...",
    "start": 2010,
    "end": 2098,
    "speaker": "Hermione",
    "speaker_confidence": 0.91,
    "needs_review": false
  },
  {
    "id": "s_000015",
    "type": "dialogue",
    "text": "...",
    "start": 2098,
    "end": 2140,
    "speaker": "UNKNOWN",
    "speaker_confidence": 0.22,
    "needs_review": true
  }
]
```

### `voice_registry` (table/contract example)

```json
[
  {
    "voice_id": "voice_hermione_v1",
    "display_name": "Hermione (Book 1)",
    "mode": "designed",
    "control_text": "calm, intelligent young woman, warm and clear",
    "reference_audio_path": null,
    "prompt_audio_path": null,
    "prompt_text": null,
    "cfg_value": 2.0,
    "inference_timesteps": 10,
    "is_canonical": true,
    "created_at": "2026-04-19T12:00:00Z"
  },
  {
    "voice_id": "voice_harry_clone_v1",
    "display_name": "Harry Clone",
    "mode": "clone",
    "control_text": "slightly energetic",
    "reference_audio_path": "data/voices/voice_harry_clone_v1/reference.wav",
    "prompt_audio_path": "data/voices/voice_harry_clone_v1/prompt.wav",
    "prompt_text": "exact transcript for prompt audio",
    "cfg_value": 2.0,
    "inference_timesteps": 10,
    "is_canonical": true,
    "created_at": "2026-04-19T12:05:00Z"
  }
]
```

### `voice_map` (table/contract example)

```json
{
  "narrator": "voice_narrator_01",
  "characters": {
    "Hermione": "voice_hermione_v1",
    "Harry": "voice_harry_clone_v1"
  }
}
```

### `synthesis_manifest` (table/contract example)

```json
{
  "job_id": "job_2026_04_19_001",
  "source_id": "ao3:work:123456",
  "chapter_id": "ch_01",
  "segments": [
    {
      "span_id": "s_000001",
      "speaker": "narrator",
      "voice_id": "voice_narrator_01",
      "audio_path": "audio/ch_01/s_000001.wav",
      "start": 0,
      "end": 124
    }
  ]
}
```

---

## Deterministic Validation Rules (Hard-Coded)

To reduce token usage and cost, perform these checks in backend code, not with LLMs:

1. **Schema validation** (required keys, types, ranges)
2. **Contiguity**: `next.start == prev.end`
3. **Non-overlap**: `next.start >= prev.end`
4. **Coverage**: first span starts at 0, final span ends at `len(cleaned_text)`
5. **Exact reconstruction**: `"".join(span.text)` equals cleaned text exactly
6. **Offset-text consistency**: `cleaned_text[start:end] == span.text`
7. **Dialogue attribution constraints**: dialogue spans must have `speaker` set; unknowns marked `UNKNOWN` + `needs_review: true`
8. **Synthesis preflight gate**: block synthesis if any `needs_review == true`
9. **Voice registry checks**:
   - every mapped `voice_id` must exist in `voice_registry`
   - `mode=clone` requires `reference_audio_path` to exist on disk
   - `mode=hifi_clone` requires `prompt_audio_path` + `prompt_text`

These validators should run after each pass and emit machine-readable error reports.

---

## Chunking & Offset Strategy

For long chapters exceeding context limits:

- Chunk cleaned text into fixed windows (e.g., ~2k–4k chars) with overlap (e.g., 150–300 chars)
- Run segmentation per chunk
- Convert local chunk offsets back to global offsets
- Deduplicate/reconcile overlap spans deterministically
- Re-run full-document hard checks after merge

---

## Quality Checks & Evaluation

### Runtime quality gates (deterministic first)

- 100% JSON parse success
- 100% offset/overlap/coverage/reconstruction pass before moving to next stage
- 0 unresolved `UNKNOWN` speakers at synthesis start

### Model-quality metrics (sampled)

- Segmentation label quality on a manually annotated eval set
- Speaker attribution accuracy/F1 on dialogue-only eval set
- Voice consistency QA (subjective review checklist)
- Throughput: seconds per 1k chars

---

## Hardware Considerations

Optimising for a machine with **32 GB RAM** and an **RTX 3080 (10–12 GB VRAM)**:

- Run Qwen3 8B at **Q4_K_M quantization** via Ollama (~5.2 GB model blob) for attribution.
- Run Qwen3-TTS locally through the `qwen-tts` Python package or a local worker process. Start with the 0.6B CustomVoice/Base models for preview iteration on 10-12 GB VRAM, then evaluate 1.7B variants if latency and memory are acceptable.
- Process attribution and synthesis sequentially (not concurrently) to avoid OOM errors.
- Keep TTS model weights under a local model cache or configured path so the pipeline is offline after the initial model download.

---

## System Prompts

These are the improved prompts for the Qwen3 segmentation step.

### System prompt (Segmentation Pass 1)

```text
You are a text segmentation engine.
Return ONLY valid JSON (UTF-8), no markdown, no prose.

Output schema (array of objects):
{
  "id": "string",
  "type": "narration" | "dialogue",
  "text": "string",
  "start": integer,
  "end": integer
}

Rules:
1) Segment the provided cleaned text into ordered spans.
2) Offsets are 0-based character offsets over the exact input text.
3) "start" is inclusive, "end" is exclusive.
4) Spans must be contiguous and non-overlapping.
5) Concatenating span.text in order must exactly reproduce input text.
6) Never alter characters, punctuation, or whitespace.
7) If uncertain, use type="narration".
8) If input is empty, return [].
```

### User prompt template (Segmentation Pass 1)

```text
Segment this cleaned prose into narration/dialogue spans.

INPUT:
{input_text}
```

### System prompt (Attribution Pass 2)

```text
You assign speakers to dialogue spans.
Return ONLY valid JSON array, no prose.

For each input dialogue span, output:
{
  "id": "string",
  "speaker": "string",
  "speaker_confidence": number,
  "needs_review": boolean
}

Rules:
1) Preserve one output item per input dialogue span id.
2) Use explicit character names when supported by context.
3) If uncertain, set speaker="UNKNOWN", low confidence, needs_review=true.
4) Do not change span ids or invent extra spans.
```

### User prompt template (Attribution Pass 2)

```text
Assign a speaker to each dialogue span using surrounding context.
If uncertain, return speaker as UNKNOWN and set needs_review=true.

CONTEXT:
{context_text}

DIALOGUE_SPANS:
{dialogue_spans_json}
```

Prompts remain intentionally terse, but deterministic hard-coded validation enforces structure and integrity at every stage.

---

## Recommended Focus for Hard-Coded Logic (to reduce cost)

Prioritize deterministic code in this order:

1. **Segment integrity validator** (highest ROI)
   - catches malformed offsets, overlap, drift, and text mismatch immediately.
2. **Chunk merge/reconciliation logic**
   - deterministic handling of overlap boundaries prevents repeated LLM retries.
3. **Attribution pre/post rules**
   - constrain candidate speaker names (from known cast), enforce `UNKNOWN` fallback.
4. **Synthesis preflight checks**
   - fail fast if any unresolved review flags or missing voice mappings.
5. **Caching and idempotency**
   - hash-based cache for repeated spans to avoid re-calling LLM/TTS.

Use LLM calls only for semantic tasks (segmentation labeling + speaker attribution), and keep everything else rule-based.
