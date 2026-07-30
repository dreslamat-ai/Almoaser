CREATE TABLE `login_otps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`challengeId` varchar(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_otps_id` PRIMARY KEY(`id`),
	CONSTRAINT `login_otps_challengeId_unique` UNIQUE(`challengeId`)
);
--> statement-breakpoint
ALTER TABLE `login_otps` ADD CONSTRAINT `login_otps_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;