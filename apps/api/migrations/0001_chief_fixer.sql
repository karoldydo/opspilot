CREATE TABLE `credential` (
	`auth_tag` text NOT NULL,
	`auth_type` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`device_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`iv` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`username` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credential_deviceId_idx` ON `credential` (`device_id`);--> statement-breakpoint
CREATE TABLE `device` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`host` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
