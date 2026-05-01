# M5 Voice Registry API + React Voice Management Plan

## Summary

Implement reusable local Qwen3-TTS voice profiles with imported audio assets, validation, preview generation, and per-document voice assignments for narrator and cast members. Use the existing `voices` and `voice_mappings` tables as the base, add only the missing schema hardening needed for M5, expose the voice library at `/voices`, and keep frontend workflows on TanStack Start server functions.

## Key Changes

- Add a backend voice module for profile CRUD, multipart asset import, validation, preview generation, and mapping persistence.
- Add a local Qwen3-TTS provider boundary for preview generation first, then reuse it for M7 synthesis.
- Store all uploaded audio under `data/voices/<voice_id>/...`; never rely on user-supplied local file paths after import.
- Support three voice modes:
  - `designed`: requires `display_name`, `mode`, non-empty `control_text`.
  - `clone`: requires `display_name`, `mode`, imported `reference_audio_path`.
  - `hifi_clone`: requires `display_name`, `mode`, imported `prompt_audio_path`, non-empty `prompt_text`.
- Define validation as a deterministic readiness check for preview/synthesis:
  - required fields present by mode
  - numeric params within configured bounds
  - asset paths resolve inside `data/voices`
  - audio files exist, are non-empty, and use allowed audio extensions
  - use `ffprobe` when available for readable-audio metadata; report warning if unavailable
- Generate short preview clips only after validation passes, using a random sentence selected from one preset preview sentence array shared by all voice types.
- Generate previews with local Qwen3-TTS. Keep the silent/fake generator only as a test fallback.
- Add a root-page link to the voice library route at `/voices`.
- Add voice assignment controls to the chapter Cast route.

## Implementation Changes

- **Database**
  - Reuse existing `voices` and `voice_mappings` tables.
  - Add migration for missing M5 constraints/indexes:
    - unique mapping per `(document_id, speaker)`
    - indexes for voice listing/filtering
    - any preview/asset metadata columns only if needed by the final API shape.
  - Keep `voice_mappings` per document. Book-level autofill/inference is out of scope for M5.

- **FastAPI**
  - Add endpoints:
    - `POST /api/voices` for multipart profile creation with optional audio upload.
    - `GET /api/voices`
    - `GET /api/voices/{voice_id}`
    - `PATCH /api/voices/{voice_id}` for metadata/params and optional replacement audio upload.
    - `DELETE /api/voices/{voice_id}` blocks when mappings exist.
    - `DELETE /api/voices/{voice_id}?force=true` deletes mappings and removes the voice.
    - `POST /api/voices/{voice_id}/validate`
    - `POST /api/voices/{voice_id}/preview`
  - Add mapping endpoints or server-function-backed equivalents for:
    - list document speakers plus current mappings
    - upsert narrator/cast voice mapping
    - clear mapping
  - Error behavior:
    - `404` for missing voice/document.
    - `409` for delete blocked by mappings.
    - `422` for invalid profile, invalid upload, unsafe asset path, or failed validation.
    - `502` only if preview generation depends on an unavailable external/local TTS runtime.

- **Frontend**
  - Add `/voices` as the voice library screen.
  - Add or update the root page link so users can navigate to `/voices`.
  - Build voice library UI using TanStack Start server functions:
    - list voices
    - create/edit/delete profiles
    - upload reference/prompt audio
    - validate profile
    - generate/play preview clip
  - Add voice assignment UI to the existing chapter Cast route:
    - include a special narrator row
    - show each active cast member
    - select a saved voice by `voice_id`
    - persist mappings in `voice_mappings`
    - show unmapped state clearly.
  - Force delete UI must explicitly warn that existing document mappings for that voice will be removed.

- **Preview Generation**
  - Define one preset array of preview sentences in the backend voice module.
  - `POST /api/voices/{voice_id}/preview` randomly selects one sentence from that array for every mode.
  - The endpoint validates first, generates a short clip, saves it under `data/voices/<voice_id>/previews/`, and returns the selected sentence plus a playable path or API URL.
  - Use the `qwen-tts` Python package through a local provider wrapper. The wrapper should accept text, output path, language, mode, and mode-specific voice inputs.
  - Initial provider mapping:
    - `designed`: use Qwen3-TTS VoiceDesign with `control_text` as the natural-language voice instruction.
    - `clone`: use Qwen3-TTS Base voice clone with `reference_audio_path` as the reference clip.
    - `hifi_clone`: use Qwen3-TTS Base voice clone with `prompt_audio_path` and `prompt_text`.
  - Prefer the 0.6B models for first local previews; make 1.7B model IDs configurable.

## Test Plan

- Backend tests:
  - create/list/detail/update/delete voices for all modes
  - multipart upload stores files under `data/voices/<voice_id>/`
  - validation fails for missing `control_text`, missing reference audio, missing prompt audio, missing prompt text
  - validation fails for missing/empty/unsafe asset files
  - delete blocks when `voice_mappings` exist
  - force delete removes mappings and profile/assets
  - mapping upsert enforces one `(document_id, speaker)` row
  - preview uses one of the preset sentences for all voice modes
  - preview blocks when validation fails and returns a persisted clip when preview generation succeeds via fake TTS.

- Frontend tests:
  - root page links to `/voices`
  - voice library create/edit/delete flow
  - mode-specific form fields and validation messages
  - upload field behavior
  - preview action success/failure states
  - chapter Cast route narrator/cast voice assignment persists and refreshes.

- Verification commands:
  - backend targeted pytest for voice tests
  - frontend Vitest for voice/mapping UI tests
  - repo lint/typecheck if targeted tests pass.

## Assumptions And Defaults

- Allowed upload extensions: `.wav`, `.mp3`, `.flac`, `.m4a`, `.ogg`.
- Validation is readiness, not audio quality assessment.
- Preview generation is included in M5, but full synthesis remains M7.
- Qwen3-TTS model IDs, cache path, device, dtype, and default language should be configurable via environment variables.
- React data mutations use TanStack Start server functions, matching existing app patterns.
- Voice mappings remain document-scoped for M5.
- Deleting a voice removes its imported assets after DB deletion succeeds; blocked deletes leave assets untouched.
