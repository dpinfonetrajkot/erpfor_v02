import { Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentSeriesCode } from '@bht/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { ResetPeriod } from '../generated/prisma/client';

/** Indian financial year starts in April. */
const FY_START_MONTH = 4;

@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the next document number, e.g. "SO/26-27/0001".
   * Safe under concurrency: the counter row is incremented atomically by MySQL.
   * Pass `tx` so a failed save also rolls the number back (no gaps).
   * A template with {CO} (company code, passed in `vars`) is counted per company:
   * each GSTIN keeps its own unbroken invoice series.
   */
  async next(
    code: DocumentSeriesCode,
    opts: { date?: Date; vars?: Record<string, string>; tx?: Tx } = {},
  ): Promise<string> {
    const date = opts.date ?? new Date();
    const run = async (tx: Tx) => {
      const series = await tx.documentSeries.findUnique({ where: { code } });
      if (!series) throw new NotFoundException(`Number series ${code} is not configured`);

      const period = periodKey(series.resetPeriod, date) + scopeOf(series.template, opts.vars);
      // LAST_INSERT_ID(expr) makes the new value readable on this same connection.
      await tx.$executeRaw`
        INSERT INTO document_counters (series_code, period, last_number)
        VALUES (${code}, ${period}, LAST_INSERT_ID(1))
        ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`;
      const rows = await tx.$queryRaw<{ n: bigint | number }[]>`SELECT LAST_INSERT_ID() AS n`;
      return format(series.template, Number(rows[0].n), date, opts.vars);
    };
    return opts.tx ? run(opts.tx) : this.prisma.$transaction(run);
  }

  /**
   * What the next number will look like, without using it up.
   * {CO} is the given company code, or the default company's.
   */
  async preview(code: string, date = new Date(), companyCode?: string): Promise<string> {
    const series = await this.prisma.documentSeries.findUnique({ where: { code } });
    if (!series) throw new NotFoundException(`Number series ${code} is not configured`);
    const company = companyCode ? null : await this.prisma.company.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
    const vars = { GRADE: 'A', CO: companyCode ?? company?.code ?? 'CO' };
    const counter = await this.prisma.documentCounter.findUnique({
      where: { seriesCode_period: { seriesCode: code, period: periodKey(series.resetPeriod, date) + scopeOf(series.template, vars) } },
    });
    return format(series.template, (counter?.lastNumber ?? 0) + 1, date, vars);
  }
}

export function financialYear(date: Date): { start: number; label: string } {
  const year = date.getFullYear();
  const start = date.getMonth() + 1 >= FY_START_MONTH ? year : year - 1;
  const label = `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
  return { start, label };
}

/** ":DEMO" for a per-company series, "" otherwise. */
function scopeOf(template: string, vars: Record<string, string> = {}): string {
  if (!template.includes('{CO}')) return '';
  if (!vars.CO) throw new NotFoundException('This number series needs the company');
  return `:${vars.CO}`;
}

function periodKey(reset: ResetPeriod, date: Date): string {
  if (reset === ResetPeriod.NEVER) return 'ALL';
  if (reset === ResetPeriod.MONTHLY) {
    return `M${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  const { start } = financialYear(date);
  return `FY${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

export function format(
  template: string,
  seq: number,
  date: Date,
  vars: Record<string, string> = {},
): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return template
    .replace(/\{SEQ(?::(\d))?\}/g, (_, len) => pad(seq, len ? Number(len) : 1))
    .replace(/\{FY\}/g, financialYear(date).label)
    .replace(/\{YYYY\}/g, String(date.getFullYear()))
    .replace(/\{YY\}/g, String(date.getFullYear()).slice(-2))
    .replace(/\{MM\}/g, pad(date.getMonth() + 1))
    .replace(/\{DD\}/g, pad(date.getDate()))
    .replace(/\{([A-Z]+)\}/g, (match, key: string) => vars[key] ?? match);
}
