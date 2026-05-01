# Auralia

Auralia is a fully local pipeline for turning prose (AO3 chapters or plain text) into character-aware, voice-cast audiobooks. It runs entirely offline, using deterministic validation around LLM outputs to keep the pipeline reliable.

**Stack:** FastAPI · React (TanStack Start) · SQLite · Ollama/Qwen3 · Qwen3-TTS · FFmpeg · Turborepo

See [`docs/`](./docs/) for architecture and pipeline documentation.

---

## Quick start

### Prerequisites

- **Node.js** 22+ and **npm** 10+
- **Python** 3.12+
- **Ollama** running locally with `qwen3:8b` pulled (for attribution and cast detection)
- **FFmpeg** available on `PATH` (for audio assembly)

### Setup

Run from the repository root:

```bash
npm install
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

Copy `.env.example` to `.env` and fill in any local paths, especially `AURALIA_QWEN_TTS_PYTHON` if you plan to use voice synthesis. See [`docs/guides/qwen3-tts-setup.md`](./docs/guides/qwen3-tts-setup.md) for the Qwen3-TTS environment setup.

### Run dev servers

```bash
npm run dev
```

- **API:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Web:** [http://localhost:3000](http://localhost:3000)

---

## Running tests

**Full monorepo:**

```bash
npm test
```

**Python/API only:**

```bash
npm run test -w @auralia/api
# or directly:
pytest
pytest tests/validators -q
```

**Frontend only:**

```bash
npm run test -w @auralia/web
```

**Match CI exactly** (lint + test + typecheck):

```bash
npx turbo run lint test typecheck
```

---

## Database migrations

```bash
npm --workspace @auralia/db run db:migrate
```

See [`docs/guides/migrations.md`](./docs/guides/migrations.md) for the full workflow.
