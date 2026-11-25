import { z } from 'zod';

/**
 * Import from Excel: ready templates for masters and opening stock. A file is first checked row by row
 * (nothing saved) and then imported in one go; rows with problems are left out.
 */

export const IMPORT_TYPES = ['customers', 'suppliers', 'products', 'raw_materials', 'rm_stock', 'fg_stock'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export interface ImportTypeInfo {
  label: string;
  /** One row of the file is one … */
  rowNoun: string;
  description: string;
  /** All of these are needed to import. */
  permissions: string[];
  /** Needed to update records that are already in the ERP (masters only). */
  updatePermission?: string;
  /** Where the imported records are seen. */
  href: string;
}

export const IMPORT_TYPE_INFO: Record<ImportType, ImportTypeInfo> = {
  customers: {
    label: 'Customers',
    rowNoun: 'customer',
    description: 'Name, GSTIN, address, state, currency and payment terms.',
    permissions: ['customers.create'],
    updatePermission: 'customers.update',
    href: '/masters/customers',
  },
  suppliers: {
    label: 'Suppliers & vendors',
    rowNoun: 'supplier',
    description: 'Material suppliers, job-work vendors and service providers, with bank details.',
    permissions: ['suppliers.create'],
    updatePermission: 'suppliers.update',
    href: '/masters/suppliers',
  },
  products: {
    label: 'Products & BOM',
    rowNoun: 'product',
    description: 'Products with category, the parts that make one set, and HSN. Can make the stock items too.',
    permissions: ['products.create'],
    updatePermission: 'products.update',
    href: '/masters/products',
  },
  raw_materials: {
    label: 'Raw materials',
    rowNoun: 'raw material',
    description: 'Grade, shape, size and reorder level.',
    permissions: ['raw_materials.create'],
    updatePermission: 'raw_materials.update',
    href: '/masters/raw-materials',
  },
  rm_stock: {
    label: 'Opening stock: raw material',
    rowNoun: 'heat',
    description: 'Kg in the RM store on the day you start, heat by heat.',
    permissions: ['stock.create', 'heats.create'],
    href: '/store/stock',
  },
  fg_stock: {
    label: 'Opening stock: finished parts',
    rowNoun: 'stock line',
    description: 'Pieces of each item in the FG store on the day you start.',
    permissions: ['stock.create'],
    href: '/store/stock?tab=fg',
  },
};

/** What to do with a row that is already in the ERP (masters only; stock rows are always new). */
export const IMPORT_MODES = ['skip', 'update'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_MB = 5;

export const importQuerySchema = z.object({ mode: z.enum(IMPORT_MODES).default('skip') });
export type ImportQuery = z.infer<typeof importQuerySchema>;

/** new = will be added; update = in the ERP, will be changed; same = in the ERP, nothing to change; skip = in the ERP, left as it is. */
export type ImportRowStatus = 'new' | 'update' | 'same' | 'skip' | 'error';

export interface ImportRow {
  /** Row number in Excel. */
  row: number;
  /** What the row is, e.g. "CUS-0004 · ALPHA OILFIELD". */
  label: string;
  status: ImportRowStatus;
  /** Why the row cannot be imported (status error), or what will happen. */
  notes: string[];
  /** Imported anyway, but worth a look. */
  warnings: string[];
}

export interface ImportCheck {
  type: ImportType;
  fileName: string;
  sheet: string;
  rows: ImportRow[];
  counts: Record<ImportRowStatus, number>;
  /** Rows with a warning. */
  warned: number;
  columns: { used: string[]; missing: string[]; ignored: string[] };
  /** Things made on the way, e.g. "New category: HAMMER UNION". */
  willCreate: string[];
  /** The same file was imported before. */
  importedBefore: { at: string; by: string | null; summary: string | null } | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  summary: string;
}
