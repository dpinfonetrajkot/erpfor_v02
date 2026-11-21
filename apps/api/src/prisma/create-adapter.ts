import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Builds the MySQL/MariaDB driver adapter from a mysql:// connection URL.
 * Shared by the Nest app, the seed and the legacy import script.
 */
export function createAdapter(databaseUrl: string): PrismaMariaDb {
  const url = new URL(databaseUrl);
  return new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: Number(url.searchParams.get('connection_limit') ?? 10),
    // MySQL 8 uses caching_sha2_password; without TLS the client must fetch the server key.
    allowPublicKeyRetrieval: true,
    // Prisma reads and writes DATETIME as UTC. A server running on India time (the usual
    // Windows / VPS install) would otherwise shift NOW() and defaults by 5:30.
    initSql: "SET time_zone = '+00:00'",
  });
}
