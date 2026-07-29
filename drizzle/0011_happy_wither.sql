CREATE TABLE `admin_action_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`adminName` varchar(255),
	`action` enum('activate_subscription','set_subscription_status','grant_credits','extend_days','set_user_role','set_user_active') NOT NULL,
	`targetUserId` int NOT NULL,
	`targetUserEmail` varchar(320),
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_action_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `llm_usage_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`provider` varchar(40) NOT NULL,
	`model` varchar(120) NOT NULL,
	`promptTokens` int NOT NULL DEFAULT 0,
	`completionTokens` int NOT NULL DEFAULT 0,
	`totalTokens` int NOT NULL DEFAULT 0,
	`costUsd` decimal(12,6) NOT NULL DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `llm_usage_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `payments` MODIFY COLUMN `purpose` enum('subscription','topup','extension') NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `grantedByAdmin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `equivalentValue` decimal(10,2);--> statement-breakpoint
ALTER TABLE `admin_action_log` ADD CONSTRAINT `admin_action_log_adminId_users_id_fk` FOREIGN KEY (`adminId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `llm_usage_log` ADD CONSTRAINT `llm_usage_log_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;