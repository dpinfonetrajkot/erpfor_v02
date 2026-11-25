import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createConnection, type Connection, type FieldInfo } from 'mariadb';

export interface DumpResult {
  tables: number;
  rows: number;
}

/**
 * INSERT statements are cut at about this size, far below the 16 MB packet limit of MySQL / MariaDB,
 * so the file also loads through phpMyAdmin.
 */
const MAX_STATEMENT_CHARS = 512 * 1024;

/** Written without quotes. */
const NUMBER_TYPES = new Set(['DECIMAL', 'NEWDECIMAL', 'TINY', 'SHORT', 'INT', 'INT24', 'BIGINT', 'FLOAT', 'DOUBLE', 'YEAR']);
/** String-like types that hold raw bytes when their collation is "binary" (63): written as hex. */
const BYTE_TYPES = new Set(['VARCHAR', 'VAR_STRING', 'STRING', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB']);
const BINARY_COLLATION = 63;
/** Computed columns cannot be inserted (MySQL "DEFAULT_GENERATED" is a normal column with a default). */
const GENERATED_COLUMN = /\b(VIRTUAL|STORED|PERSISTENT) GENERATED\b/i;

const ESCAPES: Record<string, string> = { '\0': '\\0', '\n': '\\n', '\r': '\\r', '\\': '\\\\', "'": "\\'", '"': '\\"', '\x1a': '\\Z' };
const quote = (s: string) => `'${s.replace(/[\0\n\r\\'"\x1a]/g, (c) => ESCAPES[c])}'`;
const ident = (name: string) => `\`${name.replace(/`/g, '``')}\``;

/**
 * Turns each value into SQL text exactly as the server sent it (no rounding of decimals,
 * no time-zone shifts of dates, JSON kept as written).
 */
function sqlLiteral(col: FieldInfo): string {
  const type = String(col.type);
  if (NUMBER_TYPES.has(type)) return col.string() ?? 'NULL';
  if (type === 'BIT' || type === 'GEOMETRY' || (BYTE_TYPES.has(type) && col.collation?.index === BINARY_COLLATION)) {
    const bytes = col.buffer();
    if (bytes === null) return 'NULL';
    return bytes.length ? `X'${bytes.toString('hex')}'` : "''";
  }
  const text = col.string();
  return text === null ? 'NULL' : quote(text);
}

interface DumpInfo {
  title: string;
  database: string;
  server: string;
  made: Date;
}

/** The whole backup as SQL text, table by table, rows streamed so memory stays small. */
async function* sqlText(conn: Connection, info: DumpInfo, result: DumpResult): AsyncGenerator<string> {
  yield [
    `-- ${info.title} ERP database backup`,
    `-- Database: ${info.database}   Server: ${info.server}`,
    `-- Made: ${info.made.toISOString()} (UTC)`,
    '--',
    '-- To restore: in phpMyAdmin pick the database (best an empty one), open Import and choose this file.',
    '-- Or on a computer with MySQL: mysql -u USER -p DATABASE < this-file.sql',
    '-- Every table in the file is dropped and created again with the saved rows.',
    '',
    'SET NAMES utf8mb4;',
    'SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;',
    'SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;',
    "SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
    "SET @OLD_TIME_ZONE=@@TIME_ZONE, TIME_ZONE='+00:00';",
    '',
  ].join('\n');

  const tables = await conn.query<{ name: string }[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  );
  const columns = await conn.query<{ tableName: string; name: string; extra: string | null }[]>(
    'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION',
  );

  for (const { name } of tables) {
    const [created] = await conn.query<Record<string, string>[]>(`SHOW CREATE TABLE ${ident(name)}`);
    yield `\n--\n-- Table ${ident(name)}\n--\n\nDROP TABLE IF EXISTS ${ident(name)};\n${created['Create Table']};\n`;

    const cols = columns.filter((c) => c.tableName === name && !GENERATED_COLUMN.test(c.extra ?? '')).map((c) => ident(c.name));
    result.tables++;
    if (!cols.length) continue;

    const head = `INSERT INTO ${ident(name)} (${cols.join(', ')}) VALUES\n`;
    const rows = conn.queryStream({ sql: `SELECT ${cols.join(', ')} FROM ${ident(name)}`, rowsAsArray: true, typeCast: sqlLiteral });
    let chunk = '';
    for await (const row of rows as AsyncIterable<string[]>) {
      chunk += `${chunk ? ',\n' : ''}(${row.join(',')})`;
      result.rows++;
      if (chunk.length >= MAX_STATEMENT_CHARS) {
        yield `${head}${chunk};\n`;
        chunk = '';
      }
    }
    if (chunk) yield `${head}${chunk};\n`;
  }

  yield [
    '',
    'SET TIME_ZONE=@OLD_TIME_ZONE;',
    'SET SQL_MODE=@OLD_SQL_MODE;',
    'SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;',
    'SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;',
    '',
    `-- Backup complete: ${result.tables} tables, ${result.rows} rows.`,
    '',
  ].join('\n');
}

/**
 * Writes a gzip-compressed SQL backup of the database in `databaseUrl` to `outFile`.
 * Plain Node.js, so it also works on hosting without the mysqldump program. All tables are read
 * inside one snapshot, so the copy is consistent even while people keep working.
 * The file only appears under its real name when it is complete.
 */
export async function dumpDatabase(databaseUrl: string, outFile: string, title: string): Promise<DumpResult> {
  const url = new URL(databaseUrl);
  const conn = await createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    allowPublicKeyRetrieval: true,
    connectTimeout: 15_000,
  });
  const partFile = `${outFile}.part`;
  const result: DumpResult = { tables: 0, rows: 0 };
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [about] = await conn.query<{ server: string; db: string }[]>('SELECT VERSION() AS server, DATABASE() AS db');
    const info: DumpInfo = { title, database: about.db, server: about.server, made: new Date() };

    await pipeline(Readable.from(sqlText(conn, info, result)), createGzip({ level: 6 }), createWriteStream(partFile));
    await conn.query('COMMIT');
    await rename(partFile, outFile);
    await conn.end();
    return result;
  } catch (err) {
    conn.destroy();
    await unlink(partFile).catch(() => undefined);
    throw err;
  }
}
