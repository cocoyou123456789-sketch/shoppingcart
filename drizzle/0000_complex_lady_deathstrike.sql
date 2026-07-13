CREATE TABLE `body_profiles` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`height` integer NOT NULL,
	`weight` integer NOT NULL,
	`shoulder` integer NOT NULL,
	`chest` integer NOT NULL,
	`waist` integer NOT NULL,
	`hips` integer NOT NULL,
	`torso` integer NOT NULL,
	`legs` integer NOT NULL,
	`skin_tone` text NOT NULL,
	`body_shape` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wardrobe_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`color` text NOT NULL,
	`color_name` text NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '我的衣服' NOT NULL,
	`source_url` text,
	`image_key` text,
	`image_type` text,
	`season` text DEFAULT '四季' NOT NULL,
	`style` text DEFAULT '日常' NOT NULL,
	`chest` real,
	`waist` real,
	`hips` real,
	`length` real,
	`confidence` text DEFAULT '待确认' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wardrobe_owner_id_idx` ON `wardrobe_items` (`owner_email`,`id`);