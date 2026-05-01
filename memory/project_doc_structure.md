---
name: Documentation structure
description: Layout and purpose of docs/ after the May 2026 documentation refactor
type: project
---

**Fact:** Documentation was refactored in May 2026 to a clean wiki structure. The old PLAN.md, apps/web/README.md, docs/plans/, docs/reports/, and scattered docs/ files were removed.

**Why:** Old docs were a mix of planning artifacts, stale boilerplate, and spec files that didn't reflect current implementation state.

**How to apply:** The canonical doc layout is:
- `README.md` — project intro, quick start, test commands only
- `docs/implementation-plan.md` — living milestone roadmap (update when milestones change)
- `docs/pipeline/ingestion.md` — ingestion & cleaning
- `docs/pipeline/segmentation.md` — deterministic quote-pair segmentation
- `docs/pipeline/cast-detection.md` — speaker cast detection
- `docs/pipeline/attribution.md` — LLM + deterministic attribution
- `docs/pipeline/voice-registry.md` — voice profiles, modes, Qwen TTS integration
- `docs/pipeline/synthesis.md` — background job synthesis + FFmpeg assembly
- `docs/guides/qwen3-tts-setup.md` — Qwen conda env setup
- `docs/guides/migrations.md` — Drizzle SQLite migration workflow
