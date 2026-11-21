import { z } from 'zod';
import { id, optionalNumber, optionalText } from './common';

const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required');
const optionalDate = () => z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')]).optional();
const positive = (label = 'Quantity') => z.coerce.number({ error: 'Must be a number' }).positive(`${label} must be more than 0`);
/** Whole pieces, 0 or more ("" from an empty input counts as not given). */
const optionalPieces = () =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number({ error: 'Must be a number' }).int('Whole pieces only').min(0).optional());

// ------------------------------------------------------------- route cards

export const RC_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'] as const;
export type RcStatus = (typeof RC_STATUSES)[number];
export const RC_STATUS_LABELS: Record<RcStatus, string> = {
  OPEN: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Done · to FG store',
  CLOSED: 'In FG stock',
  CANCELLED: 'Cancelled',
};

export const routeCardFieldsSchema = z.object({
  rcDate: date(),
  rawMaterialId: id(),
  /** Bar weight needed per piece (kg). */
  inputWeightKg: optionalNumber(0),
  extraQty: z.preprocess((v) => (v === '' || v === null ? 0 : v), z.coerce.number().int('Whole pieces only').min(0)),
  expectedDelivery: optionalDate(),
  remarks: optionalText(1000),
  /** Stages this part goes through; the order comes from the stage master. */
  stageIds: z.array(z.coerce.number().int().positive()).min(1, 'Tick at least one stage'),
});
export type RouteCardFieldsInput = z.infer<typeof routeCardFieldsSchema>;

export const routeCardSchema = routeCardFieldsSchema.extend({ productionRequestId: id() });
export type RouteCardInput = z.infer<typeof routeCardSchema>;

export const OPERATION_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/**
 * Recording one stage. Which fields count depends on the stage:
 *  - material check: result (OK / NOT_OK), reason when not OK
 *  - piece stage: OK + rejected pieces, reason when anything is rejected
 *  - weight stage: weight per piece (and loss per piece on the first weight stage)
 */
export const operationRecordSchema = z.object({
  result: z.enum(['OK', 'NOT_OK']).optional(),
  okQty: optionalPieces(),
  rejectedQty: optionalPieces(),
  reason: optionalText(500),
  outputWeightKg: optionalNumber(0),
  scrapWeightKg: optionalNumber(0),
  operatorName: optionalText(100),
  machine: optionalText(100),
  remarks: optionalText(500),
});
export type OperationRecordInput = z.infer<typeof operationRecordSchema>;

// ------------------------------------------------------------- material

export const MR_STATUSES = ['PENDING', 'PARTIAL', 'ISSUED', 'CANCELLED'] as const;
export type MrStatus = (typeof MR_STATUSES)[number];
export const MR_STATUS_LABELS: Record<MrStatus, string> = {
  PENDING: 'Waiting for store',
  PARTIAL: 'Part issued',
  ISSUED: 'Issued',
  CANCELLED: 'Cancelled',
};

/** Production asks the store for raw material for a route card. */
export const materialRequestSchema = z.object({
  quantity: positive(),
  remarks: optionalText(500),
});
export type MaterialRequestInput = z.infer<typeof materialRequestSchema>;

/** Store issues material against a request, heat by heat. */
export const materialIssueSchema = z.object({
  issueDate: date(),
  remarks: optionalText(500),
  lines: z
    .array(z.object({ heatId: id(), quantity: positive() }))
    .min(1, 'Enter a quantity for at least one heat'),
});
export type MaterialIssueInput = z.infer<typeof materialIssueSchema>;

/** Unused material back to the store. */
export const materialReturnSchema = z.object({
  heatId: id(),
  quantity: positive(),
  remarks: optionalText(500),
});
export type MaterialReturnInput = z.infer<typeof materialReturnSchema>;

/** Store cannot fill a request: ask purchase for the shortage. */
export const mrPurchaseSchema = z.object({
  quantity: positive(),
  requiredBy: optionalDate(),
});
export type MrPurchaseInput = z.infer<typeof mrPurchaseSchema>;

// ------------------------------------------------------------- completion

export const COMPLETION_STATUSES = ['PENDING', 'MOVED_TO_STOCK'] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

/** Final OK pieces into the FG store, split over the heats they were made from. */
export const completionMoveSchema = z.object({
  heats: z
    .array(z.object({ heatId: id(), quantity: z.coerce.number().int('Whole pieces only').min(0) }))
    .min(1, 'Enter the heat'),
});
export type CompletionMoveInput = z.infer<typeof completionMoveSchema>;
