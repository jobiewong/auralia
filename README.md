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

## Voice Persistence (New Requirement)

Auralia includes a **Voice Registry** so voices can be reused across chapters/books.

Two supported voice modes:

1. **Designed Voice (text prompt only)**
   - Persist `control_text` + generation params
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
