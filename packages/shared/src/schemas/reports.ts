import { z } from 'zod';
import { STOCK_LOCATIONS } from './purchase';

// ---------------------------------------------------------------- periods

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** Indian financial year (April - March) containing `today` ("YYYY-MM-DD"). */
export function financialYear(today: string): { from: string; to: string; label: string } {
  const [y, m] = today.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${String(start).slice(2)}-${String(start + 1).slice(2)}` };
}

export const PERIOD_PRESETS = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_fy: 'This year (FY)',
  last_fy: 'Last year (FY)',
};

/** From / to dates of a preset, counted from `today` ("YYYY-MM-DD"). Quarters follow the financial year (Apr-Jun ...). */
export function periodRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const month = (yy: number, mm: number) => ({ from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}` });
  switch (preset) {
    case 'this_month':
      return month(y, m);
    case 'last_month':
      return m === 1 ? month(y - 1, 12) : month(y, m - 1);
    case 'this_quarter': {
      const qStart = m - ((m - 4 + 12) % 3); // Apr, Jul, Oct, Jan
      const qEnd = qStart + 2;
      return { from: `${y}-${pad(qStart)}-01`, to: `${y}-${pad(qEnd)}-${pad(lastDay(y, qEnd))}` };
    }
    case 'this_fy': {
      const fy = financialYear(today);
      return { from: fy.from, to: fy.to };
    }
    case 'last_fy': {
      const fy = financialYear(`${y - 1}-${pad(m)}-01`);
      return { from: fy.from, to: fy.to };
    }
  }
}

// ---------------------------------------------------------------- filters

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');
const optionalId = z.coerce.number().int().positive().optional();
const period = { from: date, to: date };
const fromBeforeTo = (q: { from: string; to: string }) => q.from <= q.to;
const PERIOD_ERROR = { message: '"From" must not be after "to"', path: ['to'] };

export const STOCK_REPORT_KINDS = ['RAW_MATERIAL', 'FINISHED_GOOD'] as const;

/** Opening / in / out / closing per raw material or item (optionally per heat). */
export const stockMovementQuerySchema = z
  .object({
    ...period,
    kind: z.enum(STOCK_REPORT_KINDS),
    /** Empty = all locations together. */
    location: z.enum(STOCK_LOCATIONS).optional(),
    gradeId: optionalId,
    rawMaterialId: optionalId,
    productId: optionalId,
    itemId: optionalId,
    byHeat: z.enum(['true', 'false']).optional(),
    /** Hide rows with nothing in the period and nothing in stock. */
    hideEmpty: z.enum(['true', 'false']).optional(),
  })
  .refine(fromBeforeTo, PERIOD_ERROR);
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

export const productionReportQuerySchema = z.object({ ...period, productId: optionalId }).refine(fromBeforeTo, PERIOD_ERROR);
export type ProductionReportQuery = z.infer<typeof productionReportQuerySchema>;

export const pendingOrdersQuerySchema = z.object({
  customerId: optionalId,
  productId: optionalId,
  overdue: z.enum(['true', 'false']).optional(),
});
export type PendingOrdersQuery = z.infer<typeof pendingOrdersQuerySchema>;

export const SALES_GROUPS = ['register', 'customer', 'product', 'month'] as const;
export type SalesGroup = (typeof SALES_GROUPS)[number];

export const salesReportQuerySchema = z
  .object({ ...period, companyId: optionalId, customerId: optionalId, view: z.enum(SALES_GROUPS).default('register') })
  .refine(fromBeforeTo, PERIOD_ERROR);
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

export const purchaseReportQuerySchema = z
  .object({
    ...period,
    supplierId: optionalId,
    type: z.enum(['MATERIAL', 'JOB_WORK']).optional(),
    view: z.enum(['register', 'supplier']).default('register'),
  })
  .refine(fromBeforeTo, PERIOD_ERROR);
export type PurchaseReportQuery = z.infer<typeof purchaseReportQuerySchema>;

export const ageingQuerySchema = z.object({ direction: z.enum(['RECEIPT', 'PAYMENT']) });
export type AgeingQuery = z.infer<typeof ageingQuerySchema>;

/** Overdue buckets of the receivables / payables ageing. */
export const AGEING_BUCKETS = [
  { key: 'notDue', label: 'Not due yet' },
  { key: 'd30', label: '1–30 days' },
  { key: 'd60', label: '31–60 days' },
  { key: 'd90', label: '61–90 days' },
  { key: 'd90plus', label: 'Over 90 days' },
] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number]['key'];

export function ageingBucket(overdueDays: number): AgeingBucket {
  if (overdueDays <= 0) return 'notDue';
  if (overdueDays <= 30) return 'd30';
  if (overdueDays <= 60) return 'd60';
  if (overdueDays <= 90) return 'd90';
  return 'd90plus';
}

/** What the trace search box understands (shown as help text). */
export const TRACE_SEARCH_HINT = 'Heat no., mill heat no., SO no., customer PO, invoice no. or dispatch no.';
