/**
 * Reads the attendance CSV exported from the biometric machine software (the format the old ERP took):
 *   EmpID, Name, Date, punch 1, punch 2, ..., TotalHours
 * Dates: 07/04/2026, 07-04-2026, 2026-04-07, 07-Apr-2026 or 07/04/26. Times: 08:31 or 08:31:00.
 */
export interface CsvAttendanceRow {
  line: number;
  empCode: string;
  name: string;
  date: string;
  punches: string[];
  machineHours: number | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Splits one CSV line, keeping quoted commas. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[ /-]([A-Za-z]{3})[A-Za-z]*[ /-](\d{2,4})/))) [d, m, y] = [Number(r[1]), MONTHS[r[2].toLowerCase()] ?? 0, Number(r[3])];
  else return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!m || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export function parseAttendanceCsv(text: string): { rows: CsvAttendanceRow[]; skipped: number } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let hoursCol = -1;
  const rows: CsvAttendanceRow[] = [];
  let skipped = 0;
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const c = cells(raw);
    const date = parseDate(c[2] ?? '');
    if (!date) {
      // a heading row (EmpID, Name, Date ...): remember where the total hours are
      if (c.some((x) => /date|emp|name/i.test(x))) {
        const h = c.findIndex((x) => /total.*hour/i.test(x));
        if (h >= 0) hoursCol = h;
      } else skipped++;
      return;
    }
    const empCode = (c[0] ?? '').trim();
    if (!empCode) {
      skipped++;
      return;
    }
    const end = hoursCol >= 3 ? hoursCol : c.length;
    const punches: string[] = [];
    for (let col = 3; col < end; col++) {
      const t = (c[col] ?? '').match(TIME);
      if (t && !(Number(t[1]) === 0 && Number(t[2]) === 0)) punches.push(`${t[1].padStart(2, '0')}:${t[2]}`);
    }
    let machineHours: number | null = null;
    const totalCell = hoursCol >= 0 ? c[hoursCol] : null;
    const tm = totalCell?.match(TIME);
    if (tm) machineHours = Math.round((Number(tm[1]) + Number(tm[2]) / 60) * 100) / 100;
    else if (totalCell && /^\d+(\.\d+)?$/.test(totalCell)) machineHours = Number(totalCell);
    // without a header the last time on the line is the machine total, not a punch
    if (hoursCol < 0 && punches.length > 1 && punches.length % 2 === 1) {
      const last = punches.pop()!;
      const [h, m] = last.split(':').map(Number);
      machineHours = Math.round((h + m / 60) * 100) / 100;
    }
    if (!punches.length) {
      skipped++;
      return;
    }
    rows.push({ line: i + 1, empCode, name: (c[1] ?? '').trim(), date, punches: [...new Set(punches)].sort(), machineHours });
  });
  return { rows, skipped };
}
