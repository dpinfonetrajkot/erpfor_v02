-- AlterTable
ALTER TABLE `purchase_orders` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `discount_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `emailed_at` DATETIME(3) NULL;
