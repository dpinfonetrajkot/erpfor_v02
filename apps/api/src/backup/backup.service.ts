import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  backupSettingsSchema,
  DEFAULT_BACKUP_SETTINGS,
  type BackupFile,
  type BackupKind,
  type BackupOverview,
  type BackupRun,
  type BackupSettings,
} from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../core/notifications.service';
import { brand } from '../config/brand';
import type { Env } from '../config/env';
import type { Actor } from '../common/auth-user';
import { dumpDatabase } from './sql-dump';

const SETTINGS_KEY = 'backup.settings';
/** backup-2026-11-24-020312-auto.sql.gz (server time). Only names like this are listed, downloaded or deleted. */
const FILE_NAME = /^backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})-(auto|manual)\.sql\.gz$/;
const STATUS_FILE = 'last-run.json';
/** How often the timer looks whether the daily backup is due (it also catches up after a restart). */
const CHECK_EVERY_MS = 5 * 60_000;
/** The first look waits a little, so the server is fully started and the database connected. */
const FIRST_CHECK_MS = 60_000;
/** After a failed automatic backup, wait this long before trying again. */
const RETRY_AFTER_MS = 2 * 60 * 60_000;
/** Half-written files left by a crash are removed after this. */
const STALE_PART_MS = 60 * 60_000;

