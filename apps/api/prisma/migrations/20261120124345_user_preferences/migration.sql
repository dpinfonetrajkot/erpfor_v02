-- AlterTable
ALTER TABLE `users` ADD COLUMN `avatar` MEDIUMTEXT NULL,
    ADD COLUMN `preferences` JSON NULL;
