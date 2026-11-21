import { z } from 'zod';
import { CURRENCIES, END_CONNECTIONS, SERVICE_TYPES } from '../constants';
import { id, optionalDate, optionalId, optionalText } from './common';

const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required');
const positive = (label = 'Quantity') => z.coerce.number({ error: 'Must be a number' }).positive(`${label} must be more than 0`);

// ------------------------------------------------------------- sales orders

export const salesOrderLineSchema = z.object({
  productId: id(),
  endConnection: z.enum(END_CONNECTIONS).default('NONE'),
  service: z.enum(SERVICE_TYPES).default('STD'),
  schedule: optionalText(30),
  materialGradeId: optionalId(),
  quantity: positive(),
  rate: z.coerce.number({ error: 'Must be a number' }).min(0).default(0),
  remarks: optionalText(500),
});
export type SalesOrderLineInput = z.infer<typeof salesOrderLineSchema>;

export const salesOrderSchema = z.object({
  soDate: date(),
  customerId: id(),
  customerPoNo: optionalText(100),
  customerPoDate: optionalDate(),
  currency: z.enum(CURRENCIES).default('INR'),
  exchangeRate: z.coerce.number().positive().default(1),
  expectedDelivery: optionalDate(),
  salesPersonId: optionalId(),
  additionalRequirement: optionalText(3000),
  notes: optionalText(3000),
  lines: z.array(salesOrderLineSchema).min(1, 'Add at least one product'),
});
export type SalesOrderInput = z.infer<typeof salesOrderSchema>;

export const SO_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'IN_PRODUCTION',
  'PARTIALLY_DISPATCHED',
  'DISPATCHED',
  'CLOSED',
  'CANCELLED',
] as const;
export type SoStatus = (typeof SO_STATUSES)[number];
export const SO_STATUS_LABELS: Record<SoStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting approval',
  APPROVED: 'Approved',
  IN_PRODUCTION: 'In production',
  PARTIALLY_DISPATCHED: 'Part dispatched',
  DISPATCHED: 'Dispatched',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/** Feasibility first; design and production approval both need feasibility. */
export const APPROVAL_STAGES = ['FEASIBILITY', 'DESIGN', 'PRODUCTION'] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];
export const APPROVAL_STAGE_LABELS: Record<ApprovalStage, string> = {
  FEASIBILITY: 'Feasibility',
  DESIGN: 'Design',
  PRODUCTION: 'Production',
};
/** Permission needed to decide each stage. */
export const APPROVAL_STAGE_PERMISSION: Record<ApprovalStage, string> = {
  FEASIBILITY: 'so_feasibility.approve',
  DESIGN: 'so_design.approve',
  PRODUCTION: 'so_production.approve',
};

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ProductionDecision = 'PENDING' | 'INHOUSE' | 'OUTSOURCE' | 'FROM_STOCK';

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    remarks: optionalText(500),
    /** Feasibility only: in-house production or outsource (job work) for every line. */
    lineDecisions: z
      .array(z.object({ lineId: id(), decision: z.enum(['INHOUSE', 'OUTSOURCE']) }))
      .optional(),
  })
  .refine((v) => v.decision === 'APPROVED' || !!v.remarks?.trim(), {
    path: ['remarks'],
    message: 'Give the reason for rejection',
  });
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

// ------------------------------------------------------ production requests

export const PRODUCTION_REQUEST_STATUSES = ['REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const;
export type ProductionRequestStatus = (typeof PRODUCTION_REQUEST_STATUSES)[number];

/** From the stock check of a sales order: make the shortage. */
export const soProductionRequestSchema = z.object({
  requiredBy: optionalDate(),
  remarks: optionalText(500),
  lines: z
    .array(z.object({ salesOrderLineId: id(), itemId: id(), quantity: positive() }))
    .min(1, 'Enter a quantity for at least one part'),
});
export type SoProductionRequestInput = z.infer<typeof soProductionRequestSchema>;

/** Make-to-stock: parts for the FG store without a customer order. */
export const mtsRequestSchema = z.object({
  itemId: id(),
  quantity: positive(),
  requiredBy: optionalDate(),
  remarks: optionalText(500),
});
export type MtsRequestInput = z.infer<typeof mtsRequestSchema>;
