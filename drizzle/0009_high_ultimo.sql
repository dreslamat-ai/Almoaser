CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`ownerId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `organizationId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `orgRole` enum('owner','member') DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `permissions` text;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;