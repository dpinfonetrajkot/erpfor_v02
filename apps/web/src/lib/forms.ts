'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { toInputDate } from './format';

/** react-hook-form wired to a shared zod schema (same rules as the API). */
export function useZodForm<S extends z.ZodType<any, any>>(schema: S, defaultValues: z.input<S>) {
  return useForm<z.input<S>, any, z.output<S>>({
    resolver: zodResolver(schema as any) as any,
    defaultValues: defaultValues as any,
    mode: 'onTouched',
  });
}

/**
 * Form values for editing an existing record: takes each field of `defaults`
 * from the record, turning null into the default and dates into yyyy-MM-dd.
 */
export function fromEntity<T extends Record<string, unknown>>(defaults: T, entity?: object | null): T {
  if (!entity) return defaults;
  const source = entity as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    if (/Date$/.test(key) && typeof value === 'string') out[key] = toInputDate(value);
    else if (typeof defaults[key] === 'string' && typeof value === 'number') out[key] = String(value);
    else out[key] = value;
  }
  return out as T;
}
