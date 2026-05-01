# Implementation plan

Living roadmap for Auralia. Update at the end of each work block.

## Goal

A fully local, character-aware audiobook pipeline that converts prose into voice-cast audio with deterministic validation gates and a mandatory UI review step before synthesis.

## Architecture

- **Monorepo:** Turborepo
- **Backend:** FastAPI — ingestion, LLM orchestration, validation, synthesis
- **Frontend:** React with TanStack Start (file routes, SSR-capable) — review + voice mapping UI
- **Database:** SQLite (local, single-user) via Drizzle ORM + migrations
- **LLM runtime:** Ollama + Qwen3 8B (attribution + optional cast canonicalization)
- **TTS:** Local Qwen3-TTS (preview generation + synthesis)
- **Assembly:** FFmpeg
- **Binary assets:** local filesystem

## Pipeline stages

1. **Ingestion** — fetch AO3 chapter or accept plain text; normalize and store.
2. **Segmentation** — deterministic quote-pair splitter; label narration/dialogue with exact offsets.
3. **Cast detection** — harvest explicit speaker-tag evidence; build editable character roster.
4. **Attribution** — assign speakers to dialogue spans; flag uncertain outputs for review.
5. **Voice registry** — manage reusable Qwen3-TTS voice profiles; assign voices to characters.
6. **Synthesis** — generate per-span audio; assemble final WAV with FFmpeg.

See `docs/pipeline/` for per-stage architecture and code structure.

---

## Milestones

### M0 — Repo & tooling skeleton

**Status:** ✅ Complete

Turborepo workspace with `apps/api`, `apps/web`, `packages/db`, `packages/shared`. Python FastAPI scaffold, React TanStack Start scaffold, shared schema package, root `dev`/`test`/`lint`/`typecheck` scripts, `.env.example`, GitHub Actions CI.

---

### M1 — SQLite schema + deterministic validators

**Status:** ✅ Complete

Drizzle schema and migrations for all core tables (`documents`, `spans`, `attributions`, `voices`, `voice_mappings`, `synthesis_jobs`, `synthesis_segments`). Six deterministic span validators (contiguity, non-overlap, coverage, reconstruction, offset-text consistency, schema). Machine-readable error report format. Full validator unit tests.

**Delivered artifacts:**
- `packages/db/drizzle/` — schema and migrations
- `apps/api/src/auralia_api/validators/`
- `tests/validators/`
- `docs/guides/migrations.md`

---

### M2 — Ingestion & cleaning

**Status:** ✅ Complete

Plain-text and AO3 ingestion endpoints. Multi-pass text cleaning (HTML stripping, markdown removal, whitespace normalization, typographic normalization). AO3 guardrails (Cloudflare UA workaround, 2-second rate gate, response size limit, restricted-work redirect detection). Work-level metadata captured in `source_metadata`.

**Delivered artifacts:**
- `apps/api/src/auralia_api/ingestion/`
- `POST /api/ingest/text`, `POST /api/ingest/ao3`
- Drizzle migrations: `0001_m2_documents_source_metadata.sql`, `0002_m2_ingestion_jobs.sql`
- `tests/ingestion/`
- `docs/pipeline/ingestion.md`

---

### M3 — Segmentation (deterministic quote splitter)

**Status:** ✅ Complete

Replaced planned LLM-based segmentation with a deterministic O(n) quote-pair splitter after early testing showed `qwen3:8b` produced degenerate offset patterns on the task. Ingestion-normalized `"` quotes allow near-perfect segmentation at zero LLM cost.

**Delivered artifacts:**
- `apps/api/src/auralia_api/segmentation/`
- `POST /api/segment` (+ `?force=true` with full downstream invalidation)
- Drizzle migration: `0003_m3_segmentation_jobs.sql`
- `tests/segmentation/`
- `docs/pipeline/segmentation.md`

---

### M4 — Attribution (LLM + deterministic pre-pass)

**Status:** ⏸ Accepted — satisfactory for production use; benchmark evaluation deferred

Three-tier pipeline: deterministic `X said` pre-pass (~40–70% of spans resolved, confidence 1.0) + windowed LLM attribution for unresolved spans + cross-stage merge validators. Tolerant JSON parsers, retry-with-feedback, and `needs_review` flags for uncertain outputs. Validated against real Qwen3 8B.

**Delivered artifacts:**
- `apps/api/src/auralia_api/attribution/`
- `POST /api/attribute`
- Drizzle migrations: `0004_m4_attribution_jobs.sql`, `0005_m4_documents_roster.sql`
- `tests/attribution/` (44 tests)
- `docs/pipeline/attribution.md`

**Deferred:**
- Benchmark fixture set (20 hand-labeled excerpts) and opt-in benchmark test.
- Measured prompt/threshold tuning.

---

### M4.5 — Cast detection

**Status:** 🟨 Mostly complete — core functionality done; alias-merge evaluation and manual merge UI remain

Dedicated cast detection stage decoupled from attribution. Deterministic explicit speaker-tag harvesting using regex patterns against a 44-verb closed list. Optional compact LLM canonicalization pass (`use_llm=true`). Editable cast roster with evidence rows. Attribution refactored to consume persisted cast instead of running internal roster extraction. Force-rerun cascade preserving manual cast edits.

