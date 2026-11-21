import { z } from 'zod';

/** Required trimmed text. */
export const text = (max = 255) => z.string().trim().min(1, 'Required').max(max);

/** Optional trimmed text. Empty strings are allowed here; the API stores them as NULL. */
export const optionalText = (max = 255) => z.string().trim().max(max).optional();

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

/** Optional number that accepts "" from HTML inputs. */
export const optionalNumber = (min = 0) =>
  z.preprocess(emptyToUndefined, z.coerce.number().min(min).optional());

/** Required number that accepts numeric strings from HTML inputs. */
export const number = (min = 0) => z.coerce.number({ error: 'Must be a number' }).min(min);

/** Optional foreign key id (select boxes send "" when nothing is chosen). */
export const optionalId = () => z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional());

export const id = () => z.coerce.number({ error: 'Required' }).int().positive('Required');

/** "YYYY-MM-DD" or empty. */
export const optionalDate = () =>
  z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')]).optional();

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const optionalGstin = () =>
  z.union([z.literal(''), z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN')]).optional();

export const optionalPan = () =>
  z.union([z.literal(''), z.string().trim().toUpperCase().regex(PAN_REGEX, 'Invalid PAN')]).optional();

export const optionalEmail = () =>
  z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Invalid email'))]).optional();

export const optionalPhone = () =>
  z
    .union([z.literal(''), z.string().trim().regex(/^[+0-9 ()-]{6,20}$/, 'Invalid phone number')])
    .optional();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  search: z.string().trim().max(100).optional(),
  sortBy: z.string().trim().max(50).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  /** "true" / "false" filter on isActive, when the entity has it. */
  active: z.enum(['true', 'false']).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Shape of every error response from the API. */
export interface ApiError {
  statusCode: number;
  message: string;
  /** Field-level validation errors: { "gstin": "Invalid GSTIN" } */
  errors?: Record<string, string>;
}
