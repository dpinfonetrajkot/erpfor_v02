/**
 * Purchase / sales document maths, shared by the web form (live totals)
 * and the API (stored totals), so both always agree.
 */

export const GST_TYPES = ['INTRA_STATE', 'INTER_STATE', 'EXPORT', 'EXEMPT'] as const;
export type GstType = (typeof GST_TYPES)[number];
export const GST_TYPE_LABELS: Record<GstType, string> = {
  INTRA_STATE: 'CGST + SGST (same state)',
  INTER_STATE: 'IGST (other state)',
  EXPORT: 'Import / export (no GST)',
  EXEMPT: 'Exempt (no GST)',
};

/** Supplier/customer in our state -> CGST+SGST, other Indian state -> IGST, abroad -> no GST. */
export function defaultGstType(ourStateCode: string | null | undefined, partyStateCode: string | null | undefined, partyCountry?: string | null): GstType {
  if (partyCountry && partyCountry.trim().toLowerCase() !== 'india') return 'EXPORT';
  if (!ourStateCode || !partyStateCode) return 'INTRA_STATE';
  return ourStateCode === partyStateCode ? 'INTRA_STATE' : 'INTER_STATE';
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface TotalsInput {
  lines: { quantity: number; rate: number }[];
  discountPercent?: number;
  freight?: number;
  taxRate?: number;
  gstType: GstType;
  currency?: string;
}

export interface Totals {
  lineAmounts: number[];
  subTotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  grandTotal: number;
}

/**
 * Sub total -> less discount % -> plus freight = taxable -> GST -> grand total.
 * INR totals are rounded to whole rupees (round-off shown separately).
 */
export function computeTotals(input: TotalsInput): Totals {
  const lineAmounts = input.lines.map((l) => round2((Number(l.quantity) || 0) * (Number(l.rate) || 0)));
  const subTotal = round2(lineAmounts.reduce((a, b) => a + b, 0));
  const discountAmount = round2((subTotal * (Number(input.discountPercent) || 0)) / 100);
  const taxableAmount = round2(subTotal - discountAmount + (Number(input.freight) || 0));
  const taxed = input.gstType === 'INTRA_STATE' || input.gstType === 'INTER_STATE';
  const taxAmount = taxed ? round2((taxableAmount * (Number(input.taxRate) || 0)) / 100) : 0;
  const cgst = input.gstType === 'INTRA_STATE' ? round2(taxAmount / 2) : 0;
  const sgst = input.gstType === 'INTRA_STATE' ? round2(taxAmount - cgst) : 0;
  const igst = input.gstType === 'INTER_STATE' ? taxAmount : 0;
  const exact = round2(taxableAmount + taxAmount);
  const grandTotal = (input.currency ?? 'INR') === 'INR' ? Math.round(exact) : exact;
  return {
    lineAmounts,
    subTotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    cgst,
    sgst,
    igst,
    roundOff: round2(grandTotal - exact),
    grandTotal,
  };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Indian system: 1,23,45,678 -> "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight" */
export function numberToWordsIndian(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** 12345.5 -> "Rupees Twelve Thousand Three Hundred Forty Five and Fifty Paise Only" */
export function amountInWords(value: number, currency = 'INR'): string {
  const whole = Math.floor(Math.abs(value));
  const fraction = Math.round((Math.abs(value) - whole) * 100);
  const [major, minor] = currency === 'INR' ? ['Rupees', 'Paise'] : [currency, 'Cents'];
  return `${major} ${numberToWordsIndian(whole)}${fraction ? ` and ${belowHundred(fraction)} ${minor}` : ''} Only`;
}
