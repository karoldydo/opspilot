CREATE TABLE `audit_log` (
	`action` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`metadata` text,
	`run_record_id` text,
	`target_id` text,
	`target_type` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`run_record_id`) REFERENCES `run_record`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_user_idx` ON `audit_log` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_run_record` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`device_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`synthesis` text NOT NULL,
	`user_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_run_record`("created_at", "device_id", "id", "service_id", "synthesis", "user_id") SELECT "created_at", "device_id", "id", "service_id", "synthesis", "user_id" FROM `run_record`;--> statement-breakpoint
DROP TABLE `run_record`;--> statement-breakpoint
ALTER TABLE `__new_run_record` RENAME TO `run_record`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `run_record_service_created_idx` ON `run_record` (`service_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `run_record_user_idx` ON `run_record` (`user_id`);