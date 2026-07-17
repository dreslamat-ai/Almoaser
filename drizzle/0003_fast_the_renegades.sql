CREATE TABLE `erpnext_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`url` varchar(500) NOT NULL,
	`username` varchar(255) NOT NULL,
	`passwordEnc` text NOT NULL,
	`lastVerifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erpnext_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `erpnext_connections` ADD CONSTRAINT `erpnext_connections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;