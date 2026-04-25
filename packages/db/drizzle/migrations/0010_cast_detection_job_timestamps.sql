PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_cast_detection_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
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
INSERT INTO `__new_cast_detection_jobs` (
  `id`,
  `document_id`,
  `status`,
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
  `model_name`,
  `stats`,
  `error_report`,
  `completed_at`,
  CASE
    WHEN `created_at` = 'CURRENT_TIMESTAMP' THEN
      CASE
        WHEN `updated_at` = 'CURRENT_TIMESTAMP' THEN CURRENT_TIMESTAMP
        ELSE `updated_at`
      END
    ELSE `created_at`
  END,
  CASE
    WHEN `updated_at` = 'CURRENT_TIMESTAMP' THEN CURRENT_TIMESTAMP
    ELSE `updated_at`
  END
FROM `cast_detection_jobs`;
--> statement-breakpoint
DROP TABLE `cast_detection_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_cast_detection_jobs` RENAME TO `cast_detection_jobs`;
--> statement-breakpoint
CREATE INDEX `idx_cast_detection_jobs_document_status`
  ON `cast_detection_jobs` (`document_id`, `status`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
