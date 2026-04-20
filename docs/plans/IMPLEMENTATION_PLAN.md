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
- **LLM Runtime:** Ollama + Qwen3 8B (segmentation + attribution)
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

## M3 — Segmentation Pass (LLM) + Chunk Merge

**Objective:** Segment long texts reliably with global offset integrity.

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement chunking strategy (window + overlap)
- [ ] Implement segmentation prompt call via Ollama (default model: `qwen3:8b`)
- [ ] Parse + validate JSON response
- [ ] Convert chunk-local offsets to global offsets
- [ ] Deterministic overlap reconciliation/merge
- [ ] Run full-document validators post-merge
- [ ] Add retry policy for malformed LLM output
- [ ] Add tests for chunk boundary edge cases

**Definition of Done**
- Long chapters produce contiguous validated spans persisted in SQLite.

**Benchmark plan (model validation on RTX 3080, 10–12GB VRAM)**
- [ ] Build a fixed eval set: 20 chapter excerpts (mix of heavy dialogue, nested quotes, and narration-heavy prose)
- [ ] Run baseline (`qwen2.5:7b-instruct-q4_K_M`) and candidate (`qwen3:8b`) with identical prompts/temperature
- [ ] Track deterministic metrics per run:
  - [ ] JSON parse success rate
  - [ ] Contiguity/non-overlap/coverage pass rate
  - [ ] Reconstruction exact-match rate
  - [ ] Mean latency (sec / 1k chars)
- [ ] Track sampled quality metrics:
  - [ ] Segmentation label agreement against human labels (narration vs dialogue)
  - [ ] Attribution accuracy / F1 on dialogue spans
- [ ] Promotion gate for default model:
  - [ ] `qwen3:8b` has equal-or-better deterministic pass rate than baseline
  - [ ] `qwen3:8b` improves sampled quality metrics
  - [ ] Runtime remains acceptable for local sequential pipeline

---

## M4 — Attribution Pass (LLM) + Review Flags

**Objective:** Attribute speakers for dialogue spans and flag uncertain outputs.

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement attribution prompt flow
- [ ] Restrict outputs to one item per dialogue span id
- [ ] Enforce fallback: `speaker="UNKNOWN"`, `needs_review=true` when uncertain
- [ ] Add confidence threshold logic for review flagging
- [ ] Merge attribution results back into full span set
- [ ] Validate attribution schema + constraints
- [ ] Add tests for pronouns/multi-speaker ambiguity

**Definition of Done**
- Attribution results are persisted with deterministic checks and review flags.

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

`M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8`

Reasoning:
- M0 and M1 establish repo layout, schema, and validators before ingestion and LLM stages (avoids costly refactors later).
- M3/M4 depend on contracts and validators.
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

- **Last updated:** 2026-04-20
- **Completed in this session:**
  - [x] Fixed AO3 HTTP 525 by switching to a browser-shaped User-Agent + `Accept-*` headers
  - [x] Extended AO3 parser to extract work title, authors (with absolute profile URLs), and prev/next chapter URLs
  - [x] Added `documents.source_metadata` JSON column (Drizzle migration `0001_m2_documents_source_metadata.sql`) to hold source-specific metadata
  - [x] Populated AO3 `source_metadata` with work_id/work_title/authors/chapter_id/chapter_title/prev+next chapter URLs
  - [x] Added redirect-to-homepage detection for restricted/locked AO3 works
  - [x] Normalized curly quotes, ellipses, and em/en dashes to ASCII in the cleaning pipeline
  - [x] Promoted `ingestion_jobs` from Python-only bootstrap to Drizzle (migration `0002_m2_ingestion_jobs.sql`); Python `storage.py` now mirrors Drizzle as dev-convenience bootstrap only
  - [x] Wrote `docs/ao3_ingestion.md` (parsing selectors, Cloudflare mitigation, rate/size limits, `source_metadata` shape, ranked future upgrades)
  - [x] Full Python suite green (`pytest tests/ -q`: 39 passed)
- **M2 status:** ✅ complete
- **Next immediate task:** begin M3 segmentation pass scaffolding (chunking + prompt call + response validation loop)
- **Blockers:** none.
- **Resume commands:**
  - `cd ~/repos/auralia`
  - `git pull`
  - `pytest tests/ingestion -q`
  - `pytest tests/ -q`
  - `npm run dev` (on a machine with npm available)

---

## Progress Snapshot

- M0 Repo & Tooling Skeleton: ✅
- M1 Contracts + Validators: ✅
- M2 Ingestion & Cleaning: ✅
- M3 Segmentation + Chunk Merge: ⬜
- M4 Attribution + Review Flags: ⬜
- M5 Voice Registry API + Voice Management: ⬜
- M6 React Review + Speaker Corrections: ⬜
- M7 Synthesis + Assembly: ⬜
- M8 Quality + Hardening: ⬜
