import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const moneyFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 125000.5 -> "1,25,000.5" (Indian grouping) */
export function fmtQty(value: number | null | undefined): string {
  return value == null ? '—' : qtyFmt.format(value);
}

export function fmtMoney(value: number | null | undefined, currency = 'INR'): string {
  if (value == null) return '—';
  return currency === 'INR' ? `₹${moneyFmt.format(value)}` : `${currency} ${moneyFmt.format(value)}`;
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** "2026-10-05T00:00:00.000Z" -> "05 Oct 2026" */
export function fmtDate(value: string | Date | null | undefined): string {
  return value ? format(toDate(value), 'dd MMM yyyy') : '—';
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  return value ? format(toDate(value), 'dd MMM yyyy, HH:mm') : '—';
}

export function fmtAgo(value: string | Date | null | undefined): string {
  return value ? `${formatDistanceToNowStrict(toDate(value))} ago` : 'never';
}

/** Date value for <input type="date"> */
export function toInputDate(value: string | Date | null | undefined): string {
  return value ? format(toDate(value), 'yyyy-MM-dd') : '';
}
