CREATE INDEX IF NOT EXISTS `idx_voices_display_name` ON `voices` (`display_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_voices_mode` ON `voices` (`mode`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_voice_mappings_document_speaker_unique`
  ON `voice_mappings` (`document_id`,`speaker`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_voice_mappings_voice_id` ON `voice_mappings` (`voice_id`);
