# Auralia Implementation Plan

> Living plan for execution tracking across sessions.
> Update this file at the end of each work block.

## Goal

Build a fully local, character-aware audiobook pipeline that converts prose into voice-cast audio with deterministic validation gates and a mandatory UI review step for unknown speakers.

## Architecture Summary

- **Monorepo:** Turborepo
- **Backend:** FastAPI (ingestion, LLM orchestration, validation, synthesis pipeline)
- **Frontend:** React with **TanStack Start** (file routes, SSR-capable dev/build) for the review + voice mapping UI
- **Database:** SQLite (local, single-user) for structured state
- **Schema control:** Drizzle ORM + migrations (TypeScript-first schema ownership)
- **LLM Runtime:** Ollama + Qwen3 8B (attribution only — segmentation is deterministic)
- **TTS:** VoxCPM
- **Assembly:** FFmpeg
- **Binary assets:** local filesystem for audio files

---

## Delivery Milestones

## M0 — Repo & Tooling Skeleton

**Objective:** Create runnable monorepo structure and baseline dev workflow.

**Status:** ✅ Completed

**Tasks**
- [x] Initialize Turborepo workspace (`apps/api`, `apps/web`, `packages/shared`)
- [x] Add Python backend project scaffold + dependency management
- [x] Add React frontend scaffold + routing/state baseline (TanStack Start + TanStack Router; `AppSession` context baseline)
- [x] Add shared schema package (JSON schema/types)
- [x] Add root scripts (`dev`, `test`, `lint`, `typecheck`)
- [x] Add `.env.example` and config loading strategy
- [x] Add baseline CI workflow (lint + tests)

**Definition of Done**
- `turbo run dev` starts backend + frontend.
- CI passes on a clean clone.

**Delivered artifacts**
- Root `turbo.json`, `package.json` workspaces (`apps/*`, `packages/*`), and Turborepo `dev` / `test` / `lint` / `typecheck` pipelines
- `apps/api`: FastAPI entry (`auralia_api.main`), `pydantic-settings` config (`AURALIA_*`), `package.json` scripts delegating to repo-root `pytest` / `ruff` / `mypy` / `uvicorn`
- `apps/web`: TanStack Start + Vite 8, file routes (`src/routes/*`), Vitest smoke test, dev proxy for `/api` and `/health` to FastAPI on `:8000`
- `packages/shared`: TypeScript span payload types + `schema/spans-payload.schema.json`
- `.env.example` and GitHub Actions `.github/workflows/ci.yml` (`npm ci`, `pip install -e ".[dev]"`, `turbo run lint test typecheck`)
- README **Quick start: testing** (setup + targeted test commands)

---

## M1 — SQLite Schema + Deterministic Validators

**Objective:** Lock stage interfaces in SQLite and harden non-LLM correctness checks.

**Status:** ✅ Completed

**Tasks**
- [x] Define initial SQLite schema via Drizzle for:
  - [x] `documents`
  - [x] `spans`
  - [x] `attributions` (or attribution columns on spans)
  - [x] `voices`
  - [x] `voice_mappings`
  - [x] `synthesis_jobs`
  - [x] `synthesis_segments`
- [x] Create migration baseline and migration workflow
- [x] Define local storage layout for reusable voice assets (`data/voices/...`) and outputs (`data/outputs/...`)
- [x] Implement deterministic validators:
  - [x] schema/type validation at API boundary
  - [x] contiguity (`next.start == prev.end`)
  - [x] non-overlap
  - [x] full coverage (0..len(text))
  - [x] exact reconstruction (`join(span.text) == text`)
  - [x] offset-text consistency (`text[start:end] == span.text`)
- [x] Add machine-readable error report format
- [x] Add unit tests for all validator edge cases

**Definition of Done**
- SQLite schema + migrations are reproducible from a clean clone.
- Validation suite catches malformed spans and blocks pipeline progression.
- Unit tests cover nominal + edge conditions (gaps, overlaps, drift, invalid offsets).

