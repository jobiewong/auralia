# M4 — Attribution Pass Implementation Plan

> Standalone implementation reference. Assigns speakers to dialogue spans produced by M3 (deterministic quote segmenter), flags low-confidence attributions for manual review, and persists results into the existing `attributions` table.

---

## Implementation Status (last updated 2026-04-20)

**Status:** ⏸ Paused / accepted for now. Pipeline, validators, API, and test coverage are delivered, and local runtime results are satisfactory for current product work. Evaluation-only work is deferred: the hand-labeled benchmark fixture set, opt-in benchmark runner, and measured prompt/threshold tuning.

**Delivered**
- `apps/api/src/auralia_api/attribution/` — `__init__.py`, `prompts.py`, `roster.py`, `pre_pass.py`, `windower.py`, `parser.py`, `validators.py`, `service.py`, `storage.py`, `schemas.py`
- Drizzle migration `0004_m4_attribution_jobs.sql` + Python bootstrap mirror
- `POST /api/attribute` endpoint with 404/409/422/502 error mappings
- Config additions in `auralia_api.config`: `attribution_model`, `attribution_confidence_threshold`, `attribution_max_window_dialogues`, `attribution_max_window_chars`, `attribution_max_gap_chars`, `attribution_max_retries`
- Tests under `tests/attribution/` (44 passing): `test_pre_pass.py`, `test_windower.py`, `test_parser.py`, `test_prompts.py`, `test_roster.py`, `test_validators.py`, `test_service.py`, `test_attribution_storage.py`, `test_attribution_api.py`
- Repo-wide checks green: `pytest tests/ -q` → 103 passed; `ruff check apps/api/src tests` clean; `mypy apps/api/src/auralia_api` clean

**Outstanding**
- Benchmark fixture set (20 hand-labeled chapter excerpts covering alternation, pronoun tags, group speech, split dialogue, nested quotes) under `tests/attribution/fixtures/eval_set/`
- `tests/attribution/test_benchmark.py` — opt-in gated test that reports accuracy / F1 / `UNKNOWN` rate / deterministic pre-pass hit rate / sec-per-1k-chars
- End-to-end smoke test against a live Qwen3 8B Ollama instance; iterate on prompts and confidence threshold if measured accuracy is weak

---

## Goal

Given a document with validated narration/dialogue spans from M3, produce exactly one attribution row per dialogue span with:

- `speaker` — canonical character name (or `"UNKNOWN"`)
- `speaker_confidence` — float in `[0, 1]`
- `needs_review` — boolean

Unresolvable dialogue must be flagged so the M6 review UI can block M7 synthesis until resolved.

## Design constraints carried over from the project

- **Offline, local-only:** all LLM calls go through Ollama; no external APIs.
- **Deterministic-first:** run deterministic logic wherever it is high-precision; LLM only for genuinely semantic tasks.
- **Hard-coded validators, not LLM validators:** every LLM output is checked against deterministic rules before it's trusted.
- **Input is M3 output:** dialogue spans are identified by bracketed ASCII `"..."` ranges. Narration spans cover everything else.
- **Schema is fixed:** `attributions` (existing) + new `attribution_jobs` table. No changes to `spans`.

---

## Pipeline Overview

Four stages, in order:

```
 M3 spans
    │
    ▼
┌────────────────────────────┐
│ A. Character roster (LLM)  │ — one call per document
└─────────────┬──────────────┘
              │ roster: [{canonical_name, aliases, descriptor}]
              ▼
┌────────────────────────────┐
│ B. Deterministic tag       │ — regex + roster lookup; produces
│    pre-pass (pure Python)  │   high-confidence attributions for
└─────────────┬──────────────┘   obvious "X said" patterns
              │ resolved set, unresolved set
              ▼
┌────────────────────────────┐
│ C. LLM windowed attribution│ — only unresolved dialogue spans;
│    (batched by window)     │   resolved ones are included as
└─────────────┬──────────────┘   LOCKED context for alternation
              │ all dialogue spans attributed
              ▼
┌────────────────────────────┐
│ D. Merge + validate +       │
│    persist                  │
└────────────────────────────┘
```

Each stage's output is validated before the next stage runs.

---

## Stage A — Character Roster Extraction

> Current implementation note: roster discovery has moved into the dedicated
> M4.5 Cast Detection stage. Attribution now loads persisted
> `document_cast_members` (falling back to legacy `documents.roster`) and
> refuses to run when no cast/legacy roster exists. The original full-document
> roster extraction described below is retained as historical design context and
> for parser/prompt reference.

**Purpose:** produce a bounded set of canonical speakers so stages B and C cannot hallucinate names. Serves as the candidate set for attribution.

**Input:** full cleaned document text (or the concatenated first + last N paragraphs if the text is very long — M4 MVP uses full text).

**Output (JSON):**
```json
{
  "characters": [
    {
      "canonical_name": "Harry",
      "aliases": ["Harry Potter", "Potter", "Mr. Potter"],
      "descriptor": "teenage wizard, POV character in this chapter"
    },
    { "canonical_name": "Ron", "aliases": ["Ron Weasley", "Weasley"], "descriptor": "..." },
    { "canonical_name": "Seamus", "aliases": ["Seamus Finnigan"], "descriptor": "..." }
  ]
}
```

**Canonicalization rule:** the `canonical_name` is the shortest unambiguous reference used in the text (typically the first name). Aliases include honorifics, surnames, full names, and any nicknames that appear in the text. Pronouns (`he`, `she`, `they`) are NOT aliases — they're handled by context in stages B/C.

**Validators (post-LLM):**
1. Valid JSON with `characters` key and list value.
2. Each entry has string `canonical_name` and list `aliases`.
3. No duplicate canonical names.
4. No alias shared across two canonical entries.
5. Roster is non-empty unless the document has zero dialogue spans.

Failures retry up to N times, then surface as a 422 with a machine-readable report (same pattern as M3's `SegmentationValidationError`).

**Persistence:** cached in `attribution_jobs.stats` so a re-run can reuse roster without a fresh LLM call unless explicitly forced.

---

## Stage B — Deterministic Tag Pre-Pass

**Purpose:** resolve obvious `X said` / `said X` patterns deterministically. Removes ~40–70% of dialogue spans from the LLM workload, gives free alternation anchors to the windowed pass, and cannot hallucinate speakers (the name must already be in the roster).

### Input
- Full span list from M3
- Character roster from Stage A (flat set of aliases + canonicals)

### Algorithm

For each dialogue span `D[i]`:
1. Gather `narration_before` = narration span immediately preceding `D[i]` (if any).
2. Gather `narration_after` = narration span immediately following `D[i]` (if any).
3. Apply the tag patterns below, in order, against both adjacent narrations:
   - **P1 — Post-dialogue named tag:** immediately after `D[i]` matches `^\s*[,.!?]?\s*(<alias>)\s+(said|asked|replied|answered|whispered|shouted|yelled|called|cried|murmured|muttered|added|continued|snapped|drawled|breathed|hissed|growled|grumbled|sighed|exclaimed|mumbled|gasped|laughed|grinned|agreed|admitted|protested|insisted|interrupted)\b`
   - **P2 — Post-dialogue inverted tag:** immediately after `D[i]` matches `^\s*[,.!?]?\s*(said|asked|...)\s+(<alias>)\b` (same verb list).
   - **P3 — Pre-dialogue tag:** `narration_before` ends with `(<alias>)\s+(said|asked|...)[,:]\s*$` or `(said|asked|...)\s+(<alias>)[,:]\s*$`.
   - **P4 — Post-dialogue name + adverb:** `^\s*[,.!?]?\s*(<alias>)\s+(said|asked|...)(\s+\w+)?` (supports "Harry said softly").
4. If exactly one pattern matches and yields exactly one alias from the roster → resolved. Record `speaker = canonical(alias)`, `confidence = 1.0`, `source = "deterministic_tag"`.
5. If multiple distinct aliases match the patterns → ambiguous; leave unresolved.
6. If only pronouns (`he`, `she`, `they`) appear → leave unresolved (never resolved deterministically).

### Tuning knobs

- **Verb list** is closed and conservative at MVP. Unusual verbs ("chirped", "intoned") fall through to the LLM. This is deliberate: false positives are worse than false negatives.
- **Search window**: only the adjacent narration span (not arbitrary text). This keeps precision high.
- **Capitalization:** aliases match case-sensitively by default. Lowercased matches at sentence start ("Harry said") match because aliases start capitalized. Non-capitalized matches anywhere else are rejected (guards against "when harry's..." style false matches).

### Output

Two span sets:
- `resolved`: `dict[span_id → {speaker, confidence=1.0, source="deterministic_tag"}]`
- `unresolved`: list of dialogue span ids not yet attributed.

### Tests

- Trailing named tag: `"Hello," Harry said.` → resolved Harry.
- Trailing inverted tag: `"Hello," said Harry.` → resolved Harry.
- Leading tag: `Harry said, "Hello."` → resolved Harry.
- Named tag with adverb: `"Hello," Harry said softly.` → resolved Harry.
- Pronoun-only tag: `"Hello," he said.` → unresolved.
- Ambiguous tag: `"Hello!" said Harry and Ron together.` → unresolved (multi-alias).
- Unknown verb: `"Hello," Harry chirped.` → unresolved (verb not in list).
- Name mid-narration, not in tag position: `Earlier that day Harry had walked in. "Hello."` → unresolved.
- Name not in roster: `"Hello," Dobby said.` with Dobby missing from roster → unresolved.
- Dialogue at chapter start with no narration before/after → unresolved (nothing to match against).

---

## Stage C — LLM Windowed Attribution

**Purpose:** attribute only the *unresolved* dialogue spans, batched by conversation window so the model can reason about alternation.

### Windowing (deterministic, pure Python)

Input: the full ordered span list plus the resolved/unresolved split from Stage B.

For window grouping, iterate over **all dialogue spans in document order** (both resolved and unresolved — resolved ones will be included in the prompt as locked context but not asked about). Start a new window when ANY of:

- Narration gap between this dialogue and the next exceeds `MAX_GAP_CHARS = 400`.
- A double blank line or chapter heading sits between them.
- The current window has `MAX_WINDOW_DIALOGUES = 12` dialogue spans.
- The current window's prompt would exceed `MAX_WINDOW_CHARS = 6000`.

Windows without any unresolved dialogue are skipped entirely (no LLM call needed).

Each window prompt includes:
- Up to `200` chars of narration before the first dialogue in the window (pre-context to establish "who walked in").
- All in-window narration verbatim between spans.
- Up to `100` chars of narration after the last dialogue.
- All dialogue spans (resolved + unresolved), in document order, each with: `id`, `type`, `text`, `locked` boolean, and if `locked=true`, the already-assigned `speaker`.

### Prompts

**System prompt (attribution)**
```
You assign speakers to dialogue spans.

Rules:
1. Pick speaker from the provided ROSTER only. Use canonical_name values verbatim. If uncertain, emit "UNKNOWN".
2. Emit speaker_confidence in [0, 1]. Use >= 0.8 only when the speaker is clearly supported by surrounding text or strict alternation with an earlier named speaker.
3. Do NOT change speakers for entries marked "locked": true. Output them unchanged. They are provided as context for alternation inference.
4. In rapid exchanges where only the first speaker is tagged, default to strict alternation between the two most recently named speakers unless content clearly contradicts.
5. Split dialogue with an interrupting narration tag (e.g. "I think," he said, "we should go.") shares a speaker across both halves.
6. Do not invent new names, do not merge span ids, do not add extra spans.
7. Output JSON only, no prose, no markdown. Schema:
   { "attributions": [ { "id": string, "speaker": string, "speaker_confidence": number, "reasoning_brief": string } ] }
```

**User prompt template**
```
ROSTER:
{roster_json}

PRIOR_NARRATION:
{pre_context_text}

WINDOW (in document order; "locked" entries already have a correct speaker assigned):
{window_blocks}

POST_NARRATION:
{post_context_text}

Return an "attributions" array with one entry per span id above (including locked ones, unchanged).
```

Each `window_block` is formatted as:
```
[id=span_doc_abc_0005, type=dialogue, locked=false]
text: "Still can't believe you're going with Susan Bones, Harry,"

[id=span_doc_abc_0006, type=narration]
text: Seamus said with a shake of his head.

[id=span_doc_abc_0007, type=dialogue, locked=true, speaker=Seamus]
text: "Now there's a girl with some serious curves."
```

Keeping narration in the prompt inline is critical for pronoun resolution and alternation.

### Parser / validators (per window)

1. Valid JSON with `attributions` key and list value.
2. Exactly one entry per dialogue span id in the window (locked + unlocked).
3. No extra or missing ids.
4. Locked entries must come back with their original `speaker` unchanged; if not, reject and retry.
5. `speaker` for unlocked entries ∈ roster canonical names ∪ `{"UNKNOWN"}`.
6. `speaker_confidence` is a number in `[0, 1]`.

Retry on failure up to `MAX_RETRIES = 3` with the error included in the prompt (same pattern as M3 had).

### Confidence → review flag

After parsing, apply a deterministic review policy:
- `speaker == "UNKNOWN"` → `needs_review = true`.
- `speaker_confidence < CONFIDENCE_THRESHOLD` (default `0.7`) → `needs_review = true`.
- Otherwise → `needs_review = false`.
- Resolved (Stage B) entries always get `needs_review = false, confidence = 1.0`.

---

## Stage D — Merge, Validate, Persist

### Merge

Combine:
- Stage B resolved set
- Stage C windowed output (converted back to full attribution objects)

Final shape per dialogue span:
```json
{
  "span_id": "span_doc_abc_0005",
  "speaker": "Harry",
  "speaker_confidence": 0.94,
  "needs_review": false,
  "source": "llm_windowed"  // or "deterministic_tag"
}
```

### Cross-stage validators (deterministic, hard-coded — all must pass)

1. Every `dialogue` span in the document has exactly one attribution.
2. No `narration` span has an attribution.
3. `speaker ∈ roster.canonical_names ∪ {"UNKNOWN"}`.
4. `speaker == "UNKNOWN"` ⇔ one of (confidence < threshold) or `source == "llm_windowed"` with explicit UNKNOWN.
5. Unique `span_id` in attribution set.
6. `speaker_confidence ∈ [0, 1]`.

Any failure raises `AttributionValidationError` with a machine-readable report and persists a `failed` attribution_jobs row (mirrors M3).

### Persist

- Insert one row per attribution into `attributions`.
- Insert one `attribution_jobs` row with status `completed`, roster snapshot, and stats:
  ```json
  {
    "model_name": "qwen3:8b",
    "roster_size": 5,
    "dialogue_count": 42,
    "deterministic_resolved": 28,
    "llm_resolved": 14,
    "windows": 4,
    "tokens": { "prompt": 0, "completion": 0 },
    "timings_ms": { "roster": 0, "pre_pass": 0, "windowed": 0 }
  }
  ```

---

## Module Layout

```
apps/api/src/auralia_api/attribution/
  __init__.py
  prompts.py        # roster + attribution system/user templates
  roster.py         # character-roster extraction (LLM call A)
  pre_pass.py       # deterministic regex tag matcher (Stage B)
  windower.py       # conversation-window grouping (Stage C)
  parser.py         # JSON validation for roster + attribution responses
  validators.py     # cross-stage attribution validators (Stage D)
  service.py        # pipeline orchestration: A -> B -> C -> D
  storage.py        # SQLite inserts for attribution_jobs + attributions
  schemas.py        # Pydantic request/response models
```

Reuses `segmentation/ollama_client.py` (already kept for this purpose in M3).

---

## API

### `POST /api/attribute`

**Request**
```json
{ "document_id": "doc_abc_123" }
```

**Response 201**
```json
{
  "attribution_job": {
    "id": "attr_...",
    "document_id": "doc_abc_123",
    "status": "completed",
    "model_name": "qwen3:8b",
    "stats": { ... }
  },
  "roster": [ { "canonical_name": "Harry", "aliases": [...], "descriptor": "..." }, ... ],
  "attributions": [
    { "span_id": "span_...", "speaker": "Harry", "speaker_confidence": 1.0, "needs_review": false, "source": "deterministic_tag" },
    ...
  ]
}
```

**Errors**
- `404` — document not found.
- `409` — document already attributed; call `POST /api/attribute?force=true` to delete existing attribution rows and re-run.
- `422` — validator failure. Body contains the machine-readable report.
- `502` — Ollama unavailable.

---

## Data Model

- **`attributions`** (existing, `schema.ts:66`) — no changes.
- **`attribution_jobs`** (new, `packages/db/drizzle/migrations/0004_m4_attribution_jobs.sql`) — mirrors `segmentation_jobs` shape:
  ```
  id TEXT PRIMARY KEY
  document_id TEXT NOT NULL FK documents(id) ON DELETE CASCADE
  status TEXT CHECK IN ('pending','running','failed','completed')
  model_name TEXT
  stats TEXT        -- JSON (see above)
  error_report TEXT -- JSON on failure
  completed_at
  created_at / updated_at
  INDEX idx_attribution_jobs_document_status ON (document_id, status)
  ```

Add a matching bootstrap mirror in `attribution/storage.py` (same pattern as `segmentation/storage.py`).

Attribution is downstream of cast detection. Forced segmentation and
cast-detection reruns delete stale attribution rows/jobs as part of the
pipeline reset contract documented in `docs/plans/IMPLEMENTATION_PLAN.md`.

---

## Tests

### Unit (no LLM)

- `tests/attribution/test_pre_pass.py`
  - All patterns P1–P4 positive cases
  - Pronoun-only → unresolved
  - Ambiguous alias → unresolved
  - Unknown verb → unresolved
  - Name not in roster → unresolved
  - Edge dialogues (first/last in doc) → unresolved
- `tests/attribution/test_windower.py`
  - Single window end-to-end
  - Scene break splits into two windows
  - Max-dialogue-count splits
  - Max-chars splits
  - Windows skip if no unresolved
  - Locked spans included in window context
- `tests/attribution/test_parser.py`
  - Valid roster + attribution JSON
  - Missing / extra / duplicated ids
  - Invalid types / out-of-range confidences
  - Locked speaker tampered → rejected
- `tests/attribution/test_validators.py`
  - Dialogue span without attribution → fail
  - Narration span with attribution → fail
  - Unknown speaker → fail
  - Duplicate span_id → fail

### Integration (fake LLM)

- `tests/attribution/test_service.py`
  - Happy path: roster + pre-pass + LLM → full attribution set
  - Alternation: 1 tagged line + 3 untagged → all correctly attributed via windowed pass
  - UNKNOWN path: low-confidence → needs_review
  - Retry: first LLM response malformed, second succeeds
- `tests/attribution/test_attribution_api.py`
  - 201 happy path
  - 404 missing doc
  - 409 already attributed
  - 422 on validator failure with report payload
  - 502 on Ollama unavailable

### Fixture-backed benchmark (hand-labeled)

- `tests/attribution/fixtures/eval_set/*.json` — 20 chapter excerpts with hand-labeled speaker per dialogue span.
- `tests/attribution/test_benchmark.py` (opt-in via env flag; slow, requires running Ollama) — reports accuracy / F1 / UNKNOWN rate / sec-per-1k-chars against the fixture set.

---

## Benchmark Plan (carried from M3)

Fixed eval set: 20 chapter excerpts covering:
- Heavy alternation (rapid back-and-forth exchanges)
- Pronoun-only tags ("she said")
- Speaker first named later in the chapter
- Group speech ("they said")
- Nested quotes (known-imperfect from M3 limitations)
- Long monologue with interrupting action tag

**Metrics per run**
- Attribution accuracy (exact speaker match)
- F1 by speaker (catches per-character skew)
- `UNKNOWN` rate
- `needs_review` rate
- Deterministic pre-pass hit rate
- Mean sec / 1k chars
- LLM tokens prompt / completion

**Promotion gate** (for accepting a new default model)
- Attribution accuracy ≥ baseline (`qwen2.5:7b`).
- `UNKNOWN` + `needs_review` combined rate ≤ baseline.
- Runtime within acceptable local bounds (sequential pipeline, RTX 3080, 10–12 GB VRAM).

---

## Edge Cases (explicit handling)

| Case | Handling |
|---|---|
| **First-person POV "I said"** | Roster includes the POV character. Pre-pass pattern `I said` is NOT matched (no alias). LLM resolves from context + descriptor ("POV character in this chapter"). |
| **Group speech "they said"** | Pre-pass never matches pronouns. LLM returns `UNKNOWN` → `needs_review`. Future: introduce a group-speaker type. |
| **Interruption**: `"I was going to--" "Don't!"` | Two dialogue spans, attributed independently. Alternation rule handles well when both parties are in roster. |
| **Split dialogue with tag**: `"I think," he said, "we should go."` | Two dialogue spans separated by a tag-only narration. Pre-pass P4 should resolve both to same speaker (both adjacent narrations contain the same named tag). If only pronoun "he said" appears, LLM handles via alternation. |
| **Unmatched quote → long narration (M3 limitation)** | No attribution needed for narration spans; M4 unaffected. |
| **Dialogue at chapter start / end** | No adjacent narration on one side. Pre-pass uses whichever side is available. LLM handles when both are absent. |
| **Name shared across characters** (e.g. two "Mr. Malfoy"s) | Roster canonicalization must disambiguate. If the extractor collapses them, attribution quality degrades. MVP accepts this; flagged as a known limitation. |
| **Chanted / read-aloud text** (letters, songs) | Segmented as dialogue because of quotes. LLM will typically attribute to the reader. If unclear → `UNKNOWN`. |

---

## Implementation Order

1. **Schema migration** — `packages/db/drizzle/migrations/0004_m4_attribution_jobs.sql` + Python bootstrap mirror.
2. **`pre_pass.py`** + its tests — pure Python, no LLM, most correctness risk.
3. **`windower.py`** + its tests — pure Python, deterministic.
4. **`prompts.py`** + `parser.py` + their tests — shapes only, no LLM.
5. **`roster.py`** with fake-LLM tests.
6. **`validators.py`** with unit tests.
7. **`service.py`** wiring A → B → C → D with a fake-LLM integration test (including the alternation fixture).
8. **`/api/attribute` endpoint** + API tests.
9. **Smoke test** against real Qwen3 8B on a full AO3 chapter; iterate on prompts if accuracy is weak.
10. **Deferred:** Benchmark fixture set (hand-labeling, ~3–4 hours) and the promotion-gate benchmark.

---

## Tradeoffs & Open Questions

- **Two LLM passes per document** (roster + attribution) adds cost, but the roster pass is one call and the attribution pass is `~ceil(unresolved_dialogue_count / MAX_WINDOW_DIALOGUES)` calls. Pre-pass should cut attribution calls by ~50%.
- **Roster-constrained output** protects against hallucinated speakers but may mislabel minor characters the roster misses. Mitigation: low-confidence → review flag; roster prompt asks for minor characters too.
- **Closed verb list in pre-pass** trades recall for precision. If benchmark hit rate is low (<30%), widen the list carefully.
- **Alternation-bias rule** is a prompt nudge, not a deterministic constraint. If benchmark shows it fails systematically, add a deterministic post-pass: *if every unresolved span in a window alternates between two locked anchors, enforce strict alternation.*
- **Cross-chapter character continuity** is out of scope for M4 MVP. Roster is per-document; a chapter 2 roster extraction won't automatically include voices/names established in chapter 1. Post-MVP enhancement.
- **Document-level roster extraction** may become expensive for very long chapters. If it blows the context window, we'll swap to a two-step: extract per-chunk, then dedupe canonicals deterministically.

---

## Configuration

New settings in `config.py`:

```python
attribution_model: str = Field(default="qwen3:8b")
attribution_confidence_threshold: float = Field(default=0.7, ge=0, le=1)
attribution_max_window_dialogues: int = Field(default=12, ge=1, le=50)
attribution_max_window_chars: int = Field(default=6000, ge=1000, le=20000)
attribution_max_gap_chars: int = Field(default=400, ge=0, le=5000)
attribution_max_retries: int = Field(default=3, ge=0, le=10)
```

(The existing `ollama_base_url` and `ollama_timeout_seconds` are reused.)

---

## Definition of Done

- `POST /api/attribute` produces one attribution per dialogue span, persisted in `attributions`, with review flags for every unknown / low-confidence case.
- All deterministic cross-stage validators pass for every successful run.
- `attribution_jobs` row written per run with full stats.
- Unit tests cover pre-pass, windower, parser, and validators.
- Fake-LLM integration tests cover happy path, alternation, UNKNOWN, and retry.
- Local runtime results have been reviewed and accepted as satisfactory for current product work.
- Deferred quality work: benchmark fixture set exists and the benchmark test runs (even if gated off by default).
- Plan document (this file) updated with any spec deviations made during implementation.
