# Auralia

Auralia is a fully local pipeline for turning prose (AO3 exports or plain text files) into **character-aware, voice-cast audiobooks**.

The project is designed to run offline, with deterministic validation around LLM outputs to keep generation reliable and cost-efficient.

---

## Project Goals

- Convert long-form prose into high-quality audiobook output
- Preserve narrative structure (`narration` vs `dialogue`) with precise text offsets
- Attribute dialogue to speakers, then map speakers to chosen voices
- Keep the workflow local-first and reproducible
- Minimise token usage by using hard-coded validation and merge logic where possible

---

## Architecture

- **Backend:** FastAPI
- **Frontend:** React
- **Monorepo:** Turborepo

Auralia is split into a backend API/service layer and a frontend review/mapping UI, managed in one monorepo.

---

## Core Pipeline

1. **Ingestion & Cleaning**
   - Import AO3/local text
   - Remove HTML/tags and normalise whitespace

2. **Segmentation (LLM Pass 1)**
   - Use Ollama + Qwen 2.5 7B to split text into ordered spans
   - Label spans as `narration` or `dialogue`
   - Track exact `start`/`end` offsets

3. **Attribution (LLM Pass 2)**
   - Assign speakers for dialogue spans
   - Mark uncertain outputs as `UNKNOWN`

4. **UI Review Gate (React)**
   - Resolve `UNKNOWN` speakers before synthesis
   - Assign VoxCPM voices to each character
   - Persist mappings in JSON

5. **Synthesis & Assembly**
   - Generate per-span audio with VoxCPM
   - Concatenate segments with FFmpeg into final audiobook files

---

## Model & Tools

- **Segmentation + attribution:** Ollama (Qwen 2.5 7B, Q4KM)
- **TTS synthesis:** VoxCPM
- **Audio assembly:** FFmpeg
- **Validation layer:** deterministic hard-coded checks in backend

---

## Reliability & Cost Controls

Auralia intentionally uses deterministic backend logic for:

- JSON/schema validation
- Offset continuity and overlap checks
- Text reconstruction checks
- Chunk merge/reconciliation
- Synthesis preflight blocking when review flags remain

This reduces retries, token spend, and downstream synthesis failures.

---

## Hardware Target

Optimised for:

- **RAM:** 32 GB
- **GPU:** RTX 3080 (10–12 GB VRAM)

Operational assumptions:

- Run Qwen 2.5 7B in Q4KM to keep VRAM usage manageable
- Run segmentation and synthesis sequentially to avoid OOM
- Use CPU offloading where needed during synthesis

---

## Current Status

Repository is currently a skeleton with project direction and pipeline contract defined in [`PLAN.md`](./PLAN.md).