**Delivered artifacts**
- Drizzle schema and migrations under `packages/db/`
- Validator implementation under `apps/api/src/auralia_api/validators/`
- Validator tests under `tests/validators/`
- Storage directories `data/voices/` and `data/outputs/`
- Migration workflow doc at `docs/migrations.md`

---

## M2 — Ingestion & Cleaning

**Objective:** Produce normalized prose input with source metadata.

**Status:** ✅ Completed

**Tasks**
- [x] Implement plain-text ingestion endpoint accepting raw text (markdown or plain) in the request body; both formats flow through the same cleaning pipeline before storage (replaces the prior local-text-file ingestion approach)
- [x] Implement AO3 ingestion adapter (with rate-limit + compliance guardrails)
- [x] HTML/tag stripping + whitespace normalization
- [x] Typographic normalization (curly quotes, ellipses, em/en dashes → ASCII)
- [x] Store cleaned text + metadata in `documents` table
- [x] Add ingestion endpoint + job record creation
- [x] Add tests for malformed HTML and odd whitespace
- [x] Capture AO3 work-level metadata (work title, authors, prev/next chapter URLs) in `documents.source_metadata` for future crawling
- [x] Move `ingestion_jobs` table under Drizzle ownership (canonical schema)

**Definition of Done**
- Inputs from AO3/text become valid `cleaned_document` JSON.

**Delivered**
- Ingestion module under `apps/api/src/auralia_api/ingestion/`:
  - `cleaning.py` (HTML/entity cleanup, markdown/plain-text normalization, typographic normalization)
  - `ao3.py` (AO3 chapter fetch + parse with conservative request behavior and work-level metadata extraction)
  - `schemas.py` (request/response contracts for text + AO3 ingestion)
  - `service.py` (ingestion orchestration + persistence)
  - `storage.py` (SQLite inserts; mirrors Drizzle-owned schema for dev bootstrap)
- API endpoints:
  - `POST /api/ingest/text`
  - `POST /api/ingest/ao3`
- Schema additions (Drizzle-owned):
  - `documents.source_metadata` JSON column (migration `0001_m2_documents_source_metadata.sql`)
  - `ingestion_jobs` table promoted from Python bootstrap to Drizzle (migration `0002_m2_ingestion_jobs.sql`)
- Tests under `tests/ingestion/`:
  - `test_cleaning.py`
  - `test_text_ingestion_api.py`
  - `test_ao3_adapter.py`
  - `test_ao3_ingestion_api.py`
- Docs: `docs/ao3_ingestion.md` (parsing technique, Cloudflare mitigation, future upgrades)

**AO3 guardrails implemented**
- Restricts ingestion to `https://archiveofourown.org/works/<id>/chapters/<id>` URLs
- Enforces minimum interval between outbound AO3 requests in-process
- Uses single request per ingestion call (no crawling), bounded response size, and strict chapter-body extraction
- Browser-shaped User-Agent + `Accept-*` headers to bypass Cloudflare HTTP 525 bot rejection
- Detects silent redirects to the AO3 homepage (restricted/deleted works) and surfaces as explicit fetch errors
- Returns explicit validation/fetch/parse errors with safe API mappings

---

## M3 — Segmentation Pass (Deterministic) + Quote-Based Splitter

**Objective:** Split cleaned prose into narration/dialogue spans with exact offsets for downstream stages.

**Status:** ✅ Completed

**Approach change (2026-04-20):** Replaced the planned LLM-based segmentation with a deterministic quote-pairing splitter. Early testing of `qwen3:8b` (and earlier `qwen2.5:7b`) on the offset-emission task produced degenerate alternating-number patterns that broke text mid-word and mislabeled narration vs dialogue, even with `format: "json"` and temperature 0. Since the ingestion pipeline already normalizes every curly/angle double quote to ASCII `"`, a pair-based splitter gives near-perfect labels for standard English prose at zero LLM cost — aligned with PLAN.md's guidance to "use LLM calls only for semantic tasks". LLM work is now concentrated in M4 (attribution), where offsets are not required from the model.

