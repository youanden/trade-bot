CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_instance_id` integer,
	`action` text NOT NULL,
	`details` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bot_instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_type` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`config` text,
	`durable_object_id` text,
	`heartbeat` text,
	`error_message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_instance_id` integer NOT NULL,
	`total_pnl` real DEFAULT 0,
	`win_rate` real,
	`sharpe` real,
	`max_drawdown` real,
	`total_trades` integer DEFAULT 0,
	`snapshot_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `market_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market_id_a` integer NOT NULL,
	`market_id_b` integer NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`match_method` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`market_id_a`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id_b`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `markets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`platform_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`status` text DEFAULT 'active' NOT NULL,
	`resolution` text,
	`end_date` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_instance_id` integer,
	`market_id` integer NOT NULL,
	`platform` text NOT NULL,
	`platform_order_id` text,
	`side` text NOT NULL,
	`outcome` text NOT NULL,
	`price` real NOT NULL,
	`size` real NOT NULL,
	`filled_size` real DEFAULT 0,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_instance_id` integer,
	`market_id` integer NOT NULL,
	`platform` text NOT NULL,
	`outcome` text NOT NULL,
	`size` real NOT NULL,
	`avg_entry` real NOT NULL,
	`current_price` real,
	`unrealized_pnl` real,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text DEFAULT (datetime('now')) NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market_id` integer NOT NULL,
	`yes_price` real,
	`no_price` real,
	`yes_bid` real,
	`yes_ask` real,
	`volume` real,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracked_traders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`trader_id` text NOT NULL,
	`alias` text,
	`win_rate` real,
	`total_pnl` real,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`bot_instance_id` integer,
	`market_id` integer NOT NULL,
	`filled_price` real NOT NULL,
	`filled_size` real NOT NULL,
	`fee` real DEFAULT 0,
	`pnl` real,
	`trade_reason` text,
	`executed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
