ALTER TABLE `synthesis_jobs` ADD `manifest_path` text;--> statement-breakpoint
ALTER TABLE `synthesis_jobs` ADD `stats` text;--> statement-breakpoint
ALTER TABLE `synthesis_jobs` ADD `error_report` text;--> statement-breakpoint
ALTER TABLE `synthesis_segments` ADD `cache_key` text;--> statement-breakpoint
ALTER TABLE `synthesis_segments` ADD `text_hash` text;--> statement-breakpoint
ALTER TABLE `synthesis_segments` ADD `chunk_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `synthesis_segments` ADD `duration_ms` integer;
