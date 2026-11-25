import { z } from 'zod';

/**
 * Export to Tally (TallyPrime / Tally.ERP 9) as XML: one file with the ledgers (masters),
 * one with the vouchers. The names below are the ledgers in the client's Tally company:
 * the accountant can change each one to match the books.
 */

/** Ledgers the vouchers post to. `group` is used when the ledgers file creates a ledger that is not in Tally yet. */
export const TALLY_LEDGERS = [
  { key: 'sales', label: 'Sales', group: 'Sales Accounts', defaultName: 'Sales GST {rate}%', hint: 'Sales in India. {rate} becomes the GST rate, e.g. "Sales GST 18%". Without {rate} all sales go to one ledger.' },
  { key: 'exportSales', label: 'Export sales', group: 'Sales Accounts', defaultName: 'Export Sales', hint: 'Export invoices.' },
  { key: 'salesFreight', label: 'Freight on invoices', group: 'Indirect Incomes', defaultName: 'Freight Charges', hint: 'Freight added on sales invoices. Leave empty to add it to the sales ledger.', optional: true },
  { key: 'purchase', label: 'Purchase (material)', group: 'Purchase Accounts', defaultName: 'Purchase GST {rate}%', hint: 'Material purchase orders. {rate} becomes the GST rate.' },
  { key: 'jobWork', label: 'Job work charges', group: 'Purchase Accounts', defaultName: 'Job Work Charges', hint: 'Job work purchase orders. {rate} can be used here too.' },
  { key: 'purchaseFreight', label: 'Freight on purchases', group: 'Indirect Expenses', defaultName: 'Freight Inward', hint: 'Freight on purchase orders. Leave empty to add it to the purchase ledger.', optional: true },
  { key: 'outputCgst', label: 'Output CGST', group: 'Duties & Taxes', defaultName: 'Output CGST', dutyHead: 'Central Tax' },
  { key: 'outputSgst', label: 'Output SGST', group: 'Duties & Taxes', defaultName: 'Output SGST', dutyHead: 'State Tax' },
  { key: 'outputIgst', label: 'Output IGST', group: 'Duties & Taxes', defaultName: 'Output IGST', dutyHead: 'Integrated Tax' },
  { key: 'inputCgst', label: 'Input CGST', group: 'Duties & Taxes', defaultName: 'Input CGST', dutyHead: 'Central Tax' },
  { key: 'inputSgst', label: 'Input SGST', group: 'Duties & Taxes', defaultName: 'Input SGST', dutyHead: 'State Tax' },
  { key: 'inputIgst', label: 'Input IGST', group: 'Duties & Taxes', defaultName: 'Input IGST', dutyHead: 'Integrated Tax' },
  { key: 'roundOff', label: 'Round off', group: 'Indirect Expenses', defaultName: 'Round Off', hint: 'The paise rounded on invoices and purchase orders.' },
  { key: 'bank', label: 'Bank', group: 'Bank Accounts', defaultName: 'Bank Account', hint: 'Money by bank transfer, UPI, cheque or other.' },
  { key: 'cash', label: 'Cash', group: 'Cash-in-Hand', defaultName: 'Cash', hint: 'Money paid or received in cash.' },
] as const;
export type TallyLedgerKey = (typeof TALLY_LEDGERS)[number]['key'];

/** Voucher types in Tally. */
export const TALLY_VOUCHER_TYPES = [
  { key: 'sales', label: 'Sales invoices', defaultName: 'Sales' },
  { key: 'purchase', label: 'Purchases', defaultName: 'Purchase' },
  { key: 'receipt', label: 'Money received', defaultName: 'Receipt' },
  { key: 'payment', label: 'Money paid', defaultName: 'Payment' },
] as const;
export type TallyVoucherKey = (typeof TALLY_VOUCHER_TYPES)[number]['key'];

const name = z.string().trim().max(80, 'At most 80 characters');
const required = name.min(1, 'Required');

export const tallySettingsSchema = z.object({
  ledgers: z.object({
    sales: required,
    exportSales: required,
    salesFreight: name,
    purchase: required,
    jobWork: required,
    purchaseFreight: name,
    outputCgst: required,
    outputSgst: required,
    outputIgst: required,
    inputCgst: required,
    inputSgst: required,
    inputIgst: required,
    roundOff: required,
    bank: required,
    cash: required,
  }),
  voucherTypes: z.object({ sales: required, purchase: required, receipt: required, payment: required }),
});
export type TallySettings = z.infer<typeof tallySettingsSchema>;

export const DEFAULT_TALLY_SETTINGS: TallySettings = {
  ledgers: Object.fromEntries(TALLY_LEDGERS.map((l) => [l.key, l.defaultName])) as TallySettings['ledgers'],
  voucherTypes: Object.fromEntries(TALLY_VOUCHER_TYPES.map((v) => [v.key, v.defaultName])) as TallySettings['voucherTypes'],
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');
const flag = z.enum(['true', 'false']).default('true').transform((v) => v === 'true');

/** What to export: one company, one period, and which kinds of vouchers. */
export const tallyExportQuerySchema = z
  .object({
    companyId: z.coerce.number().int().positive('Choose a company'),
    from: date,
    to: date,
    sales: flag,
    purchases: flag,
    receipts: flag,
    payments: flag,
  })
  .refine((q) => q.from <= q.to, { message: '"From" must not be after "to"', path: ['to'] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 400 * 86_400_000, { message: 'Export at most one year at a time', path: ['from'] })
  .refine((q) => q.sales || q.purchases || q.receipts || q.payments, { message: 'Choose at least one kind of entry', path: ['sales'] });
export type TallyExportQuery = z.infer<typeof tallyExportQuerySchema>;

export type TallyVoucherKind = 'Sales' | 'Purchase' | 'Receipt' | 'Payment';

export interface TallyPreviewRow {
  date: string;
  kind: TallyVoucherKind;
  number: string;
  party: string;
  /** In rupees (foreign-currency invoices converted at their exchange rate). */
  amount: number;
  reference: string | null;
}

export interface TallyLastExport {
  at: string;
  by: string;
  company: string;
  from: string;
  to: string;
  vouchers: number;
}

export interface TallyPreview {
  company: { id: number; code: string; name: string };
  from: string;
  to: string;
  counts: Record<TallyVoucherKind, number>;
  totals: Record<TallyVoucherKind, number>;
  /** Ledgers in the ledgers file (parties + accounts). */
  ledgers: number;
  /** Newest last, like the file; at most 500. */
  rows: TallyPreviewRow[];
  moreRows: number;
  /** Things the accountant should know (drafts left out, missing states ...). */
  warnings: string[];
  lastExport: TallyLastExport | null;
}
