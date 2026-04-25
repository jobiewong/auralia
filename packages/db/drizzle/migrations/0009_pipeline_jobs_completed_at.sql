PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_ingestion_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `source_ref` text NOT NULL,
  `status` text NOT NULL,
  `document_id` text,
  `error_message` text,
  `completed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ingestion_jobs` (
  `id`,
  `source_type`,
  `source_ref`,
  `status`,
  `document_id`,
  `error_message`,
  `completed_at`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `source_type`,
  `source_ref`,
  `status`,
  `document_id`,
  `error_message`,
  CASE
    WHEN `status` IN ('failed', 'completed') THEN `updated_at`
    ELSE NULL
  END,
  `created_at`,
  `updated_at`
FROM `ingestion_jobs`;
--> statement-breakpoint
DROP TABLE `ingestion_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_ingestion_jobs` RENAME TO `ingestion_jobs`;
--> statement-breakpoint
CREATE INDEX `idx_ingestion_jobs_document_id` ON `ingestion_jobs` (`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_jobs_status` ON `ingestion_jobs` (`status`);
--> statement-breakpoint
CREATE TABLE `__new_segmentation_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `chunk_count` integer DEFAULT 0 NOT NULL,
  `model_name` text,
  `stats` text,
  `error_report` text,
  `completed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`status` IN ('pending', 'running', 'failed', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_segmentation_jobs` (
  `id`,
  `document_id`,
  `status`,
  `chunk_count`,
  `model_name`,
  `stats`,
  `error_report`,
  `completed_at`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `document_id`,
  `status`,
  `chunk_count`,
  `model_name`,
  `stats`,
  `error_report`,
  CASE
    WHEN `status` IN ('failed', 'completed') THEN `updated_at`
    ELSE NULL
  END,
  `created_at`,
  `updated_at`
FROM `segmentation_jobs`;
--> statement-breakpoint
DROP TABLE `segmentation_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_segmentation_jobs` RENAME TO `segmentation_jobs`;
--> statement-breakpoint
CREATE INDEX `idx_segmentation_jobs_document_status` ON `segmentation_jobs` (`document_id`, `status`);
--> statement-breakpoint
CREATE TABLE `__new_synthesis_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `output_path` text,
  `completed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`status` IN ('pending', 'running', 'failed', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_synthesis_jobs` (
  `id`,
  `document_id`,
  `status`,
  `output_path`,
  `completed_at`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `document_id`,
  `status`,
  `output_path`,
  CASE
    WHEN `status` IN ('failed', 'completed') THEN `updated_at`
    ELSE NULL
  END,
  `created_at`,
  `updated_at`
FROM `synthesis_jobs`;
--> statement-breakpoint
DROP TABLE `synthesis_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_synthesis_jobs` RENAME TO `synthesis_jobs`;
--> statement-breakpoint
CREATE INDEX `idx_synthesis_jobs_document_status` ON `synthesis_jobs` (`document_id`, `status`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