**Delivered artifacts:**
- `apps/api/src/auralia_api/cast_detection/`
- `POST /api/detect-cast` (+ `?use_llm=true` + `?force=true`)
- Drizzle migrations: cast detection tables
- `docs/pipeline/cast-detection.md`

**Remaining:**
- Expand LLM alias-merge evaluation fixtures (`Remus` ↔ `Mr Lupin`, surname-only references, titles).
- Manual merge UI for combining cast members and aliases.
- Benchmark report for explicit-speaker recall and alias-merge accuracy.

---

### M5 — Voice registry + voice management UI

**Status:** ✅ Complete — backend and frontend implemented

Reusable Qwen3-TTS voice profiles stored in SQLite with local audio assets. Three voice modes: `designed` (control text), `clone` (reference audio), `hifi_clone` (reference audio + transcript). Voice preview generation via isolated Qwen subprocess. Voice library screen at `/voices`. Per-document voice assignment UI on the Cast route.

**Delivered artifacts:**
- `apps/api/src/auralia_api/voices/`
- `GET/POST /api/voices`, `PUT/DELETE /api/voices/{id}`, `GET /api/voices/{id}/preview`, `POST /api/voices/{id}/generate`
- `GET/POST /api/documents/{document_id}/voice-mappings`
- `/voices` frontend route (voice library screen)
- Voice assignment section on Cast route
- `docs/pipeline/voice-registry.md`
- `docs/guides/qwen3-tts-setup.md`

---

### M6 — Review gate + speaker corrections

**Status:** ⬜ Not started

Manual correction gate for uncertain attribution before synthesis. Unresolved item queue for `UNKNOWN` and low-confidence spans. Inline speaker correction per span. Hard gate: synthesis cannot start while any `needs_review = true` attribution exists.

**Tasks:**
- [ ] Build unresolved item queue (`UNKNOWN` + low-confidence spans)
- [ ] Enable inline speaker correction per span in the text view
- [ ] Enforce synthesis gate: block synthesis button while unresolved spans exist
- [ ] Add frontend integration tests for review flow

---

### M7 — Synthesis & FFmpeg assembly

**Status:** ✅ Complete

Background job synthesis gated behind full readiness check (reviewed attributions, complete voice mappings, no `UNKNOWN` speakers, no plain `clone` voices). Per-span Qwen generation with 3-sentence internal chunking, hash-based span caching, and FFmpeg final assembly. JSON manifest output. Frontend synthesis screen with readiness state, blockers list, progress display, output playback, and regeneration controls.

**Delivered artifacts:**
- `apps/api/src/auralia_api/synthesis/`
- `POST /api/synthesize`, `GET /api/synthesis/{job_id}/output`, `GET /api/synthesis/{job_id}/manifest`
- Drizzle migration: `0013_m7_synthesis_diagnostics.sql`
- `tests/synthesis/`
- `docs/pipeline/synthesis.md`

---

### M8 — Quality, observability & hardening

**Status:** ⬜ Not started

**Tasks:**
- [ ] Structured logs + run IDs across all pipeline stages
- [ ] Resume/retry behavior for failed/incomplete jobs
- [ ] Dashboard metrics: JSON parse success rate, validator pass/fail rate, unresolved speaker count, sec/1k chars
- [ ] Golden test fixtures for deterministic regression testing
- [ ] Attribution benchmark fixtures and opt-in benchmark test (carried from M4)
- [ ] Local ops and troubleshooting documentation

---

## Backlog (post-MVP)

- Automatically download required local models on startup when missing (opt-in with progress reporting)
- Optionally auto-start local model runtimes on app startup (health-check gated, timeout/fallback)
- Multi-voice style presets per project
- Pronunciation dictionary per character
- Emotion/prosody controls
- Batch project queue UI
- EPUB ingestion adapter
- AO3 multi-chapter crawler (foundation in place via `next_chapter_url` capture)

---

## Execution order

`M0 → M1 → M2 → M3 → M4.5 → M4 → M5 → M6 → M7 → M8`

M0–M1 lock schema and validators before ingestion and LLM stages. M4.5 builds the cast before M4 attribution consumes it. M5 establishes the Qwen TTS provider and voice library that M7 synthesis reuses. M6 is a hard gate for unknown speakers before M7 synthesis.

Current position: M5 and M7 complete, M4.5 mostly complete. Next focus: M6 review gate.

---

## Progress snapshot

| Milestone | Status |
|-----------|--------|
| M0 Repo & tooling | ✅ Complete |
| M1 Schema + validators | ✅ Complete |
| M2 Ingestion & cleaning | ✅ Complete |
| M3 Segmentation | ✅ Complete |
| M4 Attribution | ⏸ Accepted (benchmarking deferred) |
| M4.5 Cast detection | 🟨 Mostly complete |
| M5 Voice registry | ✅ Complete |
| M6 Review gate | ⬜ Not started |
| M7 Synthesis | 🟨 Backend complete, UI pending |
| M8 Quality & hardening | ⬜ Not started |
