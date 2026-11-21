/**
 * Form values -> database values:
 *   ""          -> null      (optional text left empty)
 *   undefined   -> null      (optional number left empty)
 *   "2026-04-01" for keys ending in "Date" (or listed in dateKeys) -> Date
 */
export function normalize<T extends Record<string, unknown>>(input: T, dateKeys: string[] = []): { [K in keyof T]: any } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === '' || value === undefined) {
      out[key] = null;
    } else if (
      typeof value === 'string' &&
      (/Date$/.test(key) || dateKeys.includes(key)) &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      out[key] = new Date(`${value}T00:00:00.000Z`);
    } else {
      out[key] = value;
    }
  }
  return out as { [K in keyof T]: any };
}

/** Fields whose values differ, for the audit log: { name: ["Old", "New"] }. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    if (key === 'updatedAt' || key === 'createdAt') continue;
    const a = comparable(before[key]);
    const b = comparable(after[key]);
    if (a !== b) changes[key] = [before[key] ?? null, after[key] ?? null];
  }
  return changes;
}

function comparable(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
