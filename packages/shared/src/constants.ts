/**
 * Enum values shared by the API (Prisma enums use the same values)
 * and the web app (dropdowns, badges).
 */

export const END_CONNECTIONS = ['BW', 'THD', 'NONE'] as const;
export type EndConnection = (typeof END_CONNECTIONS)[number];
export const END_CONNECTION_LABELS: Record<EndConnection, string> = {
  BW: 'Butt Weld (BW)',
  THD: 'Threaded (THD)',
  NONE: 'Not applicable',
};

export const SERVICE_TYPES = ['STD', 'SOUR'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SUPPLIER_TYPES = ['MATERIAL', 'JOB_WORK', 'SERVICE', 'OTHER'] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];
export const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  MATERIAL: 'Raw material supplier',
  JOB_WORK: 'Job work vendor',
  SERVICE: 'Service provider',
  OTHER: 'Other',
};

export const STAGE_TYPES = ['TEST', 'INSPECTION', 'OPERATION'] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export const MATERIAL_SHAPES = ['ROUND', 'SQUARE', 'HEX', 'FLAT', 'PLATE', 'PIPE', 'OTHER'] as const;
export type MaterialShape = (typeof MATERIAL_SHAPES)[number];

export const HEAT_STATUSES = ['ACTIVE', 'BLOCKED', 'CONSUMED'] as const;
export type HeatStatus = (typeof HEAT_STATUSES)[number];

export const TOOL_TYPES = ['DIE', 'TOOL', 'FIXTURE', 'GAUGE'] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const TOOL_STATUSES = ['ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'SCRAPPED'] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const UNITS = ['PCS', 'SET', 'KG', 'MTR', 'NOS'] as const;
export type Unit = (typeof UNITS)[number];

/** Document number series used across the ERP. */
export const DOCUMENT_SERIES = {
  CUSTOMER: 'Customer code',
  SUPPLIER: 'Supplier code',
  PRODUCT: 'Product code',
  ITEM: 'Item code',
  RAW_MATERIAL: 'Raw material code',
  HEAT: 'Heat number',
  TOOL: 'Tool / die code',
  SALES_ORDER: 'Sales order',
  PRODUCTION_REQUEST: 'Production request',
  PURCHASE_REQUISITION: 'Purchase requisition',
  PURCHASE_ORDER: 'Purchase order',
  GOODS_RECEIPT: 'Gate entry / GRN',
  ROUTE_CARD: 'Route card',
  MATERIAL_REQUISITION: 'Material requisition',
  RC_COMPLETION: 'RC completion slip',
  JOB_WORK_ORDER: 'Job work order',
  JOB_WORK_RECEIPT: 'Job work receipt',
  ASSEMBLY: 'Assembly / packing',
  INVOICE: 'Tax invoice',
  EXPORT_INVOICE: 'Export invoice',
  DISPATCH: 'Dispatch / challan',
  PAYMENT: 'Payment voucher',
} as const;
export type DocumentSeriesCode = keyof typeof DOCUMENT_SERIES;

/** GST state codes (used for place of supply and IGST vs CGST+SGST). */
export const INDIAN_STATES = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
] as const;

/** Labels for enum-like values: "UNDER_MAINTENANCE" -> "Under maintenance". */
export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
