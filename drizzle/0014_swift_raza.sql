CREATE TABLE `phone_otps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`challengeId` varchar(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`sendError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `phone_otps_id` PRIMARY KEY(`id`),
	CONSTRAINT `phone_otps_challengeId_unique` UNIQUE(`challengeId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `phoneVerifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `phone_otps` ADD CONSTRAINT `phone_otps_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;