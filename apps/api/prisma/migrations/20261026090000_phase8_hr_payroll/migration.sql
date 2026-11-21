-- AlterTable
ALTER TABLE `attendance` ADD COLUMN `updated_by_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `employee_loans` ADD COLUMN `created_by_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `leave_requests` ADD COLUMN `created_by_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `loan_repayments` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `created_by_id` INTEGER NULL,
    ADD COLUMN `mode` ENUM('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER') NULL;

-- AlterTable
ALTER TABLE `payroll_runs` ADD COLUMN `finalized_at` DATETIME(3) NULL,
    ADD COLUMN `finalized_by_id` INTEGER NULL,
    ADD COLUMN `paid_at` DATETIME(3) NULL,
    ADD COLUMN `paid_by_id` INTEGER NULL,
    ADD COLUMN `payment_ref` VARCHAR(100) NULL,
    ADD COLUMN `pf_percent` DECIMAL(5, 2) NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE `payslips` ADD COLUMN `absent_days` DECIMAL(5, 1) NOT NULL DEFAULT 0,
    ADD COLUMN `adjustment_note` VARCHAR(255) NULL,
    ADD COLUMN `base_earning` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `expected_hours` DECIMAL(7, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `hour_difference` DECIMAL(7, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `is_pf_eligible` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `paid_leave_days` DECIMAL(5, 1) NOT NULL DEFAULT 0,
    ADD COLUMN `payable_days` DECIMAL(5, 1) NOT NULL DEFAULT 0,
    ADD COLUMN `shift_hours` DECIMAL(5, 2) NOT NULL DEFAULT 8,
    ADD COLUMN `sundays_worked` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `safety_assets` ADD COLUMN `inspection_interval_days` INTEGER NULL;

-- CreateTable
CREATE TABLE `biometric_devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serial_no` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NULL,
    `is_approved` BOOLEAN NOT NULL DEFAULT false,
    `last_seen_at` DATETIME(3) NULL,
    `last_punch_at` DATETIME(3) NULL,
    `last_ip` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `biometric_devices_serial_no_key`(`serial_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_punches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emp_code` VARCHAR(50) NOT NULL,
    `employee_id` INTEGER NULL,
    `date` DATE NOT NULL,
    `time` VARCHAR(8) NOT NULL,
    `source` ENUM('DEVICE', 'MANUAL', 'IMPORT') NOT NULL DEFAULT 'DEVICE',
    `device_serial` VARCHAR(50) NULL,
    `applied` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_punches_date_idx`(`date`),
    INDEX `attendance_punches_employee_id_idx`(`employee_id`),
    UNIQUE INDEX `attendance_punches_emp_code_date_time_key`(`emp_code`, `date`, `time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `attendance_punches` ADD CONSTRAINT `attendance_punches_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

