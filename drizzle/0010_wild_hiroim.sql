ALTER TABLE `erpnext_connections` ADD `provider` enum('erpnext','odoo') DEFAULT 'erpnext' NOT NULL;--> statement-breakpoint
ALTER TABLE `erpnext_connections` ADD `database` varchar(100);