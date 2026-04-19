CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`title` text,
	`text` text NOT NULL,
	`text_length` integer NOT NULL,
	`normalization` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `spans` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`type` text NOT NULL,
	`text` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`type` IN ('narration', 'dialogue'))
);

CREATE TABLE `attributions` (
	`id` text PRIMARY KEY NOT NULL,
	`span_id` text NOT NULL,
	`speaker` text NOT NULL,
	`speaker_confidence` real DEFAULT 0 NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `voices` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`mode` text NOT NULL,
	`control_text` text,
	`reference_audio_path` text,
	`prompt_audio_path` text,
	`prompt_text` text,
	`cfg_value` real DEFAULT 2.0 NOT NULL,
	`inference_timesteps` integer DEFAULT 10 NOT NULL,
	`is_canonical` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CHECK (`mode` IN ('designed', 'clone', 'hifi_clone'))
);

CREATE TABLE `voice_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`speaker` text NOT NULL,
	`voice_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voice_id`) REFERENCES `voices`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE TABLE `synthesis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`output_path` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`status` IN ('pending', 'running', 'failed', 'completed'))
);

CREATE TABLE `synthesis_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`span_id` text NOT NULL,
	`voice_id` text NOT NULL,
	`audio_path` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `synthesis_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voice_id`) REFERENCES `voices`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE INDEX `idx_spans_document_offsets` ON `spans` (`document_id`,`start`,`end`);
CREATE INDEX `idx_attributions_span_id` ON `attributions` (`span_id`);
CREATE INDEX `idx_voice_mappings_document_speaker` ON `voice_mappings` (`document_id`,`speaker`);
CREATE INDEX `idx_synthesis_jobs_document_status` ON `synthesis_jobs` (`document_id`,`status`);
CREATE INDEX `idx_synthesis_segments_job_start` ON `synthesis_segments` (`job_id`,`start`);
