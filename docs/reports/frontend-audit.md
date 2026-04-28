# Frontend Audit Report

Date: 2026-04-28

## Conventions

| Rule | Decision |
|---|---|
| Server functions | New `server/` layer wraps `db/`; `db/` becomes pure Drizzle (no `createServerFn`) |
| Shared route-group components | `routes/<group>/-components/<name>.tsx` |
| Flat-file routes needing extraction | Convert to directory first (e.g. `voices.tsx` → `voices/index.tsx`) |
| Hooks | Always extract to `hooks/`, regardless of single/multi-use |
| Sub-component extraction threshold | Stateful, or complex JSX, or ~50+ lines |
| `db-collections/` | Split by domain |
| `lib/` | In scope; `pipeline-api.ts` → `server/`, `voices-api.ts` split by concern |

---

## 1. Server Layer

**Create** `server/works.ts` — `createServerFn` wrappers calling plain functions in `db/works.ts`
**Create** `server/documents.ts` — `createServerFn` wrappers calling plain functions in `db/documents.ts`
**Move** `lib/pipeline-api.ts` → `server/pipeline-api.ts` (imports HTTP helpers from `lib/http.ts`)

**Modify** `db/works.ts` — strip `createServerFn`; expose plain async functions only
**Modify** `db/documents.ts` — strip `createServerFn`; expose plain async functions only

All `~/db/works` and `~/db/documents` imports in route files and `db-collections/` update to `~/server/works` and `~/server/documents`.

---

## 2. Route Conversions

**Rename** `routes/voices.tsx` → `routes/voices/index.tsx` (needed for `-components/` subdir)

---

## 3. Component Extractions

### `routes/voices/index.tsx`

| Component | Lines | Reason | Destination |
|---|---|---|---|
| `VoiceDialog` | 343–599 (257 lines) | Complex form: `useForm`, zodResolver, conditional mode fields, file uploads | `routes/voices/-components/voice-dialog.tsx` |
| `VoiceItem` | 243–341 (99 lines) | Own `useState`, hosts `VoiceDialog` + `DeleteVoiceDialog`, collapsible audio | `routes/voices/-components/voice-item.tsx` |
| `DeleteVoiceDialog` | 601–676 (76 lines) | Own `useState` ×2 (open, forceDelete), checkbox state | `routes/voices/-components/delete-voice-dialog.tsx` |

`voiceFormSchema`, `VoiceModeSchema`, `PreviewStatus` type move with `VoiceDialog`.
**Keep inline**: `cleanOptional`, `hasNewUpload`, `previewInputsChanged` — single-use within `VoicesRoute`.

---

### `routes/library/$bookSlug/$documentId/index.tsx`

| Component | Lines | Reason | Destination |
|---|---|---|---|
| `PipelineRerunDialog` | 336–387 (52 lines) | Shared with `text.tsx` (identical copy exists there) | `routes/library/$bookSlug/$documentId/-components/pipeline-rerun-dialog.tsx` |
| `PipelineStage` | 389–458 (70 lines) | Complex JSX: motion animation, tooltip, conditional action + timer slots | `routes/library/$bookSlug/$documentId/-components/pipeline-stage.tsx` |
| `JobSummary` | 521–583 (63 lines) | Uses `useElapsedSecondsFromTimestamp` + `diffSeconds`, complex diagnostic display | `routes/library/$bookSlug/$documentId/-components/job-summary.tsx` |

**Keep inline**: `PipelineActionButton` (42 lines, no state), `JobTimer` (17 lines).
**Keep inline**: `isActiveJobStatus`, `getActivePipelineJob`, `getStageStatus`, `getStageTimerJob` — single-use pipeline utilities.

---

### `routes/library/$bookSlug/$documentId/text.tsx`

| Component | Lines | Reason | Destination |
|---|---|---|---|
| `PipelineRerunDialog` | 328–379 | Duplicate of index.tsx copy — remove here, import from `-components/` | *(deduplicated)* |
| `Span` | 399–457 (59 lines) | Contains `SpanAttributionEditor`, click handling, conditional display | `routes/library/$bookSlug/$documentId/-components/span.tsx` |
| `SpanAttributionEditor` | 459–506 (48 lines) | Own `useState` ×2 (speaker, isSaving), async save | `routes/library/$bookSlug/$documentId/-components/span-attribution-editor.tsx` |

