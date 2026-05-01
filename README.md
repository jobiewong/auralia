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
- **Frontend:** React (TanStack Start + Vite; default dev server port **3000**)
- **Monorepo:** Turborepo

Auralia is split into a backend API/service layer and a frontend review/mapping UI, managed in one monorepo.

---

## Quick start: testing

Run everything from the **repository root** unless noted.

### Prerequisites

- **Node.js** 22 or newer and **npm** 10 or newer (aligned with CI).
- **Python** 3.12 or newer (3.11+ is allowed by `pyproject.toml`; CI uses 3.12).

### One-time setup

Use a shell whose working directory is the repository root (the directory that contains `package.json` and `pyproject.toml`).

```bash
npm install
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

The Python step installs the root package (`auralia-api`) in editable mode with **pytest**, **ruff**, and **mypy** so backend tests and linters match what Turborepo runs for `@auralia/api`.

### Local Qwen3-TTS setup

Voice preview generation uses an isolated local Qwen3-TTS Python environment. Keep this separate from Auralia's `.venv`; the FastAPI app calls the Qwen interpreter by absolute path through `AURALIA_QWEN_TTS_PYTHON`.

Install Miniconda if `conda` is not already available; the longer setup guide includes Linux/WSL install commands. Then create the Qwen environment from any directory:

```bash
conda create -n qwen3-tts python=3.12 -y
conda activate qwen3-tts
python -m pip install --upgrade pip
pip install -U qwen-tts soundfile
conda install -c conda-forge sox -y
```

Point the repo-root `.env` at that interpreter:

```env
AURALIA_QWEN_TTS_PYTHON=/home/jobie/miniconda3/envs/qwen3-tts/bin/python
AURALIA_QWEN_TTS_VOICE_DESIGN_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign
AURALIA_QWEN_TTS_VOICE_CLONE_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base
AURALIA_QWEN_TTS_DEVICE=cuda:0
AURALIA_QWEN_TTS_DTYPE=bfloat16
AURALIA_QWEN_TTS_DEFAULT_LANGUAGE=English
AURALIA_QWEN_TTS_TIMEOUT_SECONDS=300
AURALIA_QWEN_TTS_NUMBA_CACHE_DIR=/tmp/auralia-numba-cache
```

Adjust `AURALIA_QWEN_TTS_PYTHON` if your conda install is elsewhere. On non-CUDA machines, use `AURALIA_QWEN_TTS_DEVICE=cpu` and `AURALIA_QWEN_TTS_DTYPE=float32`; this is much slower.

Verify the Qwen environment before starting FastAPI:

```bash
NUMBA_CACHE_DIR=/tmp/auralia-numba-cache \
PATH=/home/jobie/miniconda3/envs/qwen3-tts/bin:$PATH \
/home/jobie/miniconda3/envs/qwen3-tts/bin/python -c "import torch; print(torch.cuda.is_available()); import qwen_tts; print('qwen ok')"
```

For a CUDA setup, this should print `True` and `qwen ok`. If it prints `False`, PyTorch cannot see your GPU from that environment, and Auralia's preview endpoint will fail fast when configured with `cuda:0`.

The first real preview may download model weights from Hugging Face and take longer than later runs. After the weights are cached, the same model ID can be used offline as long as the cache remains available. You can also set `AURALIA_QWEN_TTS_VOICE_DESIGN_MODEL` to a local model directory.

FlashAttention is optional. Without it, Qwen3-TTS still works but may generate more slowly and use more VRAM. Try it only after baseline generation works:

```bash
conda activate qwen3-tts
pip install packaging ninja
MAX_JOBS=1 NVCC_THREADS=1 pip install flash-attn --no-build-isolation --no-cache-dir
```

This may fail on newer Python/PyTorch/CUDA combinations if no matching wheel exists or if source compilation runs out of memory. The app automatically retries model loading without FlashAttention.

See [`docs/qwen3_tts_setup.md`](./docs/qwen3_tts_setup.md) for the longer setup and troubleshooting notes.

### Run tests

**Whole monorepo (Turborepo):** runs each workspace’s `test` script (Python `pytest` for the API, Vitest for the web app, and no-op stubs where packages have no tests yet).

```bash
npm test
```

**Python / FastAPI package only** (same command Turborepo uses for `@auralia/api`):

```bash
npm run test -w @auralia/api
```

Or call pytest directly from the repo root:

```bash
pytest
pytest tests/validators -q
```

**Frontend (`@auralia/web`) only:**

```bash
npm run test -w @auralia/web
```

**Watch mode while editing the UI** (re-runs on save; run from `apps/web`):

```bash
cd apps/web && npx vitest
```

### Match CI locally

Continuous integration runs lint, tests, and typecheck together. From the repo root:

```bash
npx turbo run lint test typecheck
```

### Run dev servers

From the repository root, Turborepo starts every workspace that defines a `dev` script (currently the FastAPI API and the web app):

```bash
npm run dev
```

- **API:** [http://127.0.0.1:8000](http://127.0.0.1:8000) (health: `/health`, sample JSON: `/api/info`)
- **Web:** [http://localhost:3000](http://localhost:3000) (TanStack Start CLI default port)

Ensure your root `.env` (see `.env.example`) lists the web origin in `AURALIA_CORS_ORIGINS` if the browser calls the API cross-origin.

---

## Core Pipeline

1. **Ingestion & Cleaning**
   - Import AO3/local text
   - Remove HTML/tags and normalise whitespace

2. **Segmentation (Deterministic)**
   - Use the quote-pair splitter to split text into ordered spans
   - Label spans as `narration` or `dialogue`
   - Track exact `start`/`end` offsets

3. **Cast Detection**
   - Harvest explicit speaker-tag evidence from segmented text
   - Persist editable cast members and evidence rows
   - Optionally run a compact LLM canonicalization pass with `use_llm=true`

4. **Attribution**
   - Assign speakers for dialogue spans
   - Consume the persisted cast/legacy roster as the allowed speaker set
   - Mark uncertain outputs as `UNKNOWN`

5. **UI Review Gate (React)**
   - Resolve `UNKNOWN` speakers before synthesis
   - Assign local Qwen3-TTS voice profiles to each character
   - Persist mappings in SQLite

6. **Synthesis & Assembly**
   - Generate per-span audio with local Qwen3-TTS
   - Concatenate segments with FFmpeg into final audiobook files

### Pipeline reruns and downstream resets

Completed pipeline stages can be re-run from the document status/text views by long-pressing the completed stage button and confirming the destructive rerun.

- Re-running **Segmentation** deletes/regenerates spans and resets downstream cast detection, attribution, and synthesis-derived outputs.
- Re-running **Cast Detection** deletes regenerated cast/evidence and resets attribution and synthesis-derived outputs.
- Manual cast edits/deletions are preserved across both reruns, but preserved manual cast rows do not make Cast Detection appear complete. The UI treats the latest cast detection job status as the completion signal.
- Active job timers are based on the job row `created_at` timestamp, so the elapsed time remains accurate after closing and reopening the browser tab.

---

## Model & Tools

- **Attribution + optional cast canonicalization:** Ollama (Qwen3 8B, Q4_K_M)
- **Segmentation + deterministic cast harvest:** pure backend logic
- **TTS synthesis:** local Qwen3-TTS
- **Audio assembly:** FFmpeg
- **Validation layer:** deterministic hard-coded checks in backend

---

## Voice Persistence (New Requirement)

Auralia includes a **Voice Registry** so voices can be reused across chapters/books.

Two supported voice modes:

1. **Designed Voice (text prompt only)**
   - Persist `control_text` + Qwen sampling temperature
   - Optionally generate and save a canonical sample clip for stability

2. **Cloned Voice (reference audio)**
   - Persist canonical `reference_wav_path`
   - Optional Hi-Fi fields: `prompt_wav_path` + `prompt_text`

### Storage strategy (private/local-first)

For this personal offline tool, default to:

- **SQLite for structured data** (projects, chapters, spans, voice profiles, mappings, jobs)
- **Local filesystem for audio binaries** (reference clips, generated segments, final outputs)

Recommended paths:

- DB: `data/db/auralia.sqlite`
- Voice assets: `data/voices/<voice_id>/reference.wav`
- Optional prompt assets: `data/voices/<voice_id>/prompt.wav`

S3/R2 is **not required** right now. It can be added later behind a storage adapter if you need remote backup/sync.

### Schema management

You can use **Drizzle** to define and migrate the SQLite schema (especially if you want TypeScript-first schema control).

Recommended approach:

- Keep a single migration history as source of truth
- Route all writes through FastAPI endpoints (frontend should not write DB directly)
- Optionally generate shared TS/Python types from the same schema contracts

### API requirement

Backend will expose endpoints for creating, listing, updating, deleting, and validating reusable voice profiles.

Frontend React UI will use these endpoints for voice management and assignment.

---

## Reliability & Cost Controls

Auralia intentionally uses deterministic backend logic for:

- JSON/schema validation
- Offset continuity and overlap checks
- Text reconstruction checks
- Chunk merge/reconciliation
- Downstream reset/invalidation when upstream stages are force re-run
- Synthesis preflight blocking when review flags remain

This reduces retries, token spend, and downstream synthesis failures.

---

## Hardware Target

Optimised for:

- **RAM:** 32 GB
- **GPU:** RTX 3080 (10–12 GB VRAM)

Operational assumptions:

- Run Qwen3 8B in Q4_K_M to keep VRAM usage manageable
- Run LLM attribution/canonicalization and synthesis sequentially to avoid OOM
- Use CPU offloading where needed during synthesis

---

## Current Status

The core ingestion, deterministic segmentation, cast detection, and attribution pipeline is implemented. Upcoming work is focused on voice management, review gates, synthesis, and observability; see [`docs/plans/IMPLEMENTATION_PLAN.md`](./docs/plans/IMPLEMENTATION_PLAN.md).