**Tasks**
- [x] Implement deterministic quote-pair splitter (`segmentation/quote_segmenter.py`)
- [x] Integrate existing validators (contiguity, non-overlap, coverage, reconstruction, offset-text consistency)
- [x] Persist spans + `segmentation_jobs` row (with `stats.method` tag)
- [x] Handle edge cases: narration-only, unmatched quotes, adjacent dialogues, multi-line dialogue, empty `""`
- [x] Expose `/api/segment` endpoint (no LLM dependency)
- [x] Add unit tests for segmenter invariants + API behavior
- [x] Support `force=true` reruns with strict downstream invalidation: delete/regenerate spans, reset cast detection, attribution, and synthesis-derived outputs, and preserve manual cast edits/deletions.

**Definition of Done**
- AO3-normalized chapters produce contiguous validated spans persisted in SQLite with correct narration/dialogue labels and zero LLM calls.

**Delivered**
- `apps/api/src/auralia_api/segmentation/quote_segmenter.py` — O(n) pure-Python splitter
- `apps/api/src/auralia_api/segmentation/service.py` — orchestration + persistence
- `apps/api/src/auralia_api/segmentation/storage.py` — SQLite bootstrap mirroring Drizzle
- `apps/api/src/auralia_api/segmentation/ollama_client.py` — retained unchanged for reuse by M4
- `packages/db/drizzle/migrations/0003_m3_segmentation_jobs.sql` — `segmentation_jobs` table
- `POST /api/segment` endpoint (document_id → spans + job record)
- `POST /api/segment?force=true` rerun path that returns `force_wipe` counts for spans, attributions/jobs, generated cast/evidence, cast jobs, and synthesis rows/jobs where present.
- Tests: `tests/segmentation/test_quote_segmenter.py`, `tests/segmentation/test_segmentation_api.py`, `tests/segmentation/test_ollama_client.py`

**Known limitations (candidates for M8 hardening or a follow-up milestone)**
- British-style single-quote (`'...'`) dialogue is not detected; it conflicts with apostrophes/possessives, so only ASCII double quotes are treated as dialogue delimiters.
- Nested double quotes (e.g. `"He said "wait!" slowly."`) mis-pair, producing a spurious narration segment inside what is semantically one speech act. Rare in standard AO3 prose.
- A truly unmatched opening `"` yields a single narration span to EOF — safe default, but worth surfacing in observability when M8 lands.
- No speaker attribution yet — that's M4's job.

**Previously planned, not pursued**
- Chunking (window + overlap) — not needed; the splitter is O(n) with no context window.
- Ollama segmentation prompt + JSON validation + retry policy — removed. `ollama_client.py` kept for M4.
- Overlap reconciliation/merge logic — not needed without chunking.
- Segmentation-model benchmark plan (`qwen2.5:7b` vs `qwen3:8b`) — superseded. Benchmarking moves to M4, where the LLM still owns the task.

---

## M4 — Attribution Pass (LLM + Deterministic Pre-Pass) + Review Flags

**Objective:** Attribute speakers for dialogue spans and flag uncertain outputs.

**Status:** ⏸ Paused / accepted for now — attribution works satisfactorily in local runtime testing. Benchmark fixture work and measured tuning are intentionally deferred.

