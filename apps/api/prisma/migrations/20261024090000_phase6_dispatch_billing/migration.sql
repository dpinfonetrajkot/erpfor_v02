-- AlterTable
ALTER TABLE `assemblies` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `gross_weight_kg` DECIMAL(14, 3) NULL,
    ADD COLUMN `packages` INTEGER NULL;

-- AlterTable
ALTER TABLE `dispatches` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `document_counters` MODIFY `period` VARCHAR(40) NOT NULL;

-- AlterTable
ALTER TABLE `invoice_lines` ADD COLUMN `sales_order_line_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `customer_po_date` DATE NULL,
    ADD COLUMN `customer_po_no` VARCHAR(100) NULL,
    ADD COLUMN `discount_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `emailed_at` DATETIME(3) NULL,
    ADD COLUMN `issued_at` DATETIME(3) NULL,
    ADD COLUMN `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 18;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `assemblies_created_by_id_idx` ON `assemblies`(`created_by_id`);

-- CreateIndex
CREATE INDEX `dispatches_created_by_id_idx` ON `dispatches`(`created_by_id`);

-- CreateIndex
CREATE INDEX `invoice_lines_sales_order_line_id_idx` ON `invoice_lines`(`sales_order_line_id`);

-- CreateIndex
CREATE INDEX `invoices_created_by_id_idx` ON `invoices`(`created_by_id`);

-- CreateIndex
CREATE INDEX `payments_created_by_id_idx` ON `payments`(`created_by_id`);

-- AddForeignKey
ALTER TABLE `assemblies` ADD CONSTRAINT `assemblies_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_sales_order_line_id_fkey` FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispatches` ADD CONSTRAINT `dispatches_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: invoices are numbered per company (each GSTIN needs its own series). Only change untouched defaults.
UPDATE `document_series` SET `template` = '{CO}/{FY}/{SEQ:3}' WHERE `code` = 'INVOICE' AND `template` = 'BHT/{FY}/{SEQ:3}';
UPDATE `document_series` SET `template` = '{CO}/EXP/{FY}/{SEQ:3}' WHERE `code` = 'EXPORT_INVOICE' AND `template` = 'EXP/{FY}/{SEQ:3}';
