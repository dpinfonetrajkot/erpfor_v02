import { z } from 'zod';
import { optionalEmail, optionalGstin, optionalPan, optionalText, text } from './common';

/** One of your own legal entities (the "From" on POs and invoices). */
export const companySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Required')
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, 'Letters, numbers, - and _ only'),
  name: text(200),
  legalName: optionalText(200),
  address: optionalText(500),
  city: optionalText(100),
  stateCode: optionalText(2),
  pincode: optionalText(10),
  country: text(60).default('India'),
  phone: optionalText(50),
  email: optionalEmail(),
  website: optionalText(200),
  gstin: optionalGstin(),
  pan: optionalPan(),
  iecCode: optionalText(20),
  bankName: optionalText(100),
  bankAccountNo: optionalText(30),
  bankIfsc: optionalText(15),
  bankBranch: optionalText(100),
  swiftCode: optionalText(15),
  invoiceTerms: optionalText(3000),
  purchaseTerms: optionalText(3000),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const RESET_PERIODS = ['NEVER', 'FINANCIAL_YEAR', 'MONTHLY'] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

/**
 * Number format tokens:
 *   {FY}    financial year, e.g. 26-27
 *   {YYYY} {YY} {MM} {DD}  date parts
 *   {GRADE} heat letter of the material grade (heat numbers only)
 *   {SEQ:n} running number padded to n digits
 */
export const documentSeriesSchema = z.object({
  template: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(60)
    .refine((t) => /\{SEQ(:\d)?\}/.test(t), 'Template must contain {SEQ} or {SEQ:n}'),
  resetPeriod: z.enum(RESET_PERIODS).default('FINANCIAL_YEAR'),
});
export type DocumentSeriesInput = z.infer<typeof documentSeriesSchema>;
