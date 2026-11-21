-- AlterTable
ALTER TABLE `production_requests` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `request_no` VARCHAR(30) NOT NULL,
    ADD COLUMN `required_by` DATE NULL,
    MODIFY `status` ENUM('REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED';

-- AlterTable
ALTER TABLE `sales_orders` ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `submitted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `production_requests_request_no_key` ON `production_requests`(`request_no`);

-- CreateIndex
CREATE INDEX `sales_orders_sales_person_id_idx` ON `sales_orders`(`sales_person_id`);

-- AddForeignKey
ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_sales_person_id_fkey` FOREIGN KEY (`sales_person_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

