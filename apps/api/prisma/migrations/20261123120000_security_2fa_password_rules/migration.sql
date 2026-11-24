-- AlterTable
ALTER TABLE `users` ADD COLUMN `failed_logins` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `locked_until` DATETIME(3) NULL,
    ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `password_changed_at` DATETIME(3) NULL,
    ADD COLUMN `two_factor_enabled_at` DATETIME(3) NULL,
    ADD COLUMN `two_factor_recovery` JSON NULL,
    ADD COLUMN `two_factor_secret` VARCHAR(255) NULL;