**Tasks**
- [x] Character roster extraction (LLM pass A)
- [x] Deterministic tag pre-pass for obvious `X said` patterns (closed verb list, roster-gated)
- [x] Conversation-window batching for the LLM attribution pass (locked context preserves alternation anchors)
- [x] Attribution prompt + parser for roster and windowed output
- [x] Cross-stage attribution validators (one-per-span, roster-bound, `UNKNOWN` → review, confidence threshold)
- [x] Persist `attribution_jobs` + `attributions` rows with merged stats
- [x] `POST /api/attribute` endpoint with 404/409/422/502 error mappings
- [x] Unit + fake-LLM integration tests across modules (46 passing)
- [x] Robustness hardening against real LLM drift (tolerant parsers, retry-with-feedback, raw-response surfacing)
- [x] Live smoke run against real Qwen3 8B — endpoint returns attributions end-to-end
- [x] Refactor target chosen: attribution should load persisted cast members and no longer use LLM roster extraction as the gatekeeper for deterministic speaker tags.
- [ ] Deferred: benchmark fixture set (20 hand-labeled excerpts) + opt-in benchmark test
- [ ] Deferred: prompt/threshold tuning based on measured accuracy

**Definition of Done**
- Attribution results are persisted with deterministic checks and review flags.
- Runtime behavior has been validated locally and accepted for current product work.
- Full spec in `docs/plans/M4_ATTRIBUTION.md` remains authoritative for the pipeline.

**Delivered**
- `apps/api/src/auralia_api/attribution/` — `prompts.py`, `roster.py`, `pre_pass.py`, `windower.py`, `parser.py`, `validators.py`, `service.py`, `storage.py`, `schemas.py`
- Drizzle migration `0004_m4_attribution_jobs.sql` + Python bootstrap mirror in `attribution/storage.py`
- `POST /api/attribute` endpoint in `main.py`
- Config additions (`auralia_api.config`): `attribution_model`, `attribution_confidence_threshold`, `attribution_max_window_dialogues`, `attribution_max_window_chars`, `attribution_max_gap_chars`, `attribution_max_retries`
- Deferred evaluation work: benchmark fixtures, opt-in benchmark runner, and prompt/threshold tuning remain available for a later quality milestone.
- Tests under `tests/attribution/`:
  - `test_pre_pass.py`, `test_windower.py`, `test_parser.py`, `test_prompts.py`, `test_roster.py`, `test_validators.py`, `test_service.py`, `test_attribution_storage.py`, `test_attribution_api.py`

---

## M4.5 — Cast Detection Stage (Deterministic Harvest + Optional Compact LLM)

**Objective:** Build a persisted, editable speaker cast before attribution, using deterministic dialogue-tag evidence first and compact LLM canonicalization only when needed.

**Status:** 🟨 In progress

**Rationale:** The previous M4 roster pass was a single full-document LLM extraction. It missed obvious speakers such as `Dumbledore` even when the text contained `"..." Dumbledore replied.` Because deterministic attribution and LLM attribution were roster-gated, a missing roster entry forced clear dialogue to `UNKNOWN`. Cast discovery is now separated from attribution so explicit tag evidence can create cast candidates directly.

**Tasks**
- [x] Add dedicated cast tables:
  - [x] `cast_detection_jobs`
  - [x] `document_cast_members`
  - [x] `cast_member_evidence`
- [x] Add deterministic narration/tag harvester for explicit speaker candidates:
  - [x] post-dialogue `X said/replied`
  - [x] post-dialogue `said/replied X`
  - [x] pre-dialogue `X said,`
  - [x] pre-dialogue `said X,`
  - [x] pronoun exclusion
  - [x] honorific surfaces such as `Professor Dumbledore`, `Mr Lupin`
- [x] Add `POST /api/detect-cast` with job stats and evidence persistence.
- [x] Keep `documents.roster` synchronized as a compatibility cache for the existing UI.
- [x] Refactor attribution to consume persisted cast/legacy roster instead of extracting a roster internally.
- [x] Add frontend cast-stage trigger and basic cast stats display.
- [x] Add `force=true` reruns that delete regenerated cast/evidence and reset attribution/synthesis-derived outputs while preserving manual cast edits/deletions.
- [x] Treat the latest cast detection job, not cast row count, as the Cast Detection completion signal so preserved manual rows do not make the stage appear complete.
- [ ] Expand compact LLM alias merge evaluation fixtures (`Remus` ↔ `Mr Lupin`, surname-only references, titles).
- [ ] Add manual merge UI for cast members and aliases.
- [ ] Add benchmark report for explicit-speaker recall and alias-merge accuracy.

