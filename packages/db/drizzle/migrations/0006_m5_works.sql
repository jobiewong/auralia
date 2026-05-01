CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`authors` text,
	`source_metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_works_slug_unique` ON `works` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_works_updated_at` ON `works` (`updated_at`);--> statement-breakpoint
ALTER TABLE `documents` ADD `work_id` text REFERENCES works(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_documents_work_id` ON `documents` (`work_id`);--> statement-breakpoint
WITH grouped_documents AS (
	SELECT
		CASE
			WHEN json_valid(`source_metadata`) AND json_extract(`source_metadata`, '$.source') = 'ao3'
				THEN 'ao3:' || `source_id`
			WHEN `source_id` LIKE 'ao3:work:%'
				THEN 'ao3:' || `source_id`
			ELSE 'document:' || `id`
		END AS `group_key`,
		CASE
			WHEN json_valid(`source_metadata`) AND json_extract(`source_metadata`, '$.source') = 'ao3'
				THEN 'ao3'
			WHEN `source_id` LIKE 'ao3:work:%'
				THEN 'ao3'
			ELSE 'text'
		END AS `source_type`,
		CASE
			WHEN json_valid(`source_metadata`) AND json_extract(`source_metadata`, '$.source') = 'ao3'
				THEN `source_id`
			WHEN `source_id` LIKE 'ao3:work:%'
				THEN `source_id`
			ELSE `id`
		END AS `work_source_id`,
		COALESCE(
			CASE
				WHEN json_valid(`source_metadata`) THEN json_extract(`source_metadata`, '$.work_title')
				ELSE NULL
			END,
			`title`,
			`source_id`,
			`id`
		) AS `work_title`,
		CASE
			WHEN json_valid(`source_metadata`) THEN json_extract(`source_metadata`, '$.authors')
			ELSE NULL
		END AS `authors`,
		CASE
			WHEN json_valid(`source_metadata`) THEN `source_metadata`
			ELSE NULL
		END AS `source_metadata`,
		MIN(`created_at`) AS `created_at`,
		MAX(`updated_at`) AS `updated_at`
	FROM `documents`
	GROUP BY `group_key`
),
slugged_documents AS (
	SELECT
		*,
		COALESCE(
			NULLIF(
				TRIM(
					REPLACE(
						REPLACE(
							REPLACE(
								REPLACE(
									REPLACE(
										REPLACE(
											REPLACE(
												REPLACE(
													REPLACE(
														REPLACE(
															REPLACE(
																REPLACE(
																	LOWER(`work_title`),
																	'&',
																	' and '
																),
																'''',
																''
															),
															'.',
															''
														),
														'/',
														'-'
													),
													'?',
													''
												),
												'!',
												''
											),
											'"',
											''
										),
										'(',
										''
									),
									')',
									''
								),
								',',
								''
							),
							':',
							''
						),
						' ',
						'-'
					),
					'-'
				),
				''
			),
			'work'
		) AS `slug_base`
	FROM `grouped_documents`
),
numbered_documents AS (
	SELECT
		*,
		ROW_NUMBER() OVER (PARTITION BY `slug_base` ORDER BY `group_key`) AS `slug_index`
	FROM `slugged_documents`
)
INSERT INTO `works` (
	`id`,
	`slug`,
	`title`,
	`source_type`,
	`source_id`,
	`authors`,
	`source_metadata`,
	`created_at`,
	`updated_at`
)
SELECT
	'work_' || LOWER(HEX(RANDOMBLOB(6))),
	`slug_base` || CASE WHEN `slug_index` = 1 THEN '' ELSE '-' || `slug_index` END,
	`work_title`,
	`source_type`,
	`work_source_id`,
	`authors`,
	`source_metadata`,
	`created_at`,
	`updated_at`
FROM `numbered_documents`;--> statement-breakpoint
UPDATE `documents`
SET `work_id` = (
	SELECT `works`.`id`
	FROM `works`
	WHERE (
		(
			(
				json_valid(`documents`.`source_metadata`)
				AND json_extract(`documents`.`source_metadata`, '$.source') = 'ao3'
			)
			OR `documents`.`source_id` LIKE 'ao3:work:%'
		)
		AND `works`.`source_type` = 'ao3'
		AND `works`.`source_id` = `documents`.`source_id`
	)
	OR (
		NOT (
			(
				json_valid(`documents`.`source_metadata`)
				AND json_extract(`documents`.`source_metadata`, '$.source') = 'ao3'
			)
			OR `documents`.`source_id` LIKE 'ao3:work:%'
		)
		AND `works`.`source_type` = 'text'
		AND `works`.`source_id` = `documents`.`id`
	)
	LIMIT 1
);
