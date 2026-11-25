import { z } from 'zod';
import { optionalEmail, optionalGstin, optionalPan, optionalText, text } from './common';

/** One of your own legal entities (the "From" on POs and invoices). */
export const companySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Required')
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, 'Letters, numbers, - and _ only'),
  name: text(200),
  legalName: optionalText(200),
  address: optionalText(500),
  city: optionalText(100),
  stateCode: optionalText(2),
  pincode: optionalText(10),
  country: text(60).default('India'),
  phone: optionalText(50),
  email: optionalEmail(),
  website: optionalText(200),
  gstin: optionalGstin(),
  pan: optionalPan(),
  iecCode: optionalText(20),
  bankName: optionalText(100),
  bankAccountNo: optionalText(30),
  bankIfsc: optionalText(15),
  bankBranch: optionalText(100),
  swiftCode: optionalText(15),
  invoiceTerms: optionalText(3000),
  purchaseTerms: optionalText(3000),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const RESET_PERIODS = ['NEVER', 'FINANCIAL_YEAR', 'MONTHLY'] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

/**
 * Number format tokens:
 *   {FY}    financial year, e.g. 26-27
 *   {YYYY} {YY} {MM} {DD}  date parts
 *   {GRADE} heat letter of the material grade (heat numbers only)
 *   {SEQ:n} running number padded to n digits
 */
export const documentSeriesSchema = z.object({
  template: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(60)
    .refine((t) => /\{SEQ(:\d)?\}/.test(t), 'Template must contain {SEQ} or {SEQ:n}'),
  resetPeriod: z.enum(RESET_PERIODS).default('FINANCIAL_YEAR'),
});
export type DocumentSeriesInput = z.infer<typeof documentSeriesSchema>;

// ------------------------------------------------------------------ database backups

/** How many days of backups to keep (older ones are deleted after each new backup). */
export const BACKUP_KEEP_DAYS = [3, 7, 14, 30] as const;

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Server time, 24-hour "HH:MM". */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 02:00'),
  keepDays: z.coerce.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days'),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: true, time: '02:00', keepDays: 7 };

export type BackupKind = 'auto' | 'manual';

export interface BackupFile {
  name: string;
  kind: BackupKind;
  createdAt: string;
  sizeBytes: number;
}

/** The result of the last backup attempt (made or failed). */
export interface BackupRun {
  at: string;
  ok: boolean;
  kind: BackupKind;
  file?: string;
  sizeBytes?: number;
  tables?: number;
  rows?: number;
  seconds?: number;
  message?: string;
}

export interface BackupOverview {
  settings: BackupSettings;
  /** Newest first. */
  files: BackupFile[];
  totalBytes: number;
  lastRun: BackupRun | null;
  /** When the next automatic backup is due (null when automatic backups are off). In the past = it starts in a few minutes. */
  nextRunAt: string | null;
  running: boolean;
  /** Folder on the server where the backups are kept. */
  folder: string;
}
