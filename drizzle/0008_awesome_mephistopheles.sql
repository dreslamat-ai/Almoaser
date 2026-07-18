CREATE TABLE `credit_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`subscriptionId` int,
	`type` enum('message','document','monthly_refill','topup','adjustment') NOT NULL,
	`amount` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`note` varchar(300),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`purpose` enum('subscription','topup') NOT NULL,
	`planId` int,
	`billing` enum('monthly','yearly'),
	`credits` int,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(10) NOT NULL DEFAULT 'SAR',
	`status` enum('pending','paid','failed','expired') NOT NULL DEFAULT 'pending',
	`invoiceId` varchar(100),
	`paymentUrl` varchar(500),
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `plans` ADD `maxDocuments` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `monthlyCredits` int DEFAULT 150 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `yearlyDiscountPct` int DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `hasDirectSupport` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `billing` enum('monthly','yearly') DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `creditsBalance` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `creditsCycleStart` timestamp;--> statement-breakpoint
ALTER TABLE `credit_transactions` ADD CONSTRAINT `credit_transactions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_transactions` ADD CONSTRAINT `credit_transactions_subscriptionId_subscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_planId_plans_id_fk` FOREIGN KEY (`planId`) REFERENCES `plans`(`id`) ON DELETE no action ON UPDATE no action;