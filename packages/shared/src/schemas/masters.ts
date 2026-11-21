import { z } from 'zod';
import {
  CURRENCIES,
  END_CONNECTIONS,
  HEAT_STATUSES,
  MATERIAL_SHAPES,
  STAGE_TYPES,
  SUPPLIER_TYPES,
  TOOL_STATUSES,
  TOOL_TYPES,
  UNITS,
} from '../constants';
import {
  id,
  number,
  optionalDate,
  optionalEmail,
  optionalGstin,
  optionalId,
  optionalNumber,
  optionalPan,
  optionalPhone,
  optionalText,
  text,
} from './common';

/** Shared by customers and suppliers. Leave `code` empty to auto-generate. */
const partyBase = {
  code: optionalText(30),
  name: text(200),
  contactPerson: optionalText(100),
  phone: optionalPhone(),
  email: optionalEmail(),
  gstin: optionalGstin(),
  pan: optionalPan(),
  address: optionalText(500),
  city: optionalText(100),
  stateCode: optionalText(2),
  pincode: optionalText(10),
  country: text(60).default('India'),
  paymentTermsDays: optionalNumber(0),
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
};

export const customerSchema = z.object({
  ...partyBase,
  shippingAddress: optionalText(500),
  currency: z.enum(CURRENCIES).default('INR'),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const supplierSchema = z.object({
  ...partyBase,
  type: z.enum(SUPPLIER_TYPES).default('MATERIAL'),
  bankName: optionalText(100),
  bankAccountNo: optionalText(30),
  bankIfsc: optionalText(15),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const productCategorySchema = z.object({
  name: text(100),
  description: optionalText(255),
});
export type ProductCategoryInput = z.infer<typeof productCategorySchema>;

export const partTypeSchema = z.object({
  name: text(50),
  /** MALE / FEMALE have BW or THD ends; a NUT does not. */
  hasEndConnection: z.boolean().default(true),
  sortOrder: number(0).default(0),
});
export type PartTypeInput = z.infer<typeof partTypeSchema>;

export const productSchema = z.object({
  code: optionalText(30),
  name: text(150),
  categoryId: id(),
  size: optionalText(30),
  figure: optionalText(50),
  pressureRating: optionalText(50),
  hsnCode: optionalText(10),
  description: optionalText(1000),
  isActive: z.boolean().default(true),
  /** Bill of materials: the parts that make one assembled set. */
  components: z
    .array(z.object({ partTypeId: id(), quantity: number(1).default(1) }))
    .min(1, 'Add at least one part'),
});
export type ProductInput = z.infer<typeof productSchema>;

export const itemSchema = z.object({
  code: optionalText(30),
  productId: id(),
  partTypeId: id(),
  endConnection: z.enum(END_CONNECTIONS).default('NONE'),
  materialGradeId: optionalId(),
  rawMaterialId: optionalId(),
  drawingNo: optionalText(50),
  finishedWeightKg: optionalNumber(0),
  inputWeightKg: optionalNumber(0),
  uom: z.enum(UNITS).default('PCS'),
  minPrice: optionalNumber(0),
  hsnCode: optionalText(10),
  description: optionalText(500),
  isActive: z.boolean().default(true),
});
export type ItemInput = z.infer<typeof itemSchema>;

export const materialGradeSchema = z.object({
  name: text(50),
  heatCode: z
    .union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z]{1,5}$/, '1-5 letters')])
    .optional(),
  standard: optionalText(100),
  description: optionalText(255),
  isActive: z.boolean().default(true),
});
export type MaterialGradeInput = z.infer<typeof materialGradeSchema>;

export const rawMaterialSchema = z.object({
  code: optionalText(30),
  gradeId: id(),
  shape: z.enum(MATERIAL_SHAPES).default('ROUND'),
  size: text(100),
  sizeMm: optionalNumber(0),
  densityKgM3: optionalNumber(0),
  uom: z.enum(UNITS).default('KG'),
  reorderLevel: optionalNumber(0),
  isActive: z.boolean().default(true),
});
export type RawMaterialInput = z.infer<typeof rawMaterialSchema>;

export const heatSchema = z.object({
  /** Internal heat number. Leave empty to auto-generate. */
  heatNo: optionalText(50),
  millHeatNo: optionalText(100),
  rawMaterialId: id(),
  supplierId: optionalId(),
  receivedDate: optionalDate(),
  status: z.enum(HEAT_STATUSES).default('ACTIVE'),
  remarks: optionalText(500),
  /** Only on create: puts this quantity (kg) into RM store as opening stock. */
  openingQty: optionalNumber(0),
});
export type HeatInput = z.infer<typeof heatSchema>;

export const processStageSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Lowercase letters, numbers and _ only'),
  name: text(100),
  sequence: number(1),
  type: z.enum(STAGE_TYPES).default('OPERATION'),
  captureWeights: z.boolean().default(false),
  requiresReport: z.boolean().default(false),
  isMaterialCheck: z.boolean().default(false),
  description: optionalText(255),
  isActive: z.boolean().default(true),
  /** Roles allowed to record this stage on a route card. */
  roleIds: z.array(z.coerce.number().int().positive()).default([]),
});
export type ProcessStageInput = z.infer<typeof processStageSchema>;

export const toolSchema = z.object({
  code: optionalText(30),
  name: text(200),
  type: z.enum(TOOL_TYPES).default('DIE'),
  itemId: optionalId(),
  location: optionalText(100),
  purchaseDate: optionalDate(),
  lifeShots: optionalNumber(0),
  status: z.enum(TOOL_STATUSES).default('ACTIVE'),
  description: optionalText(500),
});
export type ToolInput = z.infer<typeof toolSchema>;
