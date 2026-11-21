import { z } from 'zod';
import { id, optionalDate, optionalId, optionalText } from './common';

const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required');
const pieces = (label = 'Quantity') =>
  z.coerce.number({ error: 'Must be a number' }).int('Whole pieces only').positive(`${label} must be more than 0`);
const count = () =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? 0 : v), z.coerce.number({ error: 'Must be a number' }).int('Whole pieces only').min(0));

export const JWO_STATUSES = ['OPEN', 'MATERIAL_ISSUED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'] as const;
export type JwoStatus = (typeof JWO_STATUSES)[number];
export const JWO_STATUS_LABELS: Record<JwoStatus, string> = {
  OPEN: 'Open',
  MATERIAL_ISSUED: 'Material sent',
  PARTIALLY_RECEIVED: 'Part received',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const jobWorkLineSchema = z.object({
  itemId: id(),
  /** The outsourced sales order line this is for (empty = for stock). */
  salesOrderLineId: optionalId(),
  quantity: pieces(),
  /** Job work charge per piece. */
  rate: z.coerce.number({ error: 'Must be a number' }).min(0).default(0),
  remarks: optionalText(500),
});
export type JobWorkLineInput = z.infer<typeof jobWorkLineSchema>;

/** Raw material we send to the vendor. */
export const jobWorkMaterialSchema = z.object({
  rawMaterialId: id(),
  quantity: z.coerce.number({ error: 'Must be a number' }).positive('Quantity must be more than 0'),
});

export const jobWorkOrderSchema = z.object({
  jwoDate: date(),
  supplierId: id(),
  salesOrderId: optionalId(),
  challanNo: optionalText(50),
  expectedDate: optionalDate(),
  remarks: optionalText(1000),
  lines: z.array(jobWorkLineSchema).min(1, 'Add at least one part'),
  materials: z.array(jobWorkMaterialSchema).default([]),
});
export type JobWorkOrderInput = z.infer<typeof jobWorkOrderSchema>;

/** Parts back from the vendor, inspected by our QC. Accepted pieces go to the FG store. */
export const jobWorkReceiptSchema = z.object({
  receiptDate: date(),
  vendorChallan: optionalText(50),
  inspectorName: optionalText(100),
  remarks: optionalText(500),
  lines: z
    .array(
      z.object({
        jobWorkOrderLineId: id(),
        receivedQty: count(),
        acceptedQty: count(),
        heatId: optionalId(),
        /** Rejection reason / QC note. */
        remarks: optionalText(500),
      }),
    )
    .min(1, 'Enter what came back'),
});
export type JobWorkReceiptInput = z.infer<typeof jobWorkReceiptSchema>;
