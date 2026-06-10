CREATE TABLE `service` (
	`compose_path` text,
	`compose_project` text,
	`container_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`device_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_deviceId_idx` ON `service` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_device_container_unq` ON `service` (`device_id`,`container_name`);