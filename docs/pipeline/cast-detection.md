# Cast detection

Cast detection harvests explicit speaker evidence from the segmented text and builds an editable roster of characters before attribution runs. It runs after segmentation and produces the cast that attribution uses as its bounded speaker set.

## Why a separate stage?

The original M4 attribution design used a single full-document LLM pass to extract a character roster. This missed obvious speakers like `Dumbledore` even when the text contained `"..." Dumbledore replied.` — because the LLM sometimes returned incomplete rosters and missing entries forced clear dialogue to `UNKNOWN`.

Cast detection separates discovery from attribution: explicit dialogue tags create cast candidates directly from the text without any LLM call. The result is an editable, human-readable roster that attribution consumes as its allowed speaker set.

## Approach

### Deterministic harvest

`harvester.py` scans adjacent narration spans for explicit speaker tags using regex patterns against a closed verb list (44 verbs: said, asked, replied, whispered, shouted, yelled, called, cried, murmured, muttered, added, continued, snapped, drawled, breathed, hissed, growled, grumbled, sighed, exclaimed, mumbled, gasped, laughed, grinned, agreed, admitted, protested, insisted, interrupted, and others).

Four patterns are matched:

- **Post-dialogue named tag:** `"..." Harry said.` — narration immediately after dialogue matches `<name> <verb>`.
- **Post-dialogue inverted tag:** `"..." said Harry.` — matches `<verb> <name>`.
- **Pre-dialogue tag:** `Harry said, "..."` — narration ending with `<name> <verb>[,:]`.
- **Pre-dialogue inverted tag:** `said Harry, "..."` — narration ending with `<verb> <name>[,:]`.

Pronoun surfaces (`he`, `she`, `they`, etc.) are excluded — only proper noun surfaces produce candidates. Honorifics and full names (`Professor Dumbledore`, `Mr Lupin`) are treated as surfaces and stored alongside the canonical name.

Each harvested candidate records: surface text, evidence text, evidence type, the span it was found in, the related dialogue span, and a confidence score.

### Optional LLM canonicalization

When the request includes `use_llm: true`, an optional LLM pass groups alias surfaces under canonical names (e.g. `Remus`, `Mr Lupin`, `Lupin` → `Lupin`). Without it, each unique surface becomes a separate candidate. The LLM pass sends harvested evidence to Ollama and retries on JSON malformation.

For most chapters, the deterministic-only mode produces a usable cast. The LLM pass is useful for works with heavy use of titles and surname references.

## Data stored

- `document_cast_members` — one row per canonical character: `canonical_name`, `aliases` (JSON), `descriptor`, `confidence`, `needs_review`, `source` (`deterministic` or `deterministic_llm`), plus `manually_edited` / `manually_deleted` flags for preserving user edits across reruns.
- `cast_member_evidence` — one row per piece of evidence: `cast_member_id`, `span_id`, `related_dialogue_span_id`, `evidence_type`, `surface_text`, `evidence_text`, `confidence`.
- `cast_detection_jobs` — one row per run: `status`, `stats` (JSON with candidate counts, evidence counts), `error_report` on failure.

## API

**`POST /api/detect-cast`** — `{ "document_id": "..." }` → cast detection job + cast members.

Add `?use_llm=true` to enable the optional LLM canonicalization pass.

**`POST /api/detect-cast?force=true`** — re-runs cast detection. Before re-running, cascades downstream deletes:
- Generated cast members and cast evidence (rows with `manually_edited` or `manually_deleted` are preserved).
- Attribution rows and jobs.
- Synthesis segments and synthesis jobs.

**Pipeline completion signal:** the Cast Detection stage is considered complete when the latest `cast_detection_jobs` row has `status = "completed"`. Preserved manual cast rows do not count as successful cast detection after an upstream reset.

## Code structure

```
apps/api/src/auralia_api/cast_detection/
  __init__.py
  schemas.py      # Pydantic request/response models
  harvester.py    # regex-based explicit speaker tag extraction
  prompts.py      # LLM prompt templates for canonicalization
  parser.py       # JSON response parsing + validation
  service.py      # orchestration: harvest → (optional LLM) → persist
  storage.py      # SQLite inserts (mirrors Drizzle schema)
```

## Known limitations

- Alias merge accuracy depends on the Qwen canonicalization pass. Evaluation fixtures covering surname-only references, title variants, and multi-alias characters are deferred.
- Manual merge UI for combining cast members and their aliases is not yet implemented.
- Deterministic recall is bounded by the verb list. Unusual speech verbs (`chirped`, `intoned`) are not in the list and produce no evidence — they fall through to attribution as unresolved spans.
