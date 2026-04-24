import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
};

export const works = sqliteTable("works", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  authors: text("authors"), // JSON blob: source-specific author list
  sourceMetadata: text("source_metadata"), // JSON blob: work-level source metadata
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_works_slug_unique").on(table.slug),
  index("idx_works_updated_at").on(table.updatedAt),
]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  workId: text("work_id").references(() => works.id, { onDelete: "set null" }),
  sourceId: text("source_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  title: text("title"),
  text: text("text").notNull(),
  textLength: integer("text_length").notNull(),
  normalization: text("normalization").notNull(), // JSON blob
  sourceMetadata: text("source_metadata"), // JSON blob, source-specific (AO3 author/work/nav, etc.)
  roster: text("roster"), // JSON blob: cast list produced by attribution pass (canonical_name, aliases, descriptor)
  ...timestamps,
}, (table) => [
  index("idx_documents_work_id").on(table.workId),
]);

export const ingestionJobs = sqliteTable(
  "ingestion_jobs",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    status: text("status").notNull(),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    index("idx_ingestion_jobs_document_id").on(table.documentId),
    index("idx_ingestion_jobs_status").on(table.status),
  ],
);

export const spans = sqliteTable(
  "spans",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["narration", "dialogue"] }).notNull(),
    text: text("text").notNull(),
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    ...timestamps,
  },
  (table) => [index("idx_spans_document_offsets").on(table.documentId, table.start, table.end)],
);

export const segmentationJobs = sqliteTable(
  "segmentation_jobs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "running", "failed", "completed"] }).notNull().default("pending"),
    chunkCount: integer("chunk_count").notNull().default(0),
    modelName: text("model_name"),
    stats: text("stats"), // JSON: retries per chunk, token counts, timings
    errorReport: text("error_report"), // JSON: machine-readable validator report on failure
    ...timestamps,
  },
  (table) => [index("idx_segmentation_jobs_document_status").on(table.documentId, table.status)],
);

export const attributions = sqliteTable(
  "attributions",
  {
    id: text("id").primaryKey(),
    spanId: text("span_id").notNull().references(() => spans.id, { onDelete: "cascade" }),
    speaker: text("speaker").notNull(),
    speakerConfidence: real("speaker_confidence").notNull().default(0),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => [index("idx_attributions_span_id").on(table.spanId)],
);

export const attributionJobs = sqliteTable(
  "attribution_jobs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "running", "failed", "completed"] }).notNull().default("pending"),
    modelName: text("model_name"),
    stats: text("stats"), // JSON: roster size, timings, deterministic/llm counts
    errorReport: text("error_report"), // JSON: machine-readable validator report on failure
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (table) => [index("idx_attribution_jobs_document_status").on(table.documentId, table.status)],
);

export const castDetectionJobs = sqliteTable(
  "cast_detection_jobs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "running", "failed", "completed"] }).notNull().default("pending"),
    modelName: text("model_name"),
    stats: text("stats"),
    errorReport: text("error_report"),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (table) => [index("idx_cast_detection_jobs_document_status").on(table.documentId, table.status)],
);

export const documentCastMembers = sqliteTable(
  "document_cast_members",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    canonicalName: text("canonical_name").notNull(),
    aliases: text("aliases").notNull().default("[]"),
    descriptor: text("descriptor").notNull().default(""),
    confidence: real("confidence").notNull().default(1),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    source: text("source").notNull().default("deterministic"),
    manuallyEdited: integer("manually_edited", { mode: "boolean" }).notNull().default(false),
    manuallyDeleted: integer("manually_deleted", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_document_cast_members_document_name").on(table.documentId, table.canonicalName),
  ],
);

export const castMemberEvidence = sqliteTable(
  "cast_member_evidence",
  {
    id: text("id").primaryKey(),
    castMemberId: text("cast_member_id").notNull().references(() => documentCastMembers.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    spanId: text("span_id").notNull().references(() => spans.id, { onDelete: "cascade" }),
    relatedDialogueSpanId: text("related_dialogue_span_id").notNull().references(() => spans.id, { onDelete: "cascade" }),
    evidenceType: text("evidence_type").notNull(),
    surfaceText: text("surface_text").notNull(),
    evidenceText: text("evidence_text").notNull(),
    confidence: real("confidence").notNull().default(1),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => [index("idx_cast_member_evidence_member").on(table.castMemberId)],
);

export const voices = sqliteTable("voices", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  mode: text("mode", { enum: ["designed", "clone", "hifi_clone"] }).notNull(),
  controlText: text("control_text"),
  referenceAudioPath: text("reference_audio_path"),
  promptAudioPath: text("prompt_audio_path"),
  promptText: text("prompt_text"),
  cfgValue: real("cfg_value").notNull().default(2.0),
  inferenceTimesteps: integer("inference_timesteps").notNull().default(10),
  isCanonical: integer("is_canonical", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const voiceMappings = sqliteTable(
  "voice_mappings",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    speaker: text("speaker").notNull(),
    voiceId: text("voice_id").notNull().references(() => voices.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [index("idx_voice_mappings_document_speaker").on(table.documentId, table.speaker)],
);

export const synthesisJobs = sqliteTable(
  "synthesis_jobs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "running", "failed", "completed"] }).notNull().default("pending"),
    outputPath: text("output_path"),
    ...timestamps,
  },
  (table) => [index("idx_synthesis_jobs_document_status").on(table.documentId, table.status)],
);

export const synthesisSegments = sqliteTable(
  "synthesis_segments",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => synthesisJobs.id, { onDelete: "cascade" }),
    spanId: text("span_id").notNull().references(() => spans.id, { onDelete: "restrict" }),
    voiceId: text("voice_id").notNull().references(() => voices.id, { onDelete: "restrict" }),
    audioPath: text("audio_path").notNull(),
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    ...timestamps,
  },
  (table) => [index("idx_synthesis_segments_job_start").on(table.jobId, table.start)],
);
