-- Prisma Migrate needs a "shadow" database while creating migrations,
-- and the legacy import reads the old dump from a separate database.
CREATE DATABASE IF NOT EXISTS bhterp_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS bht_legacy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON bhterp.* TO 'bht'@'%';
GRANT ALL PRIVILEGES ON bhterp_shadow.* TO 'bht'@'%';
GRANT ALL PRIVILEGES ON bht_legacy.* TO 'bht'@'%';
FLUSH PRIVILEGES;
