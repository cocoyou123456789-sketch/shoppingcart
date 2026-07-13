CREATE TABLE `wardrobe_image_cleanup` (
	`image_key` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wardrobe_cleanup_owner_idx` ON `wardrobe_image_cleanup` (`owner_email`);