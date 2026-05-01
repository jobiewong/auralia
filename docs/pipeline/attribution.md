# Attribution

Attribution assigns a speaker to every dialogue span produced by segmentation, using a combination of deterministic pattern matching and windowed LLM inference. It requires a cast to exist (from cast detection) before it can run.

## Approach

Three tiers run in order:

```
Cast members (from cast detection)
         │
         ▼
┌────────────────────────────────────┐
│ B. Deterministic tag pre-pass      │ pure Python, no LLM
│    (regex + closed verb list)      │ ~40–70% of spans resolved
└──────────────────┬─────────────────┘
                   │ resolved set + unresolved set
                   ▼
┌────────────────────────────────────┐
│ C. LLM windowed attribution        │ only unresolved spans
│    (batched by conversation window)│ resolved spans as locked context
└──────────────────┬─────────────────┘
                   │ all dialogue spans attributed
                   ▼
┌────────────────────────────────────┐
│ D. Merge + cross-stage validate    │
│    + persist                       │
└────────────────────────────────────┘
```

### Stage B — Deterministic pre-pass

`pre_pass.py` applies the same speaker-tag patterns as cast detection, but here they are roster-gated: a match only resolves if the surface name is already in the cast. This prevents the pre-pass from inventing speakers not in the allowed set.

Patterns P1–P4 (same verb list as cast detection — 44 verbs). Pronoun-only tags (`he said`, `she whispered`) are never resolved deterministically. Ambiguous tags (multiple aliases match) remain unresolved. Unresolved spans go to the LLM.

Pre-pass resolutions get `confidence = 1.0` and `needs_review = false`.

### Stage C — LLM windowed attribution

`windower.py` groups dialogue spans into conversation windows for the LLM. A new window starts when:
- Narration gap between consecutive dialogues exceeds `MAX_GAP_CHARS` (default 400).
- A double blank line or chapter heading separates them.
- The window has reached `MAX_WINDOW_DIALOGUES` (default 12) spans.
- The window prompt would exceed `MAX_WINDOW_CHARS` (default 6000 chars).

Each window prompt includes surrounding narration context, all in-window spans (both resolved and unresolved), and resolved spans marked as `locked=true` so the model uses them as alternation anchors without being asked to reassign them.

The system prompt instructs the model to:
- Pick speakers only from the provided roster canonical names or emit `"UNKNOWN"`.
- Use `>= 0.8` confidence only when clearly supported.
- Apply strict alternation between the two most recently named speakers in rapid exchanges.
- Not change `locked` entries.

After each window response, `parser.py` validates the JSON: exactly one entry per span id, locked entries unchanged, speakers in roster or `UNKNOWN`, confidence in `[0, 1]`. Failures retry up to `MAX_RETRIES` (default 3) with the error appended to the next prompt.

### Stage D — Merge and persist

Deterministic + LLM results are merged and five cross-stage validators run before anything is written:

1. Every `dialogue` span has exactly one attribution.
2. No `narration` span has an attribution.
3. `speaker ∈ cast_canonical_names ∪ {"UNKNOWN"}`.
4. Unique `span_id` across all attributions.
5. `speaker_confidence ∈ [0, 1]`.

Deterministic review policy applied after merge:
- `speaker == "UNKNOWN"` → `needs_review = true`
- `speaker_confidence < CONFIDENCE_THRESHOLD` → `needs_review = true`
- Otherwise → `needs_review = false`

## API

**`POST /api/attribute`** — `{ "document_id": "..." }` → attribution job + attributions.

**Errors:**
- `404` — document not found.
- `409` — attribution already exists; use `POST /api/attribute?force=true`.
- `422` — cross-stage validator failure with machine-readable report.
- `502` — Ollama unavailable.

## Code structure

```
apps/api/src/auralia_api/attribution/
  __init__.py
  schemas.py      # Pydantic request/response models
  prompts.py      # roster + attribution system/user templates
  roster.py       # legacy roster extraction (superseded by cast detection)
  pre_pass.py     # deterministic regex tag matcher (Stage B)
  windower.py     # conversation-window grouping (Stage C)
  parser.py       # JSON validation for attribution responses
  validators.py   # cross-stage validators (Stage D)
  service.py      # pipeline orchestration: cast load → B → C → D
  storage.py      # SQLite inserts (mirrors Drizzle schema)
```

Reuses `segmentation/ollama_client.py` for Ollama HTTP calls.

Tests: `tests/attribution/` — `test_pre_pass.py`, `test_windower.py`, `test_parser.py`, `test_prompts.py`, `test_roster.py`, `test_validators.py`, `test_service.py`, `test_attribution_storage.py`, `test_attribution_api.py`.

## Configuration

All values are set via environment variables with the `AURALIA_` prefix:

| Variable                              | Default  | Description                                          |
|---------------------------------------|----------|------------------------------------------------------|
| `AURALIA_ATTRIBUTION_MODEL`           | `qwen3:8b` | Ollama model name                                  |
| `AURALIA_ATTRIBUTION_CONFIDENCE_THRESHOLD` | `0.7` | Spans below this confidence get `needs_review=true` |
| `AURALIA_ATTRIBUTION_MAX_WINDOW_DIALOGUES` | `12` | Max dialogue spans per LLM window                  |
| `AURALIA_ATTRIBUTION_MAX_WINDOW_CHARS` | `6000`  | Max characters per LLM window prompt               |
| `AURALIA_ATTRIBUTION_MAX_GAP_CHARS`   | `400`    | Narration gap that splits a window                  |
| `AURALIA_ATTRIBUTION_MAX_RETRIES`     | `3`      | Max JSON-parse retries per window                   |

## Status

Attribution is accepted for production use. Local runtime testing has validated satisfactory results with `qwen3:8b`. Benchmark fixtures (20 hand-labeled chapter excerpts) and measured prompt/threshold tuning are intentionally deferred to M8.

## Known edge cases

| Case | Handling |
|------|----------|
| First-person POV `"I said"` | Pre-pass never matches `I`. LLM resolves from context. |
| Group speech `"they said"` | Pre-pass skips pronouns. LLM returns `UNKNOWN` → `needs_review`. |
| Split dialogue with action tag | Two spans attributed independently; alternation rule handles pairing. |
| Name shared across characters | Roster must disambiguate. If it collapses them, attribution degrades. Known limitation. |
| Dialogue at chapter start with no context | Pre-pass uses whichever adjacent span exists. LLM handles when neither is present. |
