CREATE TABLE `skill` (
	`command_template` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`device_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parameters` text NOT NULL,
	`timeout_ms` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_deviceId_idx` ON `skill` (`device_id`);