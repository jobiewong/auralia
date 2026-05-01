# Voice registry

The voice registry is a library of reusable local Qwen3-TTS voice profiles. Voices are created once and assigned to characters (and narration) per document. Assignments are stored in `voice_mappings` and consumed by synthesis.

## Voice modes

Three modes define how a voice is generated:

| Mode         | Required inputs                             | How it works                                     |
|--------------|---------------------------------------------|--------------------------------------------------|
| `designed`   | `display_name`, `control_text`              | Natural-language description fed to Qwen3-TTS VoiceDesign model |
| `clone`      | `display_name`, `reference_audio_path`      | Clones voice from a reference audio clip         |
| `hifi_clone` | `display_name`, `prompt_audio_path`, `prompt_text` | High-fidelity clone using a reference clip with its exact transcript |

Plain `clone` voices are not supported for synthesis in the current version — only `designed` and `hifi_clone` can be used in the synthesis pipeline. This restriction exists because the generation contract for `clone` mode is not yet fully defined.

## Storage layout

```
data/
  voices/
    <voice_id>/
      reference.wav        (clone mode)
      prompt.wav           (hifi_clone mode)
      previews/
        <timestamp>.wav    (generated preview clips)
```

Structured metadata is stored in the `voices` SQLite table. File paths stored in the DB are always relative to the repo root and are validated before use.

## Backend API

| Method | Endpoint                          | Description                                          |
|--------|-----------------------------------|------------------------------------------------------|
| `GET`  | `/api/voices`                     | List all voice profiles                              |
| `POST` | `/api/voices`                     | Create a new voice (multipart form with optional audio upload) |
| `PUT`  | `/api/voices/{voice_id}`          | Update voice metadata or replace audio              |
| `DELETE` | `/api/voices/{voice_id}`        | Delete voice (blocked if voice is mapped to documents) |
| `GET`  | `/api/voices/{voice_id}/preview`  | Stream the stored preview audio clip                |
| `POST` | `/api/voices/{voice_id}/generate` | Generate a new preview clip using Qwen3-TTS         |

Voice mappings (character → voice assignment per document):

| Method | Endpoint                                    | Description                         |
|--------|---------------------------------------------|-------------------------------------|
| `GET`  | `/api/documents/{document_id}/voice-mappings` | List current speaker → voice assignments |
| `POST` | `/api/documents/{document_id}/voice-mappings` | Upsert a speaker → voice assignment |

## Qwen3-TTS integration

FastAPI calls Qwen3-TTS through an isolated subprocess via `qwen_tts.py`. The subprocess uses the `AURALIA_QWEN_TTS_PYTHON` interpreter (the Qwen conda environment, not the project `.venv`). This isolation prevents Numba/librosa cache conflicts and keeps the Qwen dependencies separate from the FastAPI dependencies.

The subprocess:
- Imports the `qwen_tts` Python package and loads the appropriate model.
- Accepts text, output path, language, mode, and mode-specific voice inputs via JSON on stdin.
- Writes the generated WAV to the specified output path.
- Prints structured status lines to stdout for logging.

Model IDs, device (`cuda:0` or `cpu`), dtype (`bfloat16` or `float32`), and timeout are all configurable via `AURALIA_QWEN_TTS_*` environment variables. See [`docs/guides/qwen3-tts-setup.md`](../guides/qwen3-tts-setup.md) for setup instructions.

## Validation

Voice validation is a deterministic readiness check run before preview generation and before synthesis:

- Required fields present per mode (e.g., `control_text` for `designed`, audio file for `clone`).
- Numeric params within bounds (`temperature` in `[0, 2]`).
- Asset paths resolve inside `data/voices/` (no path traversal).
- Audio files exist, are non-empty, and use allowed extensions: `.wav`, `.mp3`, `.flac`, `.m4a`, `.ogg`.

## Voice mappings

Voice mappings are document-scoped: each document has its own `NARRATOR → voice_id` mapping and per-speaker mappings for every attributed cast member. Mappings are stored in `voice_mappings` with a unique constraint on `(document_id, speaker)`.

The `NARRATOR` key is required for synthesis and covers all narration spans. Every non-UNKNOWN attributed speaker that appears in the document's attributions must also have a mapping before synthesis can run.

## Code structure

```
apps/api/src/auralia_api/voices/
  __init__.py
  schemas.py          # Pydantic request/response models
  service.py          # CRUD + validation + preview generation
  storage.py          # SQLite inserts/queries (mirrors Drizzle schema)
  qwen_tts.py         # subprocess invocation + result parsing
  qwen_tts_cli.py     # standalone CLI wrapper for direct TTS use
```

## Frontend

The `/voices` route is the voice library screen. It supports creating, editing, deleting, and generating previews for voice profiles. The Cast route for each document includes a voice assignment section where `NARRATOR` and each cast member can be mapped to a saved voice.
