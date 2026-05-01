CREATE TABLE IF NOT EXISTS `attribution_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model_name` text,
	`stats` text,
	`error_report` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`status` IN ('pending', 'running', 'failed', 'completed'))
);
CREATE INDEX IF NOT EXISTS `idx_attribution_jobs_document_status`
	ON `attribution_jobs` (`document_id`,`status`);