**Keep inline**: `FilterButton` (17 lines, no state).
**Keep inline**: `getSpeakerOptions`, `getVisibleSpans`, `spanMatchesFilter`, `isReviewSpan` — single-use.

---

### `routes/library/$bookSlug/$documentId/cast.tsx`

| Component | Lines | Reason | Destination |
|---|---|---|---|
| `CastFormDialog` | 193–291 (99 lines) | Own `useState` ×3, `handleOpenChange`, `handleSubmit` | `routes/library/$bookSlug/$documentId/-components/cast-form-dialog.tsx` |
| `CastRow` | 299–381 (83 lines) | Uses `useVoiceAssignment`, `useServerFn`, own save/remove handlers | `routes/library/$bookSlug/$documentId/-components/cast-row.tsx` |
| `CastVoiceEditor` | 486–525 (40 lines) | Own `useState` ×2, `useEffect` sync | `routes/library/$bookSlug/$documentId/-components/cast-voice-editor.tsx` |

**Keep inline**: `NarratorVoiceRow` (24 lines).
**Keep inline**: `getCastPayload`, `getLegacySpeakers`, `getVoiceOptions`, `parseAliases`, `parseStats`, `getStatNumber` — single-use.

---

## 4. Hook Extractions

| Hook | Current Location | Destination |
|---|---|---|
| `useVoiceAssignment` | `cast.tsx` lines 408–484 | `hooks/use-voice-assignment.ts` |

---

## 5. `db-collections/` Domain Split

Split `db-collections/index.ts` (541 lines) into:

| File | Contents |
|---|---|
| `db-collections/voices.ts` | `VoiceSchema`, `Voice`, `createVoicesCollection`, `getVoicesCollection`, `preloadVoices`, `useVoices` |
| `db-collections/voice-mappings.ts` | `VoiceMappingSchema`, `VoiceMapping`, `createDocumentVoiceMappingsCollection`, `getDocumentVoiceMappingsCollection`, `useDocumentVoiceMappings` |
| `db-collections/books.ts` | `BookSchema`, `Book`, `createBooksCollection`, `getBooksCollection`, `preloadBooks`, `useBooks` |
| `db-collections/book-documents.ts` | `BookDocumentSchema`, `BookDocument`, `createBookDocumentsCollection`, `getBookDocumentsCollection`, `preloadBookDocuments`, `useBookDocuments` |
| `db-collections/document-spans.ts` | `DocumentSpanSchema`, `DocumentSpan`, `createDocumentSpansCollection`, `getDocumentSpansCollection`, `preloadDocumentSpans`, `useDocumentSpans` |
| `db-collections/document-diagnostics.ts` | `preloadDocumentDiagnostics`, `useDocumentDiagnostics`, `hasActivePipelineJob` |
| `db-collections/index.ts` | Re-export barrel from all above + `messagesCollection` |

---

## 6. `lib/` Reorganisation

### `lib/voices-api.ts` → split into 3

| File | Contents |
|---|---|
| `lib/voices.types.ts` | `VoiceMode`, `VoiceFormValues` (public types needed outside voices-api) |
| `lib/voices-api.ts` | Fetchers + transformers; imports HTTP helpers from `lib/http.ts` and types from `lib/voices.types.ts` |
| `lib/http.ts` | Shared HTTP helpers: `getJson`, `postJson`, `postForm`, `patchForm`, `deleteJson`, `handleJson`, `getErrorMessage` — consolidated from both `voices-api.ts` and `pipeline-api.ts` |

---

## What Stays Inline

- `lib/utils.ts` — no additions needed; all inline route utilities are route-specific
- `hooks/use-elapsed-seconds.ts` — `formatElapsed` and `diffSeconds` are co-located with the hook that produces their input
- Simple inline components throughout: `LinkButton`/`BookItem` (home), `DocumentNavLink` (`$documentId.tsx`), `NarratorVoiceRow`, `PipelineActionButton`, `JobTimer`, `FilterButton` — all under threshold, no state
- `lib/forms.ts`, `lib/books.ts`, `lib/ao3.ts` — no changes needed
