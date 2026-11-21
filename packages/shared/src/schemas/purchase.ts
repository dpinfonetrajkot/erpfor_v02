import { z } from 'zod';
import { CURRENCIES, UNITS } from '../constants';
import { GST_TYPES } from '../money';
import { id, optionalDate, optionalId, optionalText, text } from './common';

const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required');
const positive = (label = 'Quantity') => z.coerce.number({ error: 'Must be a number' }).positive(`${label} must be more than 0`);
const money = () => z.coerce.number({ error: 'Must be a number' }).min(0);

// ------------------------------------------------------------- requisitions

export const purchaseRequisitionSchema = z.object({
  prDate: date(),
  rawMaterialId: id(),
  quantity: positive(),
  requiredBy: optionalDate(),
  remarks: optionalText(500),
});
export type PurchaseRequisitionInput = z.infer<typeof purchaseRequisitionSchema>;

export const PR_STATUSES = ['PENDING', 'ORDERED', 'CANCELLED'] as const;
export type PrStatus = (typeof PR_STATUSES)[number];

// ---------------------------------------------------------- purchase orders

/** A material PO line has a raw material; a job-work PO line has the part (item) made by the vendor. */
export const purchaseOrderLineSchema = z
  .object({
    rawMaterialId: optionalId(),
    itemId: optionalId(),
    purchaseRequisitionId: optionalId(),
    description: optionalText(500),
    quantity: positive(),
    uom: z.enum(UNITS).default('KG'),
    rate: money(),
  })
  .refine((l) => !!l.rawMaterialId || !!l.itemId, { message: 'Required', path: ['rawMaterialId'] });
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;

export const DEFAULT_PO_PAYMENT_TERMS = 'Payment after 60 days';
export const DEFAULT_PO_TERMS =
  '1. Packing with transport included.\n2. Material must come with Mill Test Certificate (MTC / MTR).\n3. Heat number must be punched / marked on every bar.\n4. Please quote our PO number on your invoice and challan.';

export const DEFAULT_JOB_WORK_PO_TERMS =
  '1. Material is sent with our job work challan; return the finished parts within the time given (GST rules for job work).\n2. Keep our heat number on every part.\n3. Parts rejected at our QC are to be replaced or reworked free of cost.\n4. Please quote our PO number on your invoice.';

export const PO_TYPE_LABELS = { MATERIAL: 'Material', JOB_WORK: 'Job work' } as const;

export const purchaseOrderSchema = z.object({
  poDate: date(),
  companyId: id(),
  supplierId: id(),
  quotationRef: optionalText(100),
  deliveryAddress: optionalText(500),
  paymentTerms: optionalText(255),
  expectedDelivery: optionalDate(),
  currency: z.enum(CURRENCIES).default('INR'),
  gstType: z.enum(GST_TYPES).default('INTRA_STATE'),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(18),
  freight: money().default(0),
  terms: optionalText(3000),
  notes: optionalText(1000),
  lines: z.array(purchaseOrderLineSchema).min(1, 'Add at least one material'),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const PO_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_RECEIVED: 'Part received',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const reasonSchema = z.object({ reason: text(255) });
export type ReasonInput = z.infer<typeof reasonSchema>;

export const emailDocumentSchema = z.object({
  to: z.string().trim().min(1, 'Required').max(500),
  cc: optionalText(500),
  subject: text(200),
  message: optionalText(3000),
});
export type EmailDocumentInput = z.infer<typeof emailDocumentSchema>;

// ------------------------------------------------- gate entry & incoming QC

export const goodsReceiptSchema = z.object({
  grnDate: date(),
  supplierId: id(),
  purchaseOrderId: optionalId(),
  supplierChallan: optionalText(50),
  supplierInvoice: optionalText(50),
  vehicleNo: optionalText(20),
  remarks: optionalText(500),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: optionalId(),
        rawMaterialId: id(),
        millHeatNo: optionalText(100),
        receivedQty: positive('Received quantity'),
      }),
    )
    .min(1, 'Add at least one material'),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const QC_STATUSES = ['PENDING', 'ACCEPTED', 'PARTIAL', 'REJECTED'] as const;
export type QcStatus = (typeof QC_STATUSES)[number];

export const qcSchema = z.object({
  lines: z
    .array(
      z
        .object({
          lineId: id(),
          acceptedQty: z.coerce.number({ error: 'Must be a number' }).min(0),
          rejectedQty: z.coerce.number({ error: 'Must be a number' }).min(0),
          /** Leave empty to give the next heat number automatically. */
          heatNo: optionalText(50),
          millHeatNo: optionalText(100),
          qcRemarks: optionalText(500),
        })
        .refine((l) => l.rejectedQty === 0 || !!l.qcRemarks?.trim(), {
          path: ['qcRemarks'],
          message: 'Give the reason for rejection',
        }),
    )
    .min(1),
});
export type QcInput = z.infer<typeof qcSchema>;

// ------------------------------------------------------------------- stock

export const STOCK_LOCATIONS = ['RM_STORE', 'FG_STORE', 'WIP', 'JOB_WORK', 'REJECTION'] as const;
export type StockLocation = (typeof STOCK_LOCATIONS)[number];
export const STOCK_LOCATION_LABELS: Record<StockLocation, string> = {
  RM_STORE: 'RM store',
  FG_STORE: 'FG store',
  WIP: 'Work in progress',
  JOB_WORK: 'At job-work vendor',
  REJECTION: 'Rejection area',
};

export const STOCK_REF_TYPES = [
  'OPENING',
  'GRN',
  'MATERIAL_ISSUE',
  'ISSUE_RETURN',
  'RC_COMPLETION',
  'JOB_WORK_ISSUE',
  'JOB_WORK_RECEIPT',
  'ASSEMBLY',
  'DISPATCH',
  'ADJUSTMENT',
] as const;
export type StockRefType = (typeof STOCK_REF_TYPES)[number];
export const STOCK_REF_TYPE_LABELS: Record<StockRefType, string> = {
  OPENING: 'Opening stock',
  GRN: 'Gate entry',
  MATERIAL_ISSUE: 'Issued to route card',
  ISSUE_RETURN: 'Returned to store',
  RC_COMPLETION: 'Finished (route card)',
  JOB_WORK_ISSUE: 'Sent for job work',
  JOB_WORK_RECEIPT: 'Back from job work',
  ASSEMBLY: 'Packed',
  DISPATCH: 'Dispatched',
  ADJUSTMENT: 'Adjustment',
};

export const stockAdjustmentSchema = z
  .object({
    kind: z.enum(['RAW_MATERIAL', 'FINISHED_GOOD']),
    rawMaterialId: optionalId(),
    itemId: optionalId(),
    heatId: optionalId(),
    location: z.enum(STOCK_LOCATIONS),
    /** + adds stock, - removes stock */
    quantity: z.coerce.number({ error: 'Must be a number' }).refine((n) => n !== 0, 'Cannot be zero'),
    reason: text(500),
  })
  .refine((v) => (v.kind === 'RAW_MATERIAL' ? !!v.rawMaterialId : !!v.itemId), {
    path: ['rawMaterialId'],
    message: 'Choose what to adjust',
  })
  .refine((v) => v.kind !== 'RAW_MATERIAL' || !!v.heatId, {
    path: ['heatId'],
    message: 'Raw material stock is kept by heat - choose the heat',
  });
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