const pad = (n: number, size = 2) => String(n).padStart(size, '0');
/** Local (server time) date key, e.g. 2026-11-24. */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d: Date) => `${dayKey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const fromName = (m: RegExpExecArray) => new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
/** That day at the HH:MM of the settings. */
const atTime = (day: Date, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
};
const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const describe = (s: BackupSettings) => (s.enabled ? `daily at ${s.time}, keep ${s.keepDays} days` : `off, keep ${s.keepDays} days`);

/** A short reason anyone can read (never contains the database password). */
function reason(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { sqlMessage?: string };
  if (e?.code === 'ENOSPC') return 'The server disk is full. Delete old backups or free some space.';
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return 'The ERP may not write to the backup folder on the server.';
  if (e?.code === 'EEXIST' || e?.code === 'ENOTDIR') return 'The backup folder on the server cannot be used (a file with the same name is in the way).';
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ER_GET_CONNECTION_TIMEOUT') return 'Could not connect to the database.';
  return (e?.sqlMessage || e?.message || String(err)).slice(0, 300);
}

/**
 * Database backups: one automatic backup a day at the set time (caught up after a restart),
 * "Back up now", and old files removed after the chosen number of days.
 * Files go to STORAGE_DIR/backups as .sql.gz, which phpMyAdmin and MySQL can load back.
 */
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Backup');
  readonly folder: string;
  private running: Promise<BackupRun> | null = null;
  /** undefined = not read from disk yet. */
  private lastRun: BackupRun | null | undefined;
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    this.folder = resolve(config.get('STORAGE_DIR', { infer: true }), 'backups');
  }

  onApplicationBootstrap() {
    this.timers.push(setTimeout(() => void this.tick(), FIRST_CHECK_MS).unref(), setInterval(() => void this.tick(), CHECK_EVERY_MS).unref());
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  // ------------------------------------------------------------------ settings and list

  async settings(): Promise<BackupSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row) return DEFAULT_BACKUP_SETTINGS;
    try {
      const parsed = backupSettingsSchema.safeParse(JSON.parse(row.value));
      return parsed.success ? parsed.data : DEFAULT_BACKUP_SETTINGS;
    } catch {
      return DEFAULT_BACKUP_SETTINGS;
    }
  }

  async saveSettings(input: BackupSettings, actor: Actor): Promise<BackupOverview> {
    const before = await this.settings();
    const value = JSON.stringify(input);
    await this.prisma.appSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'backup', summary: `Backup settings: ${describe(before)} → ${describe(input)}` });
    return this.overview();
  }

  async overview(): Promise<BackupOverview> {
    const [settings, files, lastRun] = await Promise.all([this.settings(), this.files(), this.readLastRun()]);
    const next = settings.enabled ? this.nextRun(settings, files, lastRun) : null;
    return {
      settings,
      files,
      totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
      lastRun,
      nextRunAt: next?.toISOString() ?? null,
      running: !!this.running,
      folder: this.folder,
    };
  }

  /** Backup files in the folder, newest first. */
  async files(): Promise<BackupFile[]> {
    let names: string[];
    try {
      names = await readdir(this.folder);
    } catch (err) {
      // no folder yet (or something else in its place: then making the backup fails and admins are told)
      if (['ENOENT', 'ENOTDIR'].includes((err as NodeJS.ErrnoException).code ?? '')) return [];
      throw err;
    }
    const files = await Promise.all(
      names.map(async (name): Promise<BackupFile | null> => {
        const m = FILE_NAME.exec(name);
        if (!m) return null;
        const info = await stat(join(this.folder, name)).catch(() => null);
        if (!info?.isFile()) return null;
        return { name, kind: m[7] as BackupKind, createdAt: fromName(m).toISOString(), sizeBytes: info.size };
      }),
    );
    return files.filter((f): f is BackupFile => f !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }

  /** Full path of a backup file, for download. */
  async pathOf(name: string): Promise<string> {
    if (!FILE_NAME.test(name)) throw new NotFoundException('Backup not found');
    const path = join(this.folder, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('This backup is not there any more');
    return path;
  }

  async remove(name: string, actor: Actor): Promise<void> {
    const path = await this.pathOf(name);
    await unlink(path);
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'backup', summary: `Deleted backup ${name}` });
  }

  /** Downloading a full copy of the data is recorded in the audit log. */
  async logDownload(name: string, actor: Actor): Promise<void> {
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'backup', summary: `Downloaded backup ${name}` });
  }

  // ------------------------------------------------------------------ making a backup

  /** "Back up now" from Settings. Returns the result (also when it failed, with the reason). */
  async backupNow(actor: Actor): Promise<BackupRun> {
    const run = await this.run('manual');
    await this.audit.log(actor, {
      action: AuditAction.CREATE,
      entity: 'backup',
      summary: run.ok ? `Made a backup now: ${run.file} (${sizeText(run.sizeBytes ?? 0)})` : `Backup failed: ${run.message}`,
    });
    return run;
  }

  private async run(kind: BackupKind): Promise<BackupRun> {
    if (this.running) throw new ConflictException('A backup is being made right now. Please wait a minute and look again.');
    this.running = this.make(kind);
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async make(kind: BackupKind): Promise<BackupRun> {
    const started = new Date();
    const name = `backup-${stamp(started)}-${kind}.sql.gz`;
    let run: BackupRun;
    try {
      await mkdir(this.folder, { recursive: true });
      const result = await dumpDatabase(this.config.get('DATABASE_URL', { infer: true }), join(this.folder, name), brand().name);
      const sizeBytes = (await stat(join(this.folder, name))).size;
      run = {
        at: started.toISOString(),
        ok: true,
        kind,
        file: name,
        sizeBytes,
        tables: result.tables,
        rows: result.rows,
        seconds: Math.round((Date.now() - started.getTime()) / 100) / 10,
      };
      this.logger.log(`Made ${name}: ${result.tables} tables, ${result.rows} rows, ${sizeText(sizeBytes)}`);
      await this.cleanUp();
    } catch (err) {
      run = { at: started.toISOString(), ok: false, kind, message: reason(err) };
      this.logger.error(`Backup failed: ${run.message}`);
      if (kind === 'auto') await this.tellAdmins(run.message!);
    }
    await this.saveLastRun(run);
    return run;
  }

  /** Removes backups older than the chosen number of days (the newest one always stays) and half-written files. */
  private async cleanUp() {
    const { keepDays } = await this.settings();
    const today = new Date();
    const oldest = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays + 1));
    const files = await this.files();
    for (const f of files.slice(1)) {
      if (dayKey(new Date(f.createdAt)) < oldest) {
        await unlink(join(this.folder, f.name)).catch((err: Error) => this.logger.warn(`Could not delete ${f.name}: ${err.message}`));
      }
    }
    for (const name of await readdir(this.folder)) {
      if (!name.endsWith('.part')) continue;
      const info = await stat(join(this.folder, name)).catch(() => null);
      if (info && Date.now() - info.mtimeMs > STALE_PART_MS) await unlink(join(this.folder, name)).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ the daily timer

  /** When the next automatic backup is due. In the past = due now (the timer starts it within 5 minutes). */
  private nextRun(settings: BackupSettings, files: BackupFile[], lastRun: BackupRun | null): Date {
    const now = new Date();
    const today = dayKey(now);
    if (files.some((f) => f.kind === 'auto' && dayKey(new Date(f.createdAt)) === today)) {
      return atTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), settings.time);
    }
    const due = atTime(now, settings.time);
    if (lastRun && !lastRun.ok && lastRun.kind === 'auto') {
      const retry = new Date(new Date(lastRun.at).getTime() + RETRY_AFTER_MS);
      if (retry > due) return retry;
    }
    return due;
  }

  private async tick() {
    if (this.running) return;
    try {
      const settings = await this.settings();
      if (!settings.enabled) return;
      const [files, lastRun] = await Promise.all([this.files(), this.readLastRun()]);
      if (this.nextRun(settings, files, lastRun) > new Date()) return;
      await this.run('auto');
    } catch (err) {
      this.logger.error(`Backup check failed: ${reason(err)}`);
    }
  }

  /** Bell notice to the people who look after settings (admins included). */
  private async tellAdmins(message: string) {
    try {
      const ids = await this.notifications.usersWith(['settings.update'], true);
      await this.notifications.toUsers(ids, { title: 'Automatic backup failed', body: message, link: '/settings#backups' }, { kind: 'TASK' });
    } catch (err) {
      this.logger.error(`Could not send the backup notice: ${reason(err)}`);
    }
  }

  // ------------------------------------------------------------------ last result (kept next to the files)

  private async readLastRun(): Promise<BackupRun | null> {
    if (this.lastRun !== undefined) return this.lastRun;
    try {
      this.lastRun = JSON.parse(await readFile(join(this.folder, STATUS_FILE), 'utf8')) as BackupRun;
    } catch {
      this.lastRun = null;
    }
    return this.lastRun;
  }

  private async saveLastRun(run: BackupRun) {
    this.lastRun = run;
    try {
      await mkdir(this.folder, { recursive: true });
      await writeFile(join(this.folder, STATUS_FILE), JSON.stringify(run, null, 2));
    } catch (err) {
      this.logger.warn(`Could not save the backup status: ${reason(err)}`);
    }
  }
}
