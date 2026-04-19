# Auralia Implementation Plan

> Living plan for execution tracking across sessions.
> Update this file at the end of each work block.

## Goal

Build a fully local, character-aware audiobook pipeline that converts prose into voice-cast audio with deterministic validation gates and a mandatory UI review step for unknown speakers.

## Architecture Summary

- **Monorepo:** Turborepo
- **Backend:** FastAPI (ingestion, LLM orchestration, validation, synthesis pipeline)
- **Frontend:** React (speaker review + voice mapping UI)
- **Database:** SQLite (local, single-user) for structured state
- **Schema control:** Drizzle ORM + migrations (TypeScript-first schema ownership)
- **LLM Runtime:** Ollama + Qwen 2.5 7B (segmentation + attribution)
- **TTS:** VoxCPM
- **Assembly:** FFmpeg
- **Binary assets:** local filesystem for audio files

---

## Delivery Milestones

## M0 — Repo & Tooling Skeleton

**Objective:** Create runnable monorepo structure and baseline dev workflow.

**Status:** ⬜ Not started

**Tasks**
- [ ] Initialize Turborepo workspace (`apps/api`, `apps/web`, `packages/shared`)
- [ ] Add Python backend project scaffold + dependency management
- [ ] Add React frontend scaffold + routing/state baseline
- [ ] Add shared schema package (JSON schema/types)
- [ ] Add root scripts (`dev`, `test`, `lint`, `typecheck`)
- [ ] Add `.env.example` and config loading strategy
- [ ] Add baseline CI workflow (lint + tests)

**Definition of Done**
- `turbo run dev` starts backend + frontend.
- CI passes on a clean clone.

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

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement local text file ingestion
- [ ] Implement AO3 ingestion adapter (with rate-limit + compliance guardrails)
- [ ] HTML/tag stripping + whitespace normalization
- [ ] Store cleaned text + metadata in `documents` table
- [ ] Add ingestion endpoint + job record creation
- [ ] Add tests for malformed HTML and odd whitespace

**Definition of Done**
- Inputs from AO3/text become valid `cleaned_document` JSON.

---

## M3 — Segmentation Pass (LLM) + Chunk Merge

**Objective:** Segment long texts reliably with global offset integrity.

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement chunking strategy (window + overlap)
- [ ] Implement segmentation prompt call via Ollama
- [ ] Parse + validate JSON response
- [ ] Convert chunk-local offsets to global offsets
- [ ] Deterministic overlap reconciliation/merge
- [ ] Run full-document validators post-merge
- [ ] Add retry policy for malformed LLM output
- [ ] Add tests for chunk boundary edge cases

**Definition of Done**
- Long chapters produce contiguous validated spans persisted in SQLite.

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

- [ ] Multi-voice style presets per project
- [ ] Pronunciation dictionary per character
- [ ] Emotion/prosody controls
- [ ] Batch project queue UI
- [ ] EPUB ingestion adapter

---

## Execution Order (Recommended)

`M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8`

Reasoning:
- M1 first avoids costly refactors later.
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

- **Last updated:** 2026-04-19
- **Completed this session:**
  - [x] M1 SQLite+Drizzle schema baseline implemented (`documents`, `spans`, `attributions`, `voices`, `voice_mappings`, `synthesis_jobs`, `synthesis_segments`)
  - [x] Baseline migration + migration workflow docs added
  - [x] Deterministic span validators implemented with machine-readable error reports
  - [x] Validator edge-case unit tests added (19 passing)
  - [x] Local storage layout created (`data/voices`, `data/outputs`)
- **Next immediate task:** M0 - initialize Turborepo app/package skeleton (`apps/api`, `apps/web`, `packages/shared`) and root dev workflow
- **Blockers:** `npm` is unavailable in this runtime, so Drizzle migration commands were documented but not executed here
- **Resume commands:**
  - `cd ~/repos/auralia`
  - `git pull`
  - `pytest tests/validators -q`
  - `npm --workspace @auralia/db run db:migrate`

---

## Progress Snapshot

- M0 Repo & Tooling Skeleton: ⬜
- M1 Contracts + Validators: ✅
- M2 Ingestion & Cleaning: ⬜
- M3 Segmentation + Chunk Merge: ⬜
- M4 Attribution + Review Flags: ⬜
- M5 Voice Registry API + Voice Management: ⬜
- M6 React Review + Speaker Corrections: ⬜
- M7 Synthesis + Assembly: ⬜
- M8 Quality + Hardening: ⬜