**Definition of Done**
- Running cast detection before attribution creates cast candidates from explicit speaker tags without sending the full chapter to the model.
- Attribution refuses to run when no cast/legacy roster exists.
- UI shows cast detection job status and lets manual cast edits remain authoritative.

**Rerun/reset contract**
- `POST /api/detect-cast?force=true` resets generated cast/evidence and downstream attribution/synthesis state before writing a new cast detection job.
- Manual rows in `document_cast_members` with `manually_edited` or `manually_deleted` set are preserved.
- Preserved manual cast rows remain available as editable user state, but the UI does not count them as successful cast detection unless the latest `cast_detection_jobs` row is `completed`.
- Cast detection can run deterministically by default or with the compact LLM canonicalization pass when the request body includes `use_llm: true`.

---

## Pipeline Status UI + Rerun Controls

**Objective:** Make pipeline progress resumable from persisted job state and make destructive reruns explicit.

**Status:** ✅ Completed

**Delivered**
- Active stage timers are calculated from each job row's `created_at`, so timers survive browser tab closes/reopens.
- Job completion timestamps are present across pipeline job tables: ingestion, segmentation, cast detection, attribution, and synthesis.
- Completed stage buttons use `ConfirmationButton`; long-pressing Segmentation or Cast Detection opens a destructive confirmation dialog before calling the existing `force=true` rerun path.
- The document status route and text route both refresh pipeline diagnostics during and after runs so fast deterministic stages clear `Running...` promptly.
- Overall pipeline visualization resets downstream statuses after forced upstream reruns because stale downstream job rows are deleted.

**Reset policy**
- Re-run Segmentation: reset segmentation outputs and all downstream derived outputs: generated cast, cast evidence, attribution rows/jobs, synthesis rows/jobs, and cast detection jobs. Manual cast edits/deletions are preserved.
- Re-run Cast Detection: reset generated cast/evidence and downstream attribution/synthesis rows/jobs. Manual cast edits/deletions are preserved.
- Re-run Attribution: existing `force=true` behavior deletes attribution rows before re-attributing; synthesis reset on attribution rerun remains a follow-up if synthesis becomes active before a dedicated synthesis invalidation hook exists.

---

## M5 — Voice Registry API + React Voice Management

**Objective:** Persist reusable designed/cloned voices and expose them via API/UI.

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement local voice asset storage (`data/voices/<voice_id>/...`)
- [ ] Implement `voices` table repository/service layer (SQLite)
- [ ] Add API endpoints:
  - [ ] `POST /api/voices` (create designed/cloned/hifi voice profile)
  - [ ] `GET /api/voices` (list)
  - [ ] `GET /api/voices/{voice_id}` (detail)
  - [ ] `PATCH /api/voices/{voice_id}` (edit metadata/params)
  - [ ] `DELETE /api/voices/{voice_id}` (remove profile and optional assets)
  - [ ] `POST /api/voices/{voice_id}/validate` (check files + mode requirements)
- [ ] Add upload/import flow for reference clips
- [ ] Build React voice library screen (create/edit/delete/test)
- [ ] Build React voice assignment UI per character + narrator (uses `voice_id`)
- [ ] Persist voice mappings in `voice_mappings` table
- [ ] Add tests for API contracts + storage edge cases
- [ ] Add Drizzle migration for voice-related tables and indexes

**Definition of Done**
- Voices can be created once and reused across chapters/books via `voice_id`.
- Voice validation endpoint blocks invalid clone/hifi configs.

---

## M6 — React Review Gate + Speaker Corrections

**Objective:** Manual correction gate for uncertain attribution before synthesis.

**Status:** ⬜ Not started

**Tasks**
- [ ] Build character/speaker review screen
- [ ] Build unresolved item queue (`UNKNOWN` + low-confidence)
- [ ] Enable inline speaker correction per span
- [ ] Enforce completion gate before synthesis request can be submitted
- [ ] Add frontend integration tests for review flow

**Definition of Done**
- User cannot start synthesis while unresolved `needs_review` spans exist.

---

## M7 — Synthesis & FFmpeg Assembly

**Objective:** Produce final audiobook outputs from validated, reviewed spans.

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement synthesis job planner from `synthesis_manifest`
- [ ] Map narration/dialogue to correct voices
- [ ] Generate per-span audio with stable file naming
- [ ] Implement idempotent caching (hash-based)
- [ ] Concatenate audio in span order via FFmpeg
- [ ] Support single-file and chapter-split export
- [ ] Add post-export artifact manifest

**Definition of Done**
- End-to-end run produces playable output and manifest.

---

## M8 — Quality, Observability, and Hardening

**Objective:** Make pipeline measurable, resumable, and maintainable.

**Status:** ⬜ Not started

**Tasks**
- [ ] Structured logs + run IDs across all stages
- [ ] Resume/retry behavior for failed/incomplete jobs
- [ ] Cost/runtime dashboard metrics:
  - [ ] JSON parse success rate
  - [ ] validator pass/fail rate
  - [ ] unresolved speaker count
  - [ ] sec/1k chars
- [ ] Golden test fixtures for deterministic regression testing
- [ ] Add docs for local ops and troubleshooting

**Definition of Done**
- Failed jobs can be resumed safely; key metrics visible per run.

---

## Backlog (Post-MVP)

- [ ] Stretch milestone: automatically download required local models on startup when missing (with explicit opt-in and progress reporting)
- [ ] Stretch milestone: optionally auto-start local model runtimes on app startup (health-check gated, with timeout/fallback)
- [ ] Multi-voice style presets per project
- [ ] Pronunciation dictionary per character
- [ ] Emotion/prosody controls
- [ ] Batch project queue UI
- [ ] EPUB ingestion adapter

---

## Execution Order (Recommended)

`M0 -> M1 -> M2 -> M3 -> M4.5 -> M4 -> M5 -> M6 -> M7 -> M8`

Reasoning:
- M0 and M1 establish repo layout, schema, and validators before ingestion and LLM stages (avoids costly refactors later).
- M4.5 converts segmented spans into an editable cast; M4 attribution consumes that cast.
- M5 establishes reusable voices and APIs before review/synthesis.
- M6 is a hard gate for unknown speakers before M7 synthesis.

---

## Session Handoff Protocol

At end of each session, update:

1. **Milestone status** (⬜/🟨/✅)
2. **Completed tasks** (checklist)
3. **Next immediate task** (single actionable item)
4. **Blockers/decisions**
5. **Commands to resume**

### Current Session Log

- **Last updated:** 2026-04-25
- **Completed in this session:**
  - [x] Delivered the full M4 attribution pipeline per `docs/plans/M4_ATTRIBUTION.md`: roster extraction (LLM), deterministic `X said`/`said X` pre-pass (closed verb list, roster-gated), conversation-window batching with locked anchors for alternation inference, cross-stage validators, persistence.
  - [x] Added Drizzle migration `0004_m4_attribution_jobs.sql` plus Python bootstrap mirror in `attribution/storage.py`.
  - [x] Wired `POST /api/attribute` in `main.py` with 404/409/422/502 error mappings.
  - [x] Added attribution config fields (`attribution_model`, confidence threshold, window/gap sizing, retry cap) to `config.py`.
  - [x] Cleaned the segmentation test invariant helper: swapped `zip(..., strict=False)` for `itertools.pairwise`.
  - [x] Fixed two mypy errors in `ingestion/ao3.py` (guard `get_starttag_text()` None case; annotate `payload: bytes`).
  - [x] Hardened attribution against real-LLM drift after two production 422s against Qwen3 8B:
    - Roster parser accepts `characters` / `roster` / `character` / `cast` keys and bare top-level arrays.
    - Window parser maps aliases → canonical, does case-insensitive canonical/alias matching, and coerces truly-unknown speakers to `UNKNOWN` (conf=0, flows through `needs_review`) instead of hard-failing.
    - Both roster and window retry loops now feed the previous error + raw-response snippet back into the next prompt so the model can self-correct.
    - `AttributionParseError` carries a `raw_response` attribute; failed-job `error_report` includes a `raw_response_snippet` for diagnosis without reproduction.
    - Removed stray `print(roster)` debug statement.
  - [x] End-to-end smoke run against real Qwen3 8B succeeded — `POST /api/attribute` returns attributions and persists rows to `attributions` + `attribution_jobs`.
  - [x] Added `documents.roster` JSON column (Drizzle migration `0005_m4_documents_roster.sql` + Python bootstrap mirrors) so the expensive LLM roster extraction can be cached per document for future reuse; `save_document_roster()` is called on successful attribution.
  - [x] Full Python suite green (`pytest tests/ -q`: 106 passed). `ruff check apps/api/src tests` clean. `mypy apps/api/src/auralia_api` clean (0 errors across 28 files).
- **Completed in current cast-detection refactor session:**
  - [x] Planned dedicated M4.5 cast detection stage to decouple speaker discovery from attribution.
  - [x] Added deterministic explicit speaker-tag harvesting as the first source of cast candidates.
  - [x] Added new cast persistence/job/evidence tables and API shape.
  - [x] Began refactoring attribution to require persisted cast/legacy roster instead of running roster extraction.
  - [x] Added persisted job timers and completed-at fields across pipeline job tables for browser-resumable elapsed-time display.
  - [x] Added strict downstream invalidation for forced segmentation and cast detection reruns, preserving manual cast edits/deletions while resetting stale generated/job state.
  - [x] Added long-press confirmation dialogs for destructive Segmentation and Cast Detection reruns on the document status/text routes.
  - [x] Updated pipeline status completion rules so manual cast rows do not make Cast Detection appear complete after upstream reset.
  - [x] Confirmed local runtime attribution results are satisfactory for current product work.
- **M4 status:** ⏸ paused / accepted for now — pipeline, validators, API, tests, and live-LLM robustness are delivered; benchmark fixture set and measured tuning are deferred to a later quality pass.
- **Next immediate task:** move forward to the next product milestone. Run the full frontend/API validation commands locally with the complete PATH before merging this batch.
- **Blockers:** none.
- **Resume commands:**
  - `cd ~/repos/auralia`
  - `git pull`
  - `pytest tests/segmentation/test_segmentation_api.py tests/cast_detection/test_cast_detection_api.py -q`
  - `pytest tests/ -q`
  - `ruff check apps/api/src tests && mypy apps/api/src/auralia_api`
  - `npm run db:migrate`
  - `npm --workspace @auralia/web run typecheck`

---

## Progress Snapshot

- M0 Repo & Tooling Skeleton: ✅
- M1 Contracts + Validators: ✅
- M2 Ingestion & Cleaning: ✅
- M3 Segmentation (deterministic quote splitter): ✅
- M4.5 Cast Detection: 🟨 (deterministic stage + persistence/API in progress)
- M4 Attribution + Review Flags: ⏸ (accepted for runtime use; benchmarking deferred)
- M5 Voice Registry API + Voice Management: ⬜
- M6 React Review + Speaker Corrections: ⬜
- M7 Synthesis + Assembly: ⬜
- M8 Quality + Hardening: ⬜
