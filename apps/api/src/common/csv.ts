import type { Response } from 'express';

/** Quote a CSV cell; also stops Excel from running "=..." as a formula. */
export function csv(value: string): string {
  const safe = /^[=+\-@]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

type Cell = string | number | null | undefined | Date;

const cell = (v: Cell): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};

/** Sends rows as a CSV file Excel opens directly (UTF-8 with BOM). */
export function sendCsv(res: Response, fileName: string, header: string[], rows: Cell[][]) {
  const lines = [header, ...rows].map((r) => r.map((v) => csv(cell(v))).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.end(`﻿${lines.join('\r\n')}`);
}
