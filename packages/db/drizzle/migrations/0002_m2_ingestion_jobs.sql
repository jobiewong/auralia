-- `ingestion_jobs` was previously bootstrapped inline by the Python
-- ingestion bootstrap (apps/api/src/auralia_api/ingestion/storage.py).
-- This migration brings it under Drizzle ownership. IF NOT EXISTS makes
-- the migration idempotent against dev DBs that already had the table.
CREATE TABLE IF NOT EXISTS `ingestion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`status` text NOT NULL,
	`document_id` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX IF NOT EXISTS `idx_ingestion_jobs_document_id` ON `ingestion_jobs` (`document_id`);
CREATE INDEX IF NOT EXISTS `idx_ingestion_jobs_status` ON `ingestion_jobs` (`status`);
