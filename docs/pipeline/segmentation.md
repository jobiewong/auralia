# Segmentation

Segmentation splits the cleaned document text into an ordered list of `narration` and `dialogue` spans, each with exact character offsets. These spans are the atomic unit consumed by all downstream stages.

## Approach

Segmentation uses a **deterministic O(n) quote-pair splitter** (`quote_segmenter.py`). No LLM is involved.

### Why not LLM?

During development, `qwen3:8b` and `qwen2.5:7b` were tested on offset-emission tasks with `format: "json"` and temperature 0. Both produced degenerate alternating-number patterns that broke text mid-word and mis-labeled narration as dialogue even on simple inputs. Since the ingestion pipeline normalizes every curly/angle double quote to ASCII `"`, a paired-quote splitter gives near-perfect labels for standard English prose at zero cost. LLM work is concentrated in attribution, where offsets are not required from the model.

### Algorithm

The segmenter scans the text character by character, tracking opening and closing `"` pairs:

1. Everything before an opening `"` is a narration span.
2. The text from `"` to the matching closing `"` (inclusive) is a dialogue span.
3. An unmatched opening `"` with no closing pair produces a single narration span to EOF (safe default — never silently closes an unmatched quote).
4. Adjacent dialogues with no narration between them produce an empty narration span, which is filtered out before output.

The result is a contiguous, non-overlapping sequence of spans covering exactly `[0, len(text))`.

### Validators

After segmentation, five deterministic validators run before any span is persisted:

1. **Contiguity:** `span[i].end == span[i+1].start` for all adjacent pairs.
2. **Non-overlap:** `span[i+1].start >= span[i].end`.
3. **Coverage:** first span starts at 0; final span ends at `len(text)`.
4. **Exact reconstruction:** `"".join(span.text for span in spans) == document.text`.
5. **Offset-text consistency:** `document.text[span.start:span.end] == span.text` for every span.

Any failure raises `SegmentationValidationError` with a machine-readable report and persists a `failed` segmentation_jobs row. The pipeline does not advance past a failed segmentation.

## API

**`POST /api/segment`** — `{ "document_id": "..." }` → segmentation job + spans.

**`POST /api/segment?force=true`** — re-runs segmentation for a document that already has spans. Before re-running, cascades downstream deletes:
- All spans for the document.
- Attribution rows and jobs.
- Generated cast members, cast evidence, and cast detection jobs.
- Synthesis segments and synthesis jobs.

Manual cast edits/deletions (`manually_edited` or `manually_deleted` flag set) are preserved through force reruns.

**Errors:**
- `404` — document not found.
- `409` — spans already exist; use `?force=true`.
- `422` — validation failure with machine-readable report.

## Code structure

```
apps/api/src/auralia_api/segmentation/
  __init__.py
  schemas.py           # Pydantic request/response models
  quote_segmenter.py   # pure-Python O(n) splitter
  service.py           # orchestration: segment → validate → persist
  storage.py           # SQLite inserts (mirrors Drizzle schema)
  ollama_client.py     # Ollama HTTP client (retained for attribution reuse)
```

Tests: `tests/segmentation/` — `test_quote_segmenter.py`, `test_segmentation_api.py`, `test_ollama_client.py`.

## Known limitations

- **British single-quote dialogue** (`'...'`) is not detected. Single quotes conflict with apostrophes and possessives, so only ASCII double quotes are used as dialogue delimiters.
- **Nested double quotes** (e.g. `"He said "wait!" then left."`) mis-pair, producing a spurious narration segment inside what is semantically one speech act. Rare in standard AO3 prose.
- **Unmatched opening quotes** produce a safe narration-to-EOF span. This should be surfaced in observability (M8) since it often indicates a genuine OCR or copy-paste artifact in the source text.
