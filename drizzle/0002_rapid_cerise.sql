CREATE TABLE `owner_data_generations` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`cleared_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
