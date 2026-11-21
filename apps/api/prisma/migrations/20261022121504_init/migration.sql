-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(20) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role_id` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_role_id_idx`(`role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` INTEGER NOT NULL,
    `permission` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`role_id`, `permission`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip` VARCHAR(45) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sessions_token_hash_key`(`token_hash`),
    INDEX `sessions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'STATUS_CHANGE', 'PASSWORD_CHANGE') NOT NULL,
    `entity` VARCHAR(50) NOT NULL,
    `entity_id` VARCHAR(50) NULL,
    `summary` VARCHAR(255) NULL,
    `changes` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_entity_id_idx`(`entity`, `entity_id`),
    INDEX `audit_logs_user_id_idx`(`user_id`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `body` VARCHAR(500) NULL,
    `link` VARCHAR(255) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_idx`(`user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `legal_name` VARCHAR(200) NULL,
    `address` VARCHAR(500) NULL,
    `city` VARCHAR(100) NULL,
    `state_code` CHAR(2) NULL,
    `pincode` VARCHAR(10) NULL,
    `country` VARCHAR(60) NOT NULL DEFAULT 'India',
    `phone` VARCHAR(50) NULL,
    `email` VARCHAR(150) NULL,
    `website` VARCHAR(200) NULL,
    `gstin` VARCHAR(15) NULL,
    `pan` VARCHAR(10) NULL,
    `iec_code` VARCHAR(20) NULL,
    `bank_name` VARCHAR(100) NULL,
    `bank_account_no` VARCHAR(30) NULL,
    `bank_ifsc` VARCHAR(15) NULL,
    `bank_branch` VARCHAR(100) NULL,
    `swift_code` VARCHAR(15) NULL,
    `invoice_terms` TEXT NULL,
    `purchase_terms` TEXT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companies_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` VARCHAR(1000) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_series` (
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `template` VARCHAR(60) NOT NULL,
    `reset_period` ENUM('NEVER', 'FINANCIAL_YEAR', 'MONTHLY') NOT NULL DEFAULT 'FINANCIAL_YEAR',
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_counters` (
    `series_code` VARCHAR(40) NOT NULL,
    `period` VARCHAR(10) NOT NULL,
    `last_number` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`series_code`, `period`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entity` VARCHAR(50) NOT NULL,
    `entity_id` INTEGER NOT NULL,
    `category` VARCHAR(50) NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `stored_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `uploaded_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attachments_stored_name_key`(`stored_name`),
    INDEX `attachments_entity_entity_id_idx`(`entity`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `contact_person` VARCHAR(100) NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(150) NULL,
    `gstin` VARCHAR(15) NULL,
    `pan` VARCHAR(10) NULL,
    `address` VARCHAR(500) NULL,
    `shipping_address` VARCHAR(500) NULL,
    `city` VARCHAR(100) NULL,
    `state_code` CHAR(2) NULL,
    `pincode` VARCHAR(10) NULL,
    `country` VARCHAR(60) NOT NULL DEFAULT 'India',
    `currency` ENUM('INR', 'USD', 'EUR', 'GBP', 'AED') NOT NULL DEFAULT 'INR',
    `payment_terms_days` INTEGER NULL,
    `notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_code_key`(`code`),
    INDEX `customers_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` ENUM('MATERIAL', 'JOB_WORK', 'SERVICE', 'OTHER') NOT NULL DEFAULT 'MATERIAL',
    `contact_person` VARCHAR(100) NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(150) NULL,
    `gstin` VARCHAR(15) NULL,
    `pan` VARCHAR(10) NULL,
    `address` VARCHAR(500) NULL,
    `city` VARCHAR(100) NULL,
    `state_code` CHAR(2) NULL,
    `pincode` VARCHAR(10) NULL,
    `country` VARCHAR(60) NOT NULL DEFAULT 'India',
    `payment_terms_days` INTEGER NULL,
    `bank_name` VARCHAR(100) NULL,
    `bank_account_no` VARCHAR(30) NULL,
    `bank_ifsc` VARCHAR(15) NULL,
    `notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `suppliers_code_key`(`code`),
    INDEX `suppliers_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_categories_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `part_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `has_end_connection` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `part_types_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `category_id` INTEGER NOT NULL,
    `size` VARCHAR(30) NULL,
    `figure` VARCHAR(50) NULL,
    `pressure_rating` VARCHAR(50) NULL,
    `hsn_code` VARCHAR(10) NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_code_key`(`code`),
    UNIQUE INDEX `products_name_key`(`name`),
    INDEX `products_category_id_idx`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_components` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `part_type_id` INTEGER NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1,

    INDEX `product_components_part_type_id_idx`(`part_type_id`),
    UNIQUE INDEX `product_components_product_id_part_type_id_key`(`product_id`, `part_type_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `product_id` INTEGER NOT NULL,
    `part_type_id` INTEGER NOT NULL,
    `end_connection` ENUM('BW', 'THD', 'NONE') NOT NULL DEFAULT 'NONE',
    `material_grade_id` INTEGER NULL,
    `raw_material_id` INTEGER NULL,
    `drawing_no` VARCHAR(50) NULL,
    `finished_weight_kg` DECIMAL(14, 3) NULL,
    `input_weight_kg` DECIMAL(14, 3) NULL,
    `uom` ENUM('PCS', 'SET', 'KG', 'MTR', 'NOS') NOT NULL DEFAULT 'PCS',
    `min_price` DECIMAL(14, 2) NULL,
    `hsn_code` VARCHAR(10) NULL,
    `description` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `items_code_key`(`code`),
    INDEX `items_part_type_id_idx`(`part_type_id`),
    INDEX `items_material_grade_id_idx`(`material_grade_id`),
    INDEX `items_raw_material_id_idx`(`raw_material_id`),
    UNIQUE INDEX `items_product_id_part_type_id_end_connection_key`(`product_id`, `part_type_id`, `end_connection`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `material_grades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `heat_code` VARCHAR(5) NULL,
    `standard` VARCHAR(100) NULL,
    `description` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `material_grades_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `raw_materials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `grade_id` INTEGER NOT NULL,
    `shape` ENUM('ROUND', 'SQUARE', 'HEX', 'FLAT', 'PLATE', 'PIPE', 'OTHER') NOT NULL DEFAULT 'ROUND',
    `size` VARCHAR(100) NOT NULL,
    `size_mm` DECIMAL(10, 2) NULL,
    `density_kg_m3` DECIMAL(10, 2) NULL,
    `uom` ENUM('PCS', 'SET', 'KG', 'MTR', 'NOS') NOT NULL DEFAULT 'KG',
    `reorder_level` DECIMAL(14, 3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `raw_materials_code_key`(`code`),
    UNIQUE INDEX `raw_materials_grade_id_size_key`(`grade_id`, `size`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `heats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `heat_no` VARCHAR(50) NOT NULL,
    `mill_heat_no` VARCHAR(100) NULL,
    `raw_material_id` INTEGER NOT NULL,
    `supplier_id` INTEGER NULL,
    `received_date` DATE NULL,
    `status` ENUM('ACTIVE', 'BLOCKED', 'CONSUMED') NOT NULL DEFAULT 'ACTIVE',
    `remarks` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `heats_heat_no_key`(`heat_no`),
    INDEX `heats_raw_material_id_idx`(`raw_material_id`),
    INDEX `heats_supplier_id_idx`(`supplier_id`),
    INDEX `heats_mill_heat_no_idx`(`mill_heat_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_stages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `type` ENUM('TEST', 'INSPECTION', 'OPERATION') NOT NULL DEFAULT 'OPERATION',
    `capture_weights` BOOLEAN NOT NULL DEFAULT false,
    `requires_report` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `process_stages_code_key`(`code`),
    INDEX `process_stages_sequence_idx`(`sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_stage_roles` (
    `stage_id` INTEGER NOT NULL,
    `role_id` INTEGER NOT NULL,

    INDEX `process_stage_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`stage_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tools` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` ENUM('DIE', 'TOOL', 'FIXTURE', 'GAUGE') NOT NULL DEFAULT 'DIE',
    `item_id` INTEGER NULL,
    `location` VARCHAR(100) NULL,
    `purchase_date` DATE NULL,
    `life_shots` INTEGER NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'SCRAPPED') NOT NULL DEFAULT 'ACTIVE',
    `description` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tools_code_key`(`code`),
    INDEX `tools_item_id_idx`(`item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `kind` ENUM('RAW_MATERIAL', 'FINISHED_GOOD') NOT NULL,
    `raw_material_id` INTEGER NULL,
    `item_id` INTEGER NULL,
    `heat_id` INTEGER NULL,
    `location` ENUM('RM_STORE', 'FG_STORE', 'WIP', 'JOB_WORK', 'REJECTION') NOT NULL,
    `qty_in` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `qty_out` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `ref_type` ENUM('OPENING', 'GRN', 'MATERIAL_ISSUE', 'ISSUE_RETURN', 'RC_COMPLETION', 'JOB_WORK_ISSUE', 'JOB_WORK_RECEIPT', 'ASSEMBLY', 'DISPATCH', 'ADJUSTMENT') NOT NULL,
    `ref_id` INTEGER NULL,
    `ref_no` VARCHAR(50) NULL,
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_ledger_kind_raw_material_id_idx`(`kind`, `raw_material_id`),
    INDEX `stock_ledger_kind_item_id_idx`(`kind`, `item_id`),
    INDEX `stock_ledger_heat_id_idx`(`heat_id`),
    INDEX `stock_ledger_ref_type_ref_id_idx`(`ref_type`, `ref_id`),
    INDEX `stock_ledger_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_balances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `balance_key` VARCHAR(80) NOT NULL,
    `kind` ENUM('RAW_MATERIAL', 'FINISHED_GOOD') NOT NULL,
    `raw_material_id` INTEGER NULL,
    `item_id` INTEGER NULL,
    `heat_id` INTEGER NULL,
    `location` ENUM('RM_STORE', 'FG_STORE', 'WIP', 'JOB_WORK', 'REJECTION') NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `reserved_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stock_balances_balance_key_key`(`balance_key`),
    INDEX `stock_balances_raw_material_id_idx`(`raw_material_id`),
    INDEX `stock_balances_item_id_idx`(`item_id`),
    INDEX `stock_balances_heat_id_idx`(`heat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `so_no` VARCHAR(30) NOT NULL,
    `so_date` DATE NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `customer_po_no` VARCHAR(100) NULL,
    `customer_po_date` DATE NULL,
    `currency` ENUM('INR', 'USD', 'EUR', 'GBP', 'AED') NOT NULL DEFAULT 'INR',
    `exchange_rate` DECIMAL(12, 4) NOT NULL DEFAULT 1,
    `expected_delivery` DATE NULL,
    `sales_person_id` INTEGER NULL,
    `additional_requirement` TEXT NULL,
    `notes` TEXT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `feasibility_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `design_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `production_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `total_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_orders_so_no_key`(`so_no`),
    INDEX `sales_orders_status_idx`(`status`),
    INDEX `sales_orders_so_date_idx`(`so_date`),
    UNIQUE INDEX `sales_orders_customer_id_customer_po_no_key`(`customer_id`, `customer_po_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_order_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sales_order_id` INTEGER NOT NULL,
    `line_no` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `end_connection` ENUM('BW', 'THD', 'NONE') NOT NULL DEFAULT 'NONE',
    `service` ENUM('STD', 'SOUR') NOT NULL DEFAULT 'STD',
    `schedule` VARCHAR(30) NULL,
    `material_grade_id` INTEGER NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `rate` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `decision` ENUM('PENDING', 'INHOUSE', 'OUTSOURCE', 'FROM_STOCK') NOT NULL DEFAULT 'PENDING',
    `dispatched_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `remarks` VARCHAR(500) NULL,

    INDEX `sales_order_lines_product_id_idx`(`product_id`),
    INDEX `sales_order_lines_material_grade_id_idx`(`material_grade_id`),
    UNIQUE INDEX `sales_order_lines_sales_order_id_line_no_key`(`sales_order_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_order_approvals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sales_order_id` INTEGER NOT NULL,
    `stage` ENUM('FEASIBILITY', 'DESIGN', 'PRODUCTION') NOT NULL,
    `decision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL,
    `remarks` VARCHAR(500) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_order_approvals_sales_order_id_idx`(`sales_order_id`),
    INDEX `sales_order_approvals_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `production_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('MAKE_TO_ORDER', 'MAKE_TO_STOCK') NOT NULL DEFAULT 'MAKE_TO_ORDER',
    `sales_order_line_id` INTEGER NULL,
    `item_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `status` ENUM('REQUESTED', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `production_requests_sales_order_line_id_idx`(`sales_order_line_id`),
    INDEX `production_requests_item_id_idx`(`item_id`),
    INDEX `production_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `route_cards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rc_no` VARCHAR(30) NOT NULL,
    `rc_date` DATE NOT NULL,
    `production_request_id` INTEGER NULL,
    `sales_order_line_id` INTEGER NULL,
    `item_id` INTEGER NOT NULL,
    `raw_material_id` INTEGER NULL,
    `planned_qty` DECIMAL(14, 3) NOT NULL,
    `extra_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `completed_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rejected_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `expected_delivery` DATE NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `current_stage_id` INTEGER NULL,
    `remarks` TEXT NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `route_cards_rc_no_key`(`rc_no`),
    INDEX `route_cards_production_request_id_idx`(`production_request_id`),
    INDEX `route_cards_sales_order_line_id_idx`(`sales_order_line_id`),
    INDEX `route_cards_item_id_idx`(`item_id`),
    INDEX `route_cards_raw_material_id_idx`(`raw_material_id`),
    INDEX `route_cards_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `route_card_operations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `route_card_id` INTEGER NOT NULL,
    `stage_id` INTEGER NOT NULL,
    `sequence` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `received_qty` DECIMAL(14, 3) NULL,
    `ok_qty` DECIMAL(14, 3) NULL,
    `rejected_qty` DECIMAL(14, 3) NULL,
    `rework_qty` DECIMAL(14, 3) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `input_weight_kg` DECIMAL(14, 3) NULL,
    `output_weight_kg` DECIMAL(14, 3) NULL,
    `scrap_weight_kg` DECIMAL(14, 3) NULL,
    `operator_name` VARCHAR(100) NULL,
    `machine` VARCHAR(100) NULL,
    `readings` JSON NULL,
    `remarks` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `updated_by_id` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `route_card_operations_stage_id_status_idx`(`stage_id`, `status`),
    INDEX `route_card_operations_updated_by_id_idx`(`updated_by_id`),
    UNIQUE INDEX `route_card_operations_route_card_id_stage_id_key`(`route_card_id`, `stage_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `material_requisitions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mr_no` VARCHAR(30) NOT NULL,
    `mr_date` DATE NOT NULL,
    `route_card_id` INTEGER NOT NULL,
    `raw_material_id` INTEGER NOT NULL,
    `requested_qty` DECIMAL(14, 3) NOT NULL,
    `issued_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PARTIAL', 'ISSUED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `material_requisitions_mr_no_key`(`mr_no`),
    INDEX `material_requisitions_route_card_id_idx`(`route_card_id`),
    INDEX `material_requisitions_raw_material_id_idx`(`raw_material_id`),
    INDEX `material_requisitions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `material_issues` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `issue_date` DATE NOT NULL,
    `material_requisition_id` INTEGER NULL,
    `route_card_id` INTEGER NULL,
    `job_work_material_id` INTEGER NULL,
    `raw_material_id` INTEGER NOT NULL,
    `heat_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `remarks` VARCHAR(500) NULL,
    `issued_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `material_issues_material_requisition_id_idx`(`material_requisition_id`),
    INDEX `material_issues_route_card_id_idx`(`route_card_id`),
    INDEX `material_issues_job_work_material_id_idx`(`job_work_material_id`),
    INDEX `material_issues_raw_material_id_idx`(`raw_material_id`),
    INDEX `material_issues_heat_id_idx`(`heat_id`),
    INDEX `material_issues_issued_by_id_idx`(`issued_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rc_completions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slip_no` VARCHAR(30) NOT NULL,
    `route_card_id` INTEGER NOT NULL,
    `heat_id` INTEGER NULL,
    `ok_qty` DECIMAL(14, 3) NOT NULL,
    `status` ENUM('PENDING', 'MOVED_TO_STOCK') NOT NULL DEFAULT 'PENDING',
    `moved_at` DATETIME(3) NULL,
    `moved_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rc_completions_slip_no_key`(`slip_no`),
    INDEX `rc_completions_route_card_id_idx`(`route_card_id`),
    INDEX `rc_completions_heat_id_idx`(`heat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_requisitions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pr_no` VARCHAR(30) NOT NULL,
    `pr_date` DATE NOT NULL,
    `raw_material_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `required_by` DATE NULL,
    `source` ENUM('MANUAL', 'MATERIAL_REQUISITION', 'JOB_WORK', 'REORDER') NOT NULL DEFAULT 'MANUAL',
    `material_requisition_id` INTEGER NULL,
    `job_work_order_id` INTEGER NULL,
    `status` ENUM('PENDING', 'ORDERED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_requisitions_pr_no_key`(`pr_no`),
    INDEX `purchase_requisitions_raw_material_id_idx`(`raw_material_id`),
    INDEX `purchase_requisitions_material_requisition_id_idx`(`material_requisition_id`),
    INDEX `purchase_requisitions_job_work_order_id_idx`(`job_work_order_id`),
    INDEX `purchase_requisitions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `po_no` VARCHAR(30) NOT NULL,
    `po_date` DATE NOT NULL,
    `company_id` INTEGER NOT NULL,
    `type` ENUM('MATERIAL', 'JOB_WORK') NOT NULL DEFAULT 'MATERIAL',
    `supplier_id` INTEGER NOT NULL,
    `job_work_order_id` INTEGER NULL,
    `quotation_ref` VARCHAR(100) NULL,
    `delivery_address` VARCHAR(500) NULL,
    `payment_terms` VARCHAR(255) NULL,
    `expected_delivery` DATE NULL,
    `currency` ENUM('INR', 'USD', 'EUR', 'GBP', 'AED') NOT NULL DEFAULT 'INR',
    `gst_type` ENUM('INTRA_STATE', 'INTER_STATE', 'EXPORT', 'EXEMPT') NOT NULL DEFAULT 'INTRA_STATE',
    `sub_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `discount_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `taxable_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `tax_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `freight` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `round_off` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `paid_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `payment_status` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    `status` ENUM('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `terms` TEXT NULL,
    `notes` TEXT NULL,
    `approved_by_id` INTEGER NULL,
    `approved_at` DATETIME(3) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_orders_po_no_key`(`po_no`),
    INDEX `purchase_orders_company_id_idx`(`company_id`),
    INDEX `purchase_orders_supplier_id_idx`(`supplier_id`),
    INDEX `purchase_orders_job_work_order_id_idx`(`job_work_order_id`),
    INDEX `purchase_orders_status_idx`(`status`),
    INDEX `purchase_orders_po_date_idx`(`po_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_order_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchase_order_id` INTEGER NOT NULL,
    `line_no` INTEGER NOT NULL,
    `raw_material_id` INTEGER NULL,
    `item_id` INTEGER NULL,
    `purchase_requisition_id` INTEGER NULL,
    `description` VARCHAR(500) NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `uom` ENUM('PCS', 'SET', 'KG', 'MTR', 'NOS') NOT NULL DEFAULT 'KG',
    `rate` DECIMAL(14, 2) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `received_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,

    INDEX `purchase_order_lines_raw_material_id_idx`(`raw_material_id`),
    INDEX `purchase_order_lines_item_id_idx`(`item_id`),
    INDEX `purchase_order_lines_purchase_requisition_id_idx`(`purchase_requisition_id`),
    UNIQUE INDEX `purchase_order_lines_purchase_order_id_line_no_key`(`purchase_order_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grn_no` VARCHAR(30) NOT NULL,
    `grn_date` DATE NOT NULL,
    `supplier_id` INTEGER NOT NULL,
    `purchase_order_id` INTEGER NULL,
    `supplier_challan` VARCHAR(50) NULL,
    `supplier_invoice` VARCHAR(50) NULL,
    `vehicle_no` VARCHAR(20) NULL,
    `status` ENUM('PENDING_QC', 'COMPLETED') NOT NULL DEFAULT 'PENDING_QC',
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `goods_receipts_grn_no_key`(`grn_no`),
    INDEX `goods_receipts_supplier_id_idx`(`supplier_id`),
    INDEX `goods_receipts_purchase_order_id_idx`(`purchase_order_id`),
    INDEX `goods_receipts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receipt_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `goods_receipt_id` INTEGER NOT NULL,
    `purchase_order_line_id` INTEGER NULL,
    `raw_material_id` INTEGER NOT NULL,
    `mill_heat_no` VARCHAR(100) NULL,
    `heat_id` INTEGER NULL,
    `received_qty` DECIMAL(14, 3) NOT NULL,
    `accepted_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rejected_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `qc_status` ENUM('PENDING', 'ACCEPTED', 'PARTIAL', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `qc_remarks` VARCHAR(500) NULL,
    `inspected_by_id` INTEGER NULL,
    `inspected_at` DATETIME(3) NULL,

    INDEX `goods_receipt_lines_goods_receipt_id_idx`(`goods_receipt_id`),
    INDEX `goods_receipt_lines_purchase_order_line_id_idx`(`purchase_order_line_id`),
    INDEX `goods_receipt_lines_raw_material_id_idx`(`raw_material_id`),
    INDEX `goods_receipt_lines_heat_id_idx`(`heat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_work_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jwo_no` VARCHAR(30) NOT NULL,
    `jwo_date` DATE NOT NULL,
    `supplier_id` INTEGER NOT NULL,
    `sales_order_id` INTEGER NULL,
    `challan_no` VARCHAR(50) NULL,
    `expected_date` DATE NULL,
    `status` ENUM('OPEN', 'MATERIAL_ISSUED', 'PO_RAISED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `remarks` TEXT NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `job_work_orders_jwo_no_key`(`jwo_no`),
    INDEX `job_work_orders_supplier_id_idx`(`supplier_id`),
    INDEX `job_work_orders_sales_order_id_idx`(`sales_order_id`),
    INDEX `job_work_orders_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_work_order_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_work_order_id` INTEGER NOT NULL,
    `item_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `received_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rate` DECIMAL(14, 2) NOT NULL DEFAULT 0,

    INDEX `job_work_order_lines_job_work_order_id_idx`(`job_work_order_id`),
    INDEX `job_work_order_lines_item_id_idx`(`item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_work_materials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_work_order_id` INTEGER NOT NULL,
    `raw_material_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `issued_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PARTIAL', 'ISSUED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',

    INDEX `job_work_materials_job_work_order_id_idx`(`job_work_order_id`),
    INDEX `job_work_materials_raw_material_id_idx`(`raw_material_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_work_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receipt_no` VARCHAR(30) NOT NULL,
    `receipt_date` DATE NOT NULL,
    `job_work_order_id` INTEGER NOT NULL,
    `vendor_challan` VARCHAR(50) NULL,
    `inspector_name` VARCHAR(100) NULL,
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `job_work_receipts_receipt_no_key`(`receipt_no`),
    INDEX `job_work_receipts_job_work_order_id_idx`(`job_work_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_work_receipt_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_work_receipt_id` INTEGER NOT NULL,
    `item_id` INTEGER NOT NULL,
    `heat_id` INTEGER NULL,
    `received_qty` DECIMAL(14, 3) NOT NULL,
    `accepted_qty` DECIMAL(14, 3) NOT NULL,
    `rejected_qty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `remarks` VARCHAR(500) NULL,

    INDEX `job_work_receipt_lines_job_work_receipt_id_idx`(`job_work_receipt_id`),
    INDEX `job_work_receipt_lines_item_id_idx`(`item_id`),
    INDEX `job_work_receipt_lines_heat_id_idx`(`heat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assemblies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assembly_no` VARCHAR(30) NOT NULL,
    `assembly_date` DATE NOT NULL,
    `sales_order_id` INTEGER NOT NULL,
    `packing_type` VARCHAR(50) NULL,
    `packed_by` VARCHAR(100) NULL,
    `status` ENUM('PACKED', 'INVOICED', 'DISPATCHED', 'CANCELLED') NOT NULL DEFAULT 'PACKED',
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assemblies_assembly_no_key`(`assembly_no`),
    INDEX `assemblies_sales_order_id_idx`(`sales_order_id`),
    INDEX `assemblies_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assembly_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assembly_id` INTEGER NOT NULL,
    `sales_order_line_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,

    INDEX `assembly_lines_assembly_id_idx`(`assembly_id`),
    INDEX `assembly_lines_sales_order_line_id_idx`(`sales_order_line_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assembly_consumptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assembly_id` INTEGER NOT NULL,
    `item_id` INTEGER NOT NULL,
    `heat_id` INTEGER NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,

    INDEX `assembly_consumptions_assembly_id_idx`(`assembly_id`),
    INDEX `assembly_consumptions_item_id_idx`(`item_id`),
    INDEX `assembly_consumptions_heat_id_idx`(`heat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoice_no` VARCHAR(30) NOT NULL,
    `type` ENUM('TAX_INVOICE', 'EXPORT_INVOICE', 'PROFORMA') NOT NULL DEFAULT 'TAX_INVOICE',
    `invoice_date` DATE NOT NULL,
    `due_date` DATE NULL,
    `company_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `sales_order_id` INTEGER NULL,
    `assembly_id` INTEGER NULL,
    `currency` ENUM('INR', 'USD', 'EUR', 'GBP', 'AED') NOT NULL DEFAULT 'INR',
    `exchange_rate` DECIMAL(12, 4) NOT NULL DEFAULT 1,
    `billing_name` VARCHAR(200) NOT NULL,
    `billing_address` VARCHAR(500) NULL,
    `billing_gstin` VARCHAR(15) NULL,
    `shipping_name` VARCHAR(200) NULL,
    `shipping_address` VARCHAR(500) NULL,
    `shipping_gstin` VARCHAR(15) NULL,
    `place_of_supply` CHAR(2) NULL,
    `gst_type` ENUM('INTRA_STATE', 'INTER_STATE', 'EXPORT', 'EXEMPT') NOT NULL DEFAULT 'INTRA_STATE',
    `transporter` VARCHAR(100) NULL,
    `vehicle_no` VARCHAR(20) NULL,
    `sub_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `discount_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `taxable_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `cgst_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `sgst_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `igst_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `freight` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `round_off` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `amount_paid` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `payment_status` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    `status` ENUM('DRAFT', 'ISSUED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `terms` TEXT NULL,
    `notes` TEXT NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_invoice_no_key`(`invoice_no`),
    INDEX `invoices_company_id_idx`(`company_id`),
    INDEX `invoices_customer_id_idx`(`customer_id`),
    INDEX `invoices_sales_order_id_idx`(`sales_order_id`),
    INDEX `invoices_assembly_id_idx`(`assembly_id`),
    INDEX `invoices_invoice_date_idx`(`invoice_date`),
    INDEX `invoices_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoice_id` INTEGER NOT NULL,
    `line_no` INTEGER NOT NULL,
    `item_id` INTEGER NULL,
    `description` VARCHAR(500) NOT NULL,
    `hsn_code` VARCHAR(10) NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `uom` ENUM('PCS', 'SET', 'KG', 'MTR', 'NOS') NOT NULL DEFAULT 'SET',
    `rate` DECIMAL(14, 2) NOT NULL,
    `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `amount` DECIMAL(14, 2) NOT NULL,

    INDEX `invoice_lines_item_id_idx`(`item_id`),
    UNIQUE INDEX `invoice_lines_invoice_id_line_no_key`(`invoice_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dispatches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dispatch_no` VARCHAR(30) NOT NULL,
    `dispatch_date` DATE NOT NULL,
    `sales_order_id` INTEGER NOT NULL,
    `invoice_id` INTEGER NULL,
    `challan_no` VARCHAR(50) NULL,
    `transporter` VARCHAR(100) NULL,
    `lr_no` VARCHAR(50) NULL,
    `vehicle_no` VARCHAR(20) NULL,
    `driver_name` VARCHAR(100) NULL,
    `driver_phone` VARCHAR(20) NULL,
    `loaded_by` VARCHAR(100) NULL,
    `packages` INTEGER NULL,
    `gross_weight_kg` DECIMAL(14, 3) NULL,
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dispatches_dispatch_no_key`(`dispatch_no`),
    INDEX `dispatches_sales_order_id_idx`(`sales_order_id`),
    INDEX `dispatches_invoice_id_idx`(`invoice_id`),
    INDEX `dispatches_dispatch_date_idx`(`dispatch_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dispatch_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dispatch_id` INTEGER NOT NULL,
    `sales_order_line_id` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,

    INDEX `dispatch_lines_dispatch_id_idx`(`dispatch_id`),
    INDEX `dispatch_lines_sales_order_line_id_idx`(`sales_order_line_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payment_no` VARCHAR(30) NOT NULL,
    `payment_date` DATE NOT NULL,
    `direction` ENUM('RECEIPT', 'PAYMENT') NOT NULL,
    `customer_id` INTEGER NULL,
    `supplier_id` INTEGER NULL,
    `invoice_id` INTEGER NULL,
    `purchase_order_id` INTEGER NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `mode` ENUM('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER') NOT NULL DEFAULT 'BANK_TRANSFER',
    `reference` VARCHAR(100) NULL,
    `remarks` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_payment_no_key`(`payment_no`),
    INDEX `payments_customer_id_idx`(`customer_id`),
    INDEX `payments_supplier_id_idx`(`supplier_id`),
    INDEX `payments_invoice_id_idx`(`invoice_id`),
    INDEX `payments_purchase_order_id_idx`(`purchase_order_id`),
    INDEX `payments_payment_date_idx`(`payment_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `departments_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emp_code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER') NOT NULL DEFAULT 'MALE',
    `date_of_birth` DATE NULL,
    `date_of_joining` DATE NULL,
    `department_id` INTEGER NULL,
    `designation` VARCHAR(100) NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(150) NULL,
    `address` VARCHAR(500) NULL,
    `basic_salary` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `ctc` DECIMAL(12, 2) NULL,
    `shift_hours` DECIMAL(4, 2) NOT NULL DEFAULT 8,
    `is_pf_eligible` BOOLEAN NOT NULL DEFAULT true,
    `uan` VARCHAR(20) NULL,
    `bank_name` VARCHAR(100) NULL,
    `bank_account_no` VARCHAR(30) NULL,
    `bank_ifsc` VARCHAR(15) NULL,
    `status` ENUM('ACTIVE', 'LEFT') NOT NULL DEFAULT 'ACTIVE',
    `left_on` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employees_emp_code_key`(`emp_code`),
    INDEX `employees_department_id_idx`(`department_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `punches` JSON NULL,
    `in_time` VARCHAR(5) NULL,
    `out_time` VARCHAR(5) NULL,
    `hours_worked` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `source` ENUM('DEVICE', 'MANUAL', 'IMPORT') NOT NULL DEFAULT 'DEVICE',
    `import_batch_id` VARCHAR(50) NULL,
    `remarks` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_date_idx`(`date`),
    UNIQUE INDEX `attendance_employee_id_date_key`(`employee_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_locks` (
    `date` DATE NOT NULL,
    `locked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `locked_by_id` INTEGER NULL,

    PRIMARY KEY (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_balances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `casual` DECIMAL(5, 1) NOT NULL DEFAULT 0,
    `sick` DECIMAL(5, 1) NOT NULL DEFAULT 0,
    `earned` DECIMAL(5, 1) NOT NULL DEFAULT 0,

    UNIQUE INDEX `leave_balances_employee_id_year_key`(`employee_id`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `type` ENUM('CL', 'SL', 'EL', 'LWP') NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `is_half_day` BOOLEAN NOT NULL DEFAULT false,
    `days` DECIMAL(5, 1) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `admin_remark` VARCHAR(500) NULL,
    `decided_by_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_requests_employee_id_idx`(`employee_id`),
    INDEX `leave_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_loans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `type` ENUM('ADVANCE', 'PERSONAL_LOAN') NOT NULL DEFAULT 'ADVANCE',
    `amount` DECIMAL(12, 2) NOT NULL,
    `emi_amount` DECIMAL(12, 2) NOT NULL,
    `balance` DECIMAL(12, 2) NOT NULL,
    `start_month` CHAR(7) NOT NULL,
    `disbursement_mode` ENUM('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER') NOT NULL DEFAULT 'BANK_TRANSFER',
    `disbursement_ref` VARCHAR(100) NULL,
    `reason` VARCHAR(255) NULL,
    `status` ENUM('ACTIVE', 'PAUSED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_loans_employee_id_idx`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loan_repayments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `loan_id` INTEGER NOT NULL,
    `payslip_id` INTEGER NULL,
    `date` DATE NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `remarks` VARCHAR(255) NULL,

    INDEX `loan_repayments_loan_id_idx`(`loan_id`),
    INDEX `loan_repayments_payslip_id_idx`(`payslip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `month` CHAR(7) NOT NULL,
    `month_days` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'FINALIZED', 'PAID') NOT NULL DEFAULT 'DRAFT',
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_runs_month_key`(`month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslips` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payroll_run_id` INTEGER NOT NULL,
    `employee_id` INTEGER NOT NULL,
    `basic_salary` DECIMAL(12, 2) NOT NULL,
    `present_days` DECIMAL(5, 1) NOT NULL,
    `hours_worked` DECIMAL(7, 2) NOT NULL,
    `hour_adjustment` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `gross_earning` DECIMAL(12, 2) NOT NULL,
    `pf_deduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `loan_deduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `other_adjustment` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `round_off` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `net_salary` DECIMAL(12, 2) NOT NULL,

    INDEX `payslips_employee_id_idx`(`employee_id`),
    UNIQUE INDEX `payslips_payroll_run_id_employee_id_key`(`payroll_run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(100) NULL,
    `department` VARCHAR(100) NULL,
    `employee_id` INTEGER NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'IN_USE',
    `assign_date` DATE NULL,
    `return_date` DATE NULL,
    `warranty_date` DATE NULL,
    `remarks` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `company_assets_code_key`(`code`),
    INDEX `company_assets_employee_id_idx`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `safety_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `location_zone` VARCHAR(150) NULL,
    `type_capacity` VARCHAR(150) NULL,
    `installation_date` DATE NULL,
    `last_inspection_date` DATE NULL,
    `next_due_date` DATE NULL,
    `last_service_date` DATE NULL,
    `vendor_agency` VARCHAR(200) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'OK',
    `remarks` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `safety_assets_code_key`(`code`),
    INDEX `safety_assets_next_due_date_idx`(`next_due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_counters` ADD CONSTRAINT `document_counters_series_code_fkey` FOREIGN KEY (`series_code`) REFERENCES `document_series`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_components` ADD CONSTRAINT `product_components_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_components` ADD CONSTRAINT `product_components_part_type_id_fkey` FOREIGN KEY (`part_type_id`) REFERENCES `part_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_part_type_id_fkey` FOREIGN KEY (`part_type_id`) REFERENCES `part_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_material_grade_id_fkey` FOREIGN KEY (`material_grade_id`) REFERENCES `material_grades`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `raw_materials` ADD CONSTRAINT `raw_materials_grade_id_fkey` FOREIGN KEY (`grade_id`) REFERENCES `material_grades`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `heats` ADD CONSTRAINT `heats_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `heats` ADD CONSTRAINT `heats_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_stage_roles` ADD CONSTRAINT `process_stage_roles_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `process_stages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_stage_roles` ADD CONSTRAINT `process_stage_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tools` ADD CONSTRAINT `tools_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_ledger` ADD CONSTRAINT `stock_ledger_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_ledger` ADD CONSTRAINT `stock_ledger_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_ledger` ADD CONSTRAINT `stock_ledger_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_balances` ADD CONSTRAINT `stock_balances_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_balances` ADD CONSTRAINT `stock_balances_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_balances` ADD CONSTRAINT `stock_balances_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_lines` ADD CONSTRAINT `sales_order_lines_sales_order_id_fkey` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_lines` ADD CONSTRAINT `sales_order_lines_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_lines` ADD CONSTRAINT `sales_order_lines_material_grade_id_fkey` FOREIGN KEY (`material_grade_id`) REFERENCES `material_grades`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_approvals` ADD CONSTRAINT `sales_order_approvals_sales_order_id_fkey` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_approvals` ADD CONSTRAINT `sales_order_approvals_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `production_requests` ADD CONSTRAINT `production_requests_sales_order_line_id_fkey` FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `production_requests` ADD CONSTRAINT `production_requests_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_cards` ADD CONSTRAINT `route_cards_production_request_id_fkey` FOREIGN KEY (`production_request_id`) REFERENCES `production_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_cards` ADD CONSTRAINT `route_cards_sales_order_line_id_fkey` FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_cards` ADD CONSTRAINT `route_cards_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_cards` ADD CONSTRAINT `route_cards_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_card_operations` ADD CONSTRAINT `route_card_operations_route_card_id_fkey` FOREIGN KEY (`route_card_id`) REFERENCES `route_cards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_card_operations` ADD CONSTRAINT `route_card_operations_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `process_stages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_card_operations` ADD CONSTRAINT `route_card_operations_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_requisitions` ADD CONSTRAINT `material_requisitions_route_card_id_fkey` FOREIGN KEY (`route_card_id`) REFERENCES `route_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_requisitions` ADD CONSTRAINT `material_requisitions_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_material_requisition_id_fkey` FOREIGN KEY (`material_requisition_id`) REFERENCES `material_requisitions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_route_card_id_fkey` FOREIGN KEY (`route_card_id`) REFERENCES `route_cards`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_job_work_material_id_fkey` FOREIGN KEY (`job_work_material_id`) REFERENCES `job_work_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_issued_by_id_fkey` FOREIGN KEY (`issued_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rc_completions` ADD CONSTRAINT `rc_completions_route_card_id_fkey` FOREIGN KEY (`route_card_id`) REFERENCES `route_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rc_completions` ADD CONSTRAINT `rc_completions_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_requisitions` ADD CONSTRAINT `purchase_requisitions_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_requisitions` ADD CONSTRAINT `purchase_requisitions_material_requisition_id_fkey` FOREIGN KEY (`material_requisition_id`) REFERENCES `material_requisitions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_requisitions` ADD CONSTRAINT `purchase_requisitions_job_work_order_id_fkey` FOREIGN KEY (`job_work_order_id`) REFERENCES `job_work_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_job_work_order_id_fkey` FOREIGN KEY (`job_work_order_id`) REFERENCES `job_work_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_purchase_requisition_id_fkey` FOREIGN KEY (`purchase_requisition_id`) REFERENCES `purchase_requisitions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_goods_receipt_id_fkey` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_purchase_order_line_id_fkey` FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_orders` ADD CONSTRAINT `job_work_orders_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_orders` ADD CONSTRAINT `job_work_orders_sales_order_id_fkey` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_order_lines` ADD CONSTRAINT `job_work_order_lines_job_work_order_id_fkey` FOREIGN KEY (`job_work_order_id`) REFERENCES `job_work_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_order_lines` ADD CONSTRAINT `job_work_order_lines_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_materials` ADD CONSTRAINT `job_work_materials_job_work_order_id_fkey` FOREIGN KEY (`job_work_order_id`) REFERENCES `job_work_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_materials` ADD CONSTRAINT `job_work_materials_raw_material_id_fkey` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_receipts` ADD CONSTRAINT `job_work_receipts_job_work_order_id_fkey` FOREIGN KEY (`job_work_order_id`) REFERENCES `job_work_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_receipt_lines` ADD CONSTRAINT `job_work_receipt_lines_job_work_receipt_id_fkey` FOREIGN KEY (`job_work_receipt_id`) REFERENCES `job_work_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_receipt_lines` ADD CONSTRAINT `job_work_receipt_lines_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_work_receipt_lines` ADD CONSTRAINT `job_work_receipt_lines_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assemblies` ADD CONSTRAINT `assemblies_sales_order_id_fkey` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assembly_lines` ADD CONSTRAINT `assembly_lines_assembly_id_fkey` FOREIGN KEY (`assembly_id`) REFERENCES `assemblies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assembly_lines` ADD CONSTRAINT `assembly_lines_sales_order_line_id_fkey` FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assembly_consumptions` ADD CONSTRAINT `assembly_consumptions_assembly_id_fkey` FOREIGN KEY (`assembly_id`) REFERENCES `assemblies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assembly_consumptions` ADD CONSTRAINT `assembly_consumptions_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assembly_consumptions` ADD CONSTRAINT `assembly_consumptions_heat_id_fkey` FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_sales_order_id_fkey` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_assembly_id_fkey` FOREIGN KEY (`assembly_id`) REFERENCES `assemblies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispatches` ADD CONSTRAINT `dispatches_sales_order_id_fkey` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispatches` ADD CONSTRAINT `dispatches_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispatch_lines` ADD CONSTRAINT `dispatch_lines_dispatch_id_fkey` FOREIGN KEY (`dispatch_id`) REFERENCES `dispatches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispatch_lines` ADD CONSTRAINT `dispatch_lines_sales_order_line_id_fkey` FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_balances` ADD CONSTRAINT `leave_balances_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_loans` ADD CONSTRAINT `employee_loans_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loan_repayments` ADD CONSTRAINT `loan_repayments_loan_id_fkey` FOREIGN KEY (`loan_id`) REFERENCES `employee_loans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loan_repayments` ADD CONSTRAINT `loan_repayments_payslip_id_fkey` FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_payroll_run_id_fkey` FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_assets` ADD CONSTRAINT `company_assets_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
