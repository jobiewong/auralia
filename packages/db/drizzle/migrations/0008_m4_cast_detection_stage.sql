CREATE TABLE IF NOT EXISTS `cast_detection_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `model_name` text,
  `stats` text,
  `error_report` text,
  `completed_at` text,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`status` IN ('pending', 'running', 'failed', 'completed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cast_detection_jobs_document_status`
  ON `cast_detection_jobs` (`document_id`, `status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_cast_members` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `canonical_name` text NOT NULL,
  `aliases` text DEFAULT '[]' NOT NULL,
  `descriptor` text DEFAULT '' NOT NULL,
  `confidence` real DEFAULT 1 NOT NULL,
  `needs_review` integer DEFAULT false NOT NULL,
  `source` text DEFAULT 'deterministic' NOT NULL,
  `manually_edited` integer DEFAULT false NOT NULL,
  `manually_deleted` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_document_cast_members_document_name`
  ON `document_cast_members` (`document_id`, `canonical_name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cast_member_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `cast_member_id` text NOT NULL,
  `document_id` text NOT NULL,
  `span_id` text NOT NULL,
  `related_dialogue_span_id` text NOT NULL,
  `evidence_type` text NOT NULL,
  `surface_text` text NOT NULL,
  `evidence_text` text NOT NULL,
  `confidence` real DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`cast_member_id`) REFERENCES `document_cast_members`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`related_dialogue_span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cast_member_evidence_member`
  ON `cast_member_evidence` (`cast_member_id`);
