-- AlterTable
ALTER TABLE `job_work_order_lines` ADD COLUMN `rejected_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    ADD COLUMN `remarks` VARCHAR(500) NULL,
    ADD COLUMN `sales_order_line_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `job_work_orders` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `closed_at` DATETIME(3) NULL,
    MODIFY `status` ENUM('OPEN', 'MATERIAL_ISSUED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE `job_work_receipt_lines` ADD COLUMN `job_work_order_line_id` INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX `job_work_order_lines_sales_order_line_id_idx` ON `job_work_order_lines`(`sales_order_line_id`);

-- CreateIndex
CREATE INDEX `job_work_orders_created_by_id_idx` ON `job_work_orders`(`created_by_id`);

-- CreateIndex
CREATE INDEX `job_work_receipt_lines_job_work_order_line_id_idx` ON `job_work_receipt_lines`(`job_work_order_line_id`);

-- CreateIndex
CREATE INDEX `job_work_receipts_created_by_id_idx` ON `job_work_receipts`(`created_by_id`);

-- AddForeignKey
ALTER TABLE `job_work_orders` ADD CONSTRAINT `job_work_orders_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_order_lines` ADD CONSTRAINT `job_work_order_lines_sales_order_line_id_fkey` FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_receipts` ADD CONSTRAINT `job_work_receipts_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_receipt_lines` ADD CONSTRAINT `job_work_receipt_lines_job_work_order_line_id_fkey` FOREIGN KEY (`job_work_order_line_id`) REFERENCES `job_work_order_lines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

