import { z } from 'zod';
import { GST_TYPES } from '../money';
import { CURRENCIES, UNITS } from '../constants';
import { id, optionalDate, optionalGstin, optionalId, optionalNumber, optionalText, text } from './common';

const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required');
const sets = (label = 'Sets') => z.coerce.number({ error: 'Must be a number' }).int('Whole numbers only').positive(`${label} must be more than 0`);
const money = () => z.coerce.number({ error: 'Must be a number' }).min(0);
const optionalInt = () => z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(0).optional());

// ------------------------------------------------------------- assembly & packing

export const ASSEMBLY_STATUSES = ['PACKED', 'INVOICED', 'DISPATCHED', 'CANCELLED'] as const;
export type AssemblyStatus = (typeof ASSEMBLY_STATUSES)[number];
export const ASSEMBLY_STATUS_LABELS: Record<AssemblyStatus, string> = {
  PACKED: 'Packed',
  INVOICED: 'Invoiced',
  DISPATCHED: 'Dispatched',
  CANCELLED: 'Cancelled',
};
export const PACKING_TYPES = ['Wooden box', 'Carton box', 'Pallet', 'Loose'] as const;

/**
 * Sets of a sales order assembled from finished parts and packed.
 * For every part of every set the heats it is taken from (parts without heat: heatId empty).
 */
export const assemblySchema = z.object({
  salesOrderId: id(),
  assemblyDate: date(),
  packingType: optionalText(50),
  packedBy: optionalText(100),
  packages: optionalInt(),
  grossWeightKg: optionalNumber(0),
  remarks: optionalText(500),
  lines: z
    .array(
      z.object({
        salesOrderLineId: id(),
        quantity: sets(),
        parts: z.array(
          z.object({
            itemId: id(),
            heats: z.array(z.object({ heatId: optionalId(), quantity: sets('Pieces') })).min(1, 'Choose the heats'),
          }),
        ),
      }),
    )
    .min(1, 'Enter the sets to pack'),
});
export type AssemblyInput = z.infer<typeof assemblySchema>;

// ------------------------------------------------------------- invoices

export const INVOICE_TYPES = ['TAX_INVOICE', 'EXPORT_INVOICE', 'PROFORMA'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  TAX_INVOICE: 'Tax invoice',
  EXPORT_INVOICE: 'Export invoice',
  PROFORMA: 'Proforma',
};
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = { DRAFT: 'Draft', ISSUED: 'Issued', CANCELLED: 'Cancelled' };

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { UNPAID: 'Unpaid', PARTIAL: 'Part paid', PAID: 'Paid' };

export const DEFAULT_INVOICE_TERMS =
  '1. Interest @ 18% p.a. will be charged if payment is not made within the due date.\n2. Our responsibility ceases once the goods leave our premises.\n3. Subject to the jurisdiction of the courts at our registered office.';
export const EXPORT_LUT_NOTE = 'Supply meant for export under LUT without payment of IGST.';

/**
 * One invoice line. On an invoice made from a packing the quantity and unit come from the packed sets
 * (the server keeps them); on a direct invoice every field is typed in.
 */
const invoiceLineSchema = z.object({
  id: optionalId(),
  description: text(500),
  hsnCode: optionalText(10),
  quantity: z.coerce.number({ error: 'Must be a number' }).positive('More than 0'),
  uom: z.enum(UNITS).default('NOS'),
  rate: money(),
});

/** A draft invoice (quantities come from the packed sets; prices and party details can be corrected). */
export const invoiceSchema = z.object({
  companyId: id(),
  invoiceDate: date(),
  dueDate: optionalDate(),
  customerPoNo: optionalText(100),
  customerPoDate: optionalDate(),
  billingName: text(200),
  billingAddress: optionalText(500),
  billingGstin: optionalGstin(),
  shippingName: optionalText(200),
  shippingAddress: optionalText(500),
  shippingGstin: optionalGstin(),
  placeOfSupply: optionalText(2),
  gstType: z.enum(GST_TYPES),
  taxRate: z.coerce.number().min(0).max(100).default(18),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  freight: money().default(0),
  transporter: optionalText(100),
  vehicleNo: optionalText(20),
  terms: optionalText(3000),
  notes: optionalText(1000),
  lines: z.array(invoiceLineSchema).min(1, 'An invoice needs at least one line'),
});
export type InvoiceInput = z.infer<typeof invoiceSchema>;

/**
 * A direct invoice, typed in without a sales order or packing (services, scrap, job work charges, samples...).
 * It does not change stock.
 */
export const directInvoiceSchema = invoiceSchema.extend({
  customerId: id(),
  currency: z.enum(CURRENCIES).default('INR'),
  exchangeRate: z.coerce.number({ error: 'Must be a number' }).positive('More than 0').default(1),
});
export type DirectInvoiceInput = z.infer<typeof directInvoiceSchema>;

/** Unit names on invoice lines. */
export const INVOICE_UNIT_LABELS: Record<(typeof UNITS)[number], string> = { NOS: 'Nos', PCS: 'Pcs', SET: 'Sets', KG: 'Kg', MTR: 'Mtr' };

// ------------------------------------------------------------- dispatch

/** Transport details of a dispatch (quantities come from the invoice). */
export const dispatchSchema = z.object({
  dispatchDate: date(),
  challanNo: optionalText(50),
  transporter: optionalText(100),
  lrNo: optionalText(50),
  vehicleNo: optionalText(20),
  driverName: optionalText(100),
  driverPhone: optionalText(20),
  loadedBy: optionalText(100),
  packages: optionalInt(),
  grossWeightKg: optionalNumber(0),
  remarks: optionalText(500),
});
export type DispatchInput = z.infer<typeof dispatchSchema>;

// ------------------------------------------------------------- payments

export const PAYMENT_MODES = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  BANK_TRANSFER: 'Bank transfer (NEFT / RTGS)',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  OTHER: 'Other',
};

/** Money in from a customer (against an invoice) or out to a supplier (against a PO). */
export const paymentSchema = z
  .object({
    direction: z.enum(['RECEIPT', 'PAYMENT']),
    paymentDate: date(),
    invoiceId: optionalId(),
    purchaseOrderId: optionalId(),
    amount: z.coerce.number({ error: 'Must be a number' }).positive('Amount must be more than 0'),
    mode: z.enum(PAYMENT_MODES).default('BANK_TRANSFER'),
    reference: optionalText(100),
    remarks: optionalText(500),
  })
  .refine((p) => (p.direction === 'RECEIPT' ? !!p.invoiceId : !!p.purchaseOrderId), {
    message: 'Choose the invoice / purchase order',
    path: ['invoiceId'],
  });
export type PaymentInput = z.infer<typeof paymentSchema>;
