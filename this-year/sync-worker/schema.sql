CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`wish_id` text NOT NULL,
	`owner` text NOT NULL,
	`day` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_wish` ON `entries` (`wish_id`);--> statement-breakpoint
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`owner` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photo_entry` ON `photos` (`entry_id`);--> statement-breakpoint
CREATE TABLE `wishes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`target` integer,
	`progress` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`completed_on` text,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wish_owner` ON `wishes` (`owner`);