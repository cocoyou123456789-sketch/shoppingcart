CREATE TABLE `personal_data_clear_images` (
	`owner_email` text NOT NULL,
	`request_id` text NOT NULL,
	`image_key` text NOT NULL,
	PRIMARY KEY(`owner_email`, `request_id`, `image_key`)
);
--> statement-breakpoint
CREATE TABLE `personal_data_clear_operations` (
	`owner_email` text NOT NULL,
	`request_id` text NOT NULL,
	`expected_generation` text NOT NULL,
	`next_generation` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`owner_email`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `wardrobe_sync_keys` (
	`owner_email` text NOT NULL,
	`client_id` text NOT NULL,
	`item_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_email`, `client_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wardrobe_sync_item_idx` ON `wardrobe_sync_keys` (`owner_email`,`item_id`);