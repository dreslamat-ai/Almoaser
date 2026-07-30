CREATE TABLE `email_verification_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_verification_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `emailNotifications` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;