CREATE TABLE `llm_provider` (
	`active` integer DEFAULT false NOT NULL,
	`auth_tag` text NOT NULL,
	`base_url` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`iv` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_provider_active_idx` ON `llm_provider` (`active`);