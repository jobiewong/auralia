# Auralia Implementation Plan

> Living plan for execution tracking across sessions.
> Update this file at the end of each work block.

## Goal

Build a fully local, character-aware audiobook pipeline that converts prose into voice-cast audio with deterministic validation gates and a mandatory UI review step for unknown speakers.

## Architecture Summary

- **Monorepo:** Turborepo
- **Backend:** FastAPI (ingestion, LLM orchestration, validation, synthesis pipeline)
- **Frontend:** React (speaker review + voice mapping UI)
- **LLM Runtime:** Ollama + Qwen 2.5 7B (segmentation + attribution)
- **TTS:** VoxCPM
- **Assembly:** FFmpeg

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

## M1 — Data Contracts + Deterministic Validators

**Objective:** Lock stage interfaces and harden non-LLM correctness checks.

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement schemas for:
  - [ ] `cleaned_document`
  - [ ] `spans_pass1`
  - [ ] `spans_pass2_attributed`
  - [ ] `voice_map`
  - [ ] `synthesis_manifest`
- [ ] Implement deterministic validators:
  - [ ] schema/type validation
  - [ ] contiguity (`next.start == prev.end`)
  - [ ] non-overlap
  - [ ] full coverage (0..len(text))
  - [ ] exact reconstruction (`join(span.text) == text`)
  - [ ] offset-text consistency (`text[start:end] == span.text`)
- [ ] Add machine-readable error report format
- [ ] Add unit tests for all validator edge cases

**Definition of Done**
- Validation suite catches malformed spans and blocks pipeline progression.
- Unit tests cover nominal + edge conditions (gaps, overlaps, drift, invalid offsets).

---

## M2 — Ingestion & Cleaning

**Objective:** Produce normalized prose input with source metadata.

**Status:** ⬜ Not started

**Tasks**
- [ ] Implement local text file ingestion
- [ ] Implement AO3 ingestion adapter (with rate-limit + compliance guardrails)
- [ ] HTML/tag stripping + whitespace normalization
- [ ] Store cleaned text + metadata as `cleaned_document`
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
- Long chapters produce contiguous validated `spans_pass1` output.

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
- `spans_pass2_attributed` generated with deterministic checks and review flags.

---

## M5 — React Review UI + Voice Mapping

**Objective:** Manual correction gate before synthesis.

**Status:** ⬜ Not started

**Tasks**
- [ ] Build character/speaker review screen
- [ ] Build unresolved item queue (`UNKNOWN` + low-confidence)
- [ ] Enable inline speaker correction per span
- [ ] Build voice assignment UI per character + narrator
- [ ] Persist `voice_map.json`
- [ ] Implement backend preflight block if unresolved flags remain
- [ ] Add frontend integration tests for review flow

**Definition of Done**
- User cannot start synthesis while unresolved `needs_review` spans exist.

---

## M6 — Synthesis & FFmpeg Assembly

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

## M7 — Quality, Observability, and Hardening

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

`M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7`

Reasoning:
- M1 first avoids costly refactors later.
- M3/M4 depend on contracts and validators.
- M5 is a hard gate for unknown speakers before M6 synthesis.

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
  - [x] Initial repo created and pushed
  - [x] `PLAN.md` created and expanded
  - [x] `README.md` aligned with architecture and goals
- **Next immediate task:** M0 - initialize Turborepo app/package skeleton
- **Blockers:** None
- **Resume commands:**
  - `cd ~/repos/auralia`
  - `git pull`

---

## Progress Snapshot

- M0 Repo & Tooling Skeleton: ⬜
- M1 Contracts + Validators: ⬜
- M2 Ingestion & Cleaning: ⬜
- M3 Segmentation + Chunk Merge: ⬜
- M4 Attribution + Review Flags: ⬜
- M5 React Review + Voice Mapping: ⬜
- M6 Synthesis + Assembly: ⬜
- M7 Quality + Hardening: ⬜
