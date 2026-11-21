import { hasPermission, type AssistantAnswer } from '@bht/shared';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { TraceabilityService } from '../reports/traceability.service';
import type { ReportsService } from '../reports/reports.service';
import type { BusinessReportsService } from '../reports/business-reports.service';
import type { PaymentsService } from '../billing/payments.service';
import type { AttendanceService } from '../hr/attendance.service';
import type { DashboardService } from '../dashboard/dashboard.service';
import type { SearchService } from '../dashboard/search.service';
import type { NumberingService } from '../core/numbering.service';
import type { AuthUser } from '../common/auth-user';
import type { Found } from './catalog';
import { fmtDay, type DocKind, type Parsed, type Period } from './language';

/** ERP services the answers read from (the same ones the screens use). */
export interface Deps {
  prisma: PrismaService;
  trace: TraceabilityService;
  reports: ReportsService;
  business: BusinessReportsService;
  payments: PaymentsService;
  attendance: AttendanceService;
  dashboard: DashboardService;
  search: SearchService;
  numbering: NumberingService;
}

export type Params = Record<string, string | number>;

/** An answer before the topic and follow-up context are added. */
export type Reply = Omit<AssistantAnswer, 'topic' | 'context'> & { params?: Params };

export interface Topic {
  id: string;
  /** Group for the example list ("Stock", "HR" ...). */
  area: string;
  /** Short name used in "you do not have access to ...". */
  label: string;
  /** Any one of these lets the user ask this. */
  permissions: string[];
  /** Shown to users who may ask the topic; one with its own permission is shown only to those who have that. */
  examples: (string | { q: string; permission: string })[];
  /** 0 = not about this; the topic with the highest score answers (4 or more needed). */
  score(p: Parsed, found: Found): number;
  answer(ask: Ask): Promise<Reply>;
}

/** One question being answered: what was typed, what it mentions, who asks, the previous question. */
export class Ask {
  constructor(
    readonly p: Parsed,
    readonly found: Found,
    readonly user: AuthUser,
    readonly today: string,
    readonly deps: Deps,
    /** Parameters of the previous answer when this is a follow-up ("and last month?"). */
    readonly prev: Params = {},
  ) {}

  get prisma() {
    return this.deps.prisma;
  }

  can(permission: string) {
    return hasPermission(this.user.permissions, permission);
  }

  /** The period typed, else the previous question's, else the default. */
  period(fallback: Period): Period {
    if (this.p.period) return this.p.period;
    const { from, to, periodLabel, month } = this.prev;
    if (typeof from === 'string' && typeof to === 'string') {
      return { from, to, label: String(periodLabel ?? `${fmtDay(from)} – ${fmtDay(to)}`), ...(typeof month === 'string' ? { month } : {}) };
    }
    return fallback;
  }

  /** Ids named in this question, else the one of the previous question. */
  ids(found: { id: number }[], prevKey: string): number[] {
    if (found.length) return found.map((f) => f.id);
    const prev = this.prev[prevKey];
    return typeof prev === 'number' ? [prev] : typeof prev === 'string' && prev ? prev.split(',').map(Number) : [];
  }
}

export const periodParams = (p: Period): Params => ({ from: p.from, to: p.to, periodLabel: p.label, ...(p.month ? { month: p.month } : {}) });

// ------------------------------------------------------------------ formatting

const rupeeFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
export const rupees = (v: number) => `${v < 0 ? '−' : ''}₹${rupeeFmt.format(Math.abs(Math.round(v)))}`;
export const qty = (v: number, unit?: string) => `${qtyFmt.format(v)}${unit ? ` ${unit}` : ''}`;
export const day = (d: Date | string | null | undefined) => (d ? fmtDay(typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : '—');
export const plural = (n: number, one: string, many = `${one}s`) => `${qtyFmt.format(n)} ${n === 1 ? one : many}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "today", "this week", "on 21 Oct 2026", "in September 2026". */
export const during = (p: Period) => (/^(today|yesterday|tomorrow|this |last )/.test(p.label) ? p.label : p.from === p.to ? `on ${p.label}` : `in ${p.label}`);
export const list = (names: string[], max = 8) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`);

/** Days from today to a date: "in 5 days", "today", "3 days late". */
export function dueIn(d: Date | null | undefined, today: string): string {
  if (!d) return '';
  const days = Math.round((d.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days === 0 ? 'today' : days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} late`;
}

/** A table of at most `max` rows; the rest are counted. */
export function table(columns: (string | { label: string; align: 'right' })[], rows: string[][], max = 10): NonNullable<Reply['table']> {
  return {
    columns: columns.map((c) => (typeof c === 'string' ? { label: c } : c)),
    rows: rows.slice(0, max),
    ...(rows.length > max ? { more: rows.length - max } : {}),
  };
}

export const R = (label: string) => ({ label, align: 'right' as const });

// ------------------------------------------------------------------ documents

/** Kind of a full document number by its prefix (SO/, PO/ ...); company codes are invoices. */
export function docKind(doc: string): DocKind | 'OTHER' {
  const prefix = doc.split('/')[0];
  const known: Record<string, DocKind> = { SO: 'SO', PO: 'PO', RC: 'RC', JWO: 'JWO', DC: 'DISPATCH', GE: 'GRN' };
  if (known[prefix]) return known[prefix];
  return ['PRQ', 'PR', 'MR', 'RCC', 'JWR', 'ASM', 'PAY'].includes(prefix) ? 'OTHER' : 'INVOICE';
}

/** Full numbers of this kind in the question, plus short ones ("so 3") resolved to the newest match. */
export async function docNumbers(ask: Ask, kind: DocKind, latest: (suffix: number) => Promise<string | null>): Promise<string[]> {
  const full = ask.p.docs.filter((d) => docKind(d) === kind);
  const short = await Promise.all(ask.p.shortDocs.filter((s) => s.kind === kind).map((s) => latest(s.num)));
  return [...new Set([...full, ...short.filter((s): s is string => !!s)])];
}

/** The newest document number ending in /…0003 for "so 3". */
export function endsWithNumber(n: number) {
  return (numbers: string[]) => numbers.find((x) => new RegExp(`/0*${n}$`).test(x)) ?? null;
}

/** Reply when a name matched several people / parties. */
export function whichOne(what: string, options: string[], ask: (o: string) => string): Reply {
  return {
    text: `More than one ${what} matches. Which one do you mean?`,
    suggestions: options.slice(0, 6).map(ask),
  };
}
