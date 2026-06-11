CREATE TABLE `run_record` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`device_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`synthesis` text NOT NULL,
	`user_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_record_service_created_idx` ON `run_record` (`service_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `run_record_user_idx` ON `run_record` (`user_id`);