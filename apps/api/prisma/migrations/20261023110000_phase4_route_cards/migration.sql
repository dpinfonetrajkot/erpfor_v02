-- DropForeignKey
ALTER TABLE `rc_completions` DROP FOREIGN KEY `rc_completions_heat_id_fkey`;

-- DropIndex
DROP INDEX `rc_completions_heat_id_idx` ON `rc_completions`;

-- AlterTable
ALTER TABLE `process_stages` ADD COLUMN `is_material_check` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `production_requests` MODIFY `status` ENUM('REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'REQUESTED';

-- AlterTable
ALTER TABLE `rc_completions` DROP COLUMN `heat_id`,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `route_cards` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `input_weight_kg` DECIMAL(14, 3) NULL;

-- CreateTable
CREATE TABLE `rc_completion_heats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `completion_id` INTEGER NOT NULL,
    `heat_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,

    INDEX `rc_completion_heats_heat_id_idx`(`heat_id`),
    UNIQUE INDEX `rc_completion_heats_completion_id_heat_id_key`(`completion_id`, `heat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `material_requisitions_created_by_id_idx` ON `material_requisitions`(`created_by_id`);

-- CreateIndex
CREATE INDEX `rc_completions_status_idx` ON `rc_completions`(`status`);

-- CreateIndex
CREATE INDEX `rc_completions_moved_by_id_idx` ON `rc_completions`(`moved_by_id`);

-- CreateIndex
CREATE INDEX `route_cards_current_stage_id_idx` ON `route_cards`(`current_stage_id`);

-- CreateIndex
CREATE INDEX `route_cards_created_by_id_idx` ON `route_cards`(`created_by_id`);

-- AddForeignKey
ALTER TABLE `route_cards` ADD CONSTRAINT `route_cards_current_stage_id_fkey` FOREIGN KEY (`current_stage_id`) REFERENCES `process_stages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_cards` ADD CONSTRAINT `route_cards_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_requisitions` ADD CONSTRAINT `material_requisitions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rc_completions` ADD CONSTRAINT `rc_completions_moved_by_id_fkey` FOREIGN KEY (`moved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rc_completion_heats` ADD CONSTRAINT `rc_completion_heats_completion_id_fkey` FOREIGN KEY (`completion_id`) REFERENCES `rc_completions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rc_completion_heats` ADD CONSTRAINT `rc_completion_heats_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: stages that check the raw material before cutting are recorded as OK / not OK.
UPDATE `process_stages` SET `is_material_check` = true WHERE `code` IN ('chemical_testing', 'rm_inspection', 'ut');
