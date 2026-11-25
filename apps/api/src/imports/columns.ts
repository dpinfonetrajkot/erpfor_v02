import {
  CURRENCIES,
  GSTIN_REGEX,
  INDIAN_STATES,
  MATERIAL_SHAPES,
  SUPPLIER_TYPE_LABELS,
  SUPPLIER_TYPES,
  UNITS,
  type ImportType,
  type SupplierType,
} from '@bht/shared';
import { excelDate, type Cell } from './xlsx';

/** One column of an import template. */
export interface ImportColumn {
  key: string;
  header: string;
  required?: boolean;
  /** Other headings that mean the same (from Tally, Busy or a home-made sheet). */
  aliases?: string[];
  width?: number;
  /** How Excel should keep what is typed: as text (keeps leading zeros), as a date, or as Excel decides. */
  format?: 'text' | 'date';
  /** Drop-down list in the template; strict = only these values. */
  list?: readonly string[];
  strict?: boolean;
  help: string;
  example: string;
}

/** Names already in the ERP, offered as drop-down lists in the templates. */
export interface TemplateLists {
  categories: string[];
  grades: string[];
  partTypes: string[];
}

const YES_NO = ['Yes', 'No'] as const;
export const STATE_NAMES = INDIAN_STATES.map((s) => s.name);
export const SUPPLIER_TYPE_CHOICES = SUPPLIER_TYPES.map((t) => SUPPLIER_TYPE_LABELS[t]);
export const ITEM_END_CHOICES = ['BW, THD', 'BW', 'THD', 'None'] as const;
export const END_CHOICES = ['BW', 'THD', 'None'] as const;

const code = (prefix: string): ImportColumn => ({
  key: 'code',
  header: 'Code',
  aliases: ['code no', 'short code'],
  width: 13,
  format: 'text',
  help: `Leave empty to number it automatically (${prefix}0001, ${prefix}0002 …). Fill it to keep your own codes. A row whose code is already in the ERP is the same record.`,
  example: '',
});

const active: ImportColumn = {
  key: 'isActive',
  header: 'Active',
  aliases: ['status', 'is active'],
  width: 9,
  list: YES_NO,
  strict: true,
  help: 'Yes or No. Empty = Yes. "No" hides it from drop-downs but keeps it for history.',
  example: 'Yes',
};

function partyColumns(kind: 'customer' | 'supplier'): ImportColumn[] {
  const isCustomer = kind === 'customer';
  return [
    code(isCustomer ? 'CUS-' : 'SUP-'),
    {
      key: 'name',
      header: 'Name',
      required: true,
      aliases: [`${kind} name`, 'party name', 'company name', 'ledger name', 'name of party', isCustomer ? 'customer' : 'vendor name', isCustomer ? 'buyer name' : 'supplier'],
      width: 36,
      help: `Full name of the ${kind}. A row with the same name as one already in the ERP (and no code) is the same ${kind}.`,
      example: isCustomer ? 'ALPHA OILFIELD SERVICES PVT. LTD.' : 'SHREE STEEL TRADERS',
    },
    ...(isCustomer
      ? []
      : [
          {
            key: 'type',
            header: 'Type',
            aliases: ['supplier type', 'vendor type', 'category'],
            width: 22,
            list: SUPPLIER_TYPE_CHOICES,
            strict: true,
            help: `${SUPPLIER_TYPE_CHOICES.join(', ')}. Empty = ${SUPPLIER_TYPE_LABELS.MATERIAL}.`,
            example: SUPPLIER_TYPE_LABELS.MATERIAL,
          } satisfies ImportColumn,
        ]),
    { key: 'contactPerson', header: 'Contact person', aliases: ['contact', 'contact name', 'person'], width: 20, help: 'Optional.', example: 'Mr. R. Patel' },
    {
      key: 'phone',
      header: 'Phone',
      aliases: ['mobile', 'mobile no', 'phone no', 'contact no', 'telephone', 'tel', 'mobile number', 'phone number', 'contact number'],
      width: 16,
      format: 'text',
      help: 'Digits, spaces, + - ( ). If the cell has two numbers, the first is kept.',
      example: '+91 98250 12345',
    },
    { key: 'email', header: 'Email', aliases: ['email id', 'e-mail', 'mail', 'email address', 'e mail'], width: 26, help: 'One e-mail address. If there are more, the first is kept.', example: 'purchase@alpha.com' },
    {
      key: 'gstin',
      header: 'GSTIN',
      aliases: ['gst no', 'gst number', 'gstin/uin', 'gstin no', 'gst', 'gst in', 'gstin number', 'gst reg no'],
      width: 18,
      format: 'text',
      help: '15 characters. When State is empty, the state is taken from the GSTIN.',
      example: '24AAACA1234F1Z5',
    },
    { key: 'pan', header: 'PAN', aliases: ['pan no', 'pan number', 'it pan'], width: 12, format: 'text', help: '10 characters. When empty, it is taken from the GSTIN.', example: '' },
    { key: 'address', header: isCustomer ? 'Billing address' : 'Address', aliases: ['address', 'billing address', 'address 1', 'full address', 'office address'], width: 40, help: 'Street, area. City, state and PIN have their own columns.', example: 'Plot 12, GIDC Estate, Phase 2' },
    ...(isCustomer
      ? [{ key: 'shippingAddress', header: 'Shipping address', aliases: ['delivery address', 'ship to', 'shipping', 'consignee address'], width: 40, help: 'Only if goods go to another address.', example: '' } satisfies ImportColumn]
      : []),
    { key: 'city', header: 'City', aliases: ['town', 'place', 'district'], width: 16, help: 'Optional.', example: 'Rajkot' },
    {
      key: 'state',
      header: 'State',
      aliases: ['state name', 'state code', 'gst state', 'province'],
      width: 22,
      list: STATE_NAMES,
      help: `State name (Gujarat) or GST state code (24). Empty = taken from the GSTIN. Leave it empty for ${kind}s outside India.`,
      example: 'Gujarat',
    },
    { key: 'pincode', header: 'PIN code', aliases: ['pin', 'pincode', 'pin no', 'zip', 'zip code', 'postal code', 'post code'], width: 10, format: 'text', help: 'Optional.', example: '360003' },
    { key: 'country', header: 'Country', aliases: [], width: 14, help: 'Empty = India.', example: 'India' },
    ...(isCustomer
      ? [{ key: 'currency', header: 'Currency', aliases: ['curr', 'billing currency'], width: 10, list: CURRENCIES, strict: true, help: `${CURRENCIES.join(', ')}. Empty = INR.`, example: 'INR' } satisfies ImportColumn]
      : []),
    {
      key: 'paymentTermsDays',
      header: 'Payment terms (days)',
      aliases: ['payment terms', 'credit days', 'credit period', 'credit period days', 'payment days', 'terms days'],
      width: 12,
      help: 'Number of days, e.g. 30. Optional.',
      example: '30',
    },
    ...(isCustomer
      ? []
      : ([
          { key: 'bankName', header: 'Bank name', aliases: ['bank'], width: 20, help: 'For paying this supplier. Optional.', example: 'State Bank of India' },
          { key: 'bankAccountNo', header: 'Bank account no', aliases: ['account no', 'account number', 'a/c no', 'ac no', 'bank account', 'bank account number'], width: 20, format: 'text', help: 'Kept as text, so long numbers stay exact.', example: '30123456789' },
          { key: 'bankIfsc', header: 'IFSC', aliases: ['ifsc code', 'bank ifsc', 'ifsc no'], width: 13, format: 'text', help: '11 characters.', example: 'SBIN0001234' },
        ] satisfies ImportColumn[])),
    { key: 'notes', header: 'Notes', aliases: ['remarks', 'remark', 'note', 'comments'], width: 28, help: 'Optional.', example: '' },
    active,
  ];
}

export function importColumns(type: ImportType, lists: TemplateLists): ImportColumn[] {
  switch (type) {
    case 'customers':
      return partyColumns('customer');
    case 'suppliers':
      return partyColumns('supplier');
    case 'products':
      return [
        code('PRD-'),
        { key: 'name', header: 'Product name', required: true, aliases: ['name', 'product', 'product description', 'item name'], width: 34, help: 'Must be unique. A row with the same name as a product in the ERP (and no code) is the same product.', example: '2" FIG 100 HAMMER UNION' },
        {
          key: 'category',
          header: 'Category',
          required: true,
          aliases: ['product category', 'group', 'product group', 'category name'],
          width: 20,
          list: lists.categories,
          help: `A new category is made if it is not in the ERP yet.${lists.categories.length ? ` In the ERP now: ${lists.categories.join(', ')}.` : ''}`,
          example: lists.categories[0] ?? 'HAMMER UNION',
        },
        { key: 'size', header: 'Size', aliases: ['product size'], width: 10, format: 'text', help: 'Optional, e.g. 2".', example: '2"' },
        { key: 'figure', header: 'Figure', aliases: ['fig', 'fig no', 'figure no'], width: 10, format: 'text', help: 'Optional, e.g. FIG 100.', example: 'FIG 100' },
        { key: 'pressureRating', header: 'Pressure rating', aliases: ['pressure', 'rating', 'working pressure'], width: 14, help: 'Optional.', example: '1000 PSI' },
        { key: 'hsnCode', header: 'HSN code', aliases: ['hsn', 'hsn/sac', 'hsn no', 'hsn sac'], width: 11, format: 'text', help: 'Used on invoices and copied to the items.', example: '84818090' },
        {
          key: 'parts',
          header: 'Parts (BOM)',
          required: true,
          aliases: ['parts', 'bom', 'components', 'bill of materials', 'part types'],
          width: 28,
          help: `Parts that make one set, with commas. Add "x 2" when a set needs two: MALE, FEMALE, NUT x 2.${lists.partTypes.length ? ` Parts in the ERP now: ${lists.partTypes.join(', ')}.` : ''} New part types are added in Products → Part types first.`,
          example: lists.partTypes.slice(0, 3).join(', ') || 'MALE, FEMALE, NUT',
        },
        {
          key: 'itemEnds',
          header: 'Make items for',
          aliases: ['items', 'item ends', 'ends', 'end connections', 'make items'],
          width: 15,
          list: ITEM_END_CHOICES,
          help: 'Makes the stock items (one per part) now: "BW, THD" = a BW and a THD item for parts with an end, "BW" or "THD" = one of them, "None" = items without an end. Empty = no items now (make them later on the product).',
          example: 'BW, THD',
        },
        { key: 'description', header: 'Description', aliases: ['details', 'remarks', 'notes'], width: 28, help: 'Optional.', example: '' },
        active,
      ];
    case 'raw_materials':
      return [
        code('RM-'),
        {
          key: 'grade',
          header: 'Grade',
          required: true,
          aliases: ['material grade', 'material', 'grade name'],
          width: 12,
          list: lists.grades,
          help: `A new grade is made if it is not in the ERP yet.${lists.grades.length ? ` In the ERP now: ${lists.grades.join(', ')}.` : ''}`,
          example: lists.grades[0] ?? 'A105',
        },
        { key: 'shape', header: 'Shape', aliases: ['form', 'section'], width: 10, list: MATERIAL_SHAPES, strict: true, help: `${MATERIAL_SHAPES.join(', ')}. Empty = ROUND.`, example: 'ROUND' },
        { key: 'size', header: 'Size', required: true, aliases: ['bar size', 'dia', 'diameter', 'material size'], width: 14, format: 'text', help: 'e.g. 60 MM. Grade + size must be unique.', example: '60 MM' },
        { key: 'sizeMm', header: 'Size (mm)', aliases: ['size mm', 'dia mm', 'diameter mm'], width: 10, help: 'Number only, for weight calculations. Optional.', example: '60' },
        { key: 'densityKgM3', header: 'Density (kg/m3)', aliases: ['density', 'density kg/m3', 'density kgm3'], width: 14, help: 'Optional. Steel is about 7850.', example: '7850' },
        { key: 'uom', header: 'Unit', aliases: ['uom', 'unit of measure', 'units'], width: 8, list: UNITS, strict: true, help: `${UNITS.join(', ')}. Empty = KG.`, example: 'KG' },
        { key: 'reorderLevel', header: 'Reorder level', aliases: ['reorder', 'minimum stock', 'min stock', 'reorder qty', 're-order level'], width: 13, help: 'Stock below this shows as low. Optional.', example: '500' },
        active,
      ];
    case 'rm_stock':
      return [
        { key: 'rmCode', header: 'Raw material code', aliases: ['rm code', 'material code', 'code'], width: 16, format: 'text', help: 'Fill this, or Grade + Size. The raw material must be in the ERP.', example: '' },
        { key: 'grade', header: 'Grade', aliases: ['material grade'], width: 12, list: lists.grades, help: 'Needed when the code is empty.', example: lists.grades[0] ?? 'A105' },
        { key: 'size', header: 'Size', aliases: ['bar size', 'dia'], width: 14, format: 'text', help: 'Needed when the code is empty, e.g. 60 MM.', example: '60 MM' },
        { key: 'heatNo', header: 'Heat no', aliases: ['heat', 'heat number', 'our heat no', 'internal heat no'], width: 14, format: 'text', help: 'Your heat number. Empty = numbered automatically. Must not be in the ERP already.', example: '' },
        { key: 'millHeatNo', header: 'Mill heat no', aliases: ['mill heat', 'mill heat number', 'supplier heat no', 'mtc heat no'], width: 16, format: 'text', help: 'Heat number on the mill test certificate. Optional.', example: 'H-77821' },
        { key: 'supplier', header: 'Supplier', aliases: ['supplier name', 'supplier code', 'vendor', 'mill'], width: 24, help: 'Supplier code or name as in the ERP. Optional.', example: '' },
        { key: 'receivedDate', header: 'Received date', aliases: ['date', 'receipt date', 'grn date', 'inward date'], width: 13, format: 'date', help: 'dd-mm-yyyy. Optional.', example: '01-04-2026' },
        { key: 'quantity', header: 'Quantity (kg)', required: true, aliases: ['quantity', 'qty', 'kg', 'stock', 'weight', 'qty kg', 'stock kg', 'balance'], width: 13, help: 'Kg in the RM store now. More than 0.', example: '1250.5' },
        { key: 'remarks', header: 'Remarks', aliases: ['notes', 'remark'], width: 26, help: 'Optional.', example: '' },
      ];
    case 'fg_stock':
      return [
        { key: 'itemCode', header: 'Item code', aliases: ['code', 'part code'], width: 14, format: 'text', help: 'Fill this, or Product + Part (+ End). The item must be in the ERP.', example: '' },
        { key: 'product', header: 'Product', aliases: ['product name', 'product code'], width: 30, help: 'Product name or code. Needed when the item code is empty.', example: '2" FIG 100 HAMMER UNION' },
        { key: 'part', header: 'Part', aliases: ['part type', 'part name'], width: 12, list: lists.partTypes, help: 'Needed when the item code is empty.', example: lists.partTypes[0] ?? 'MALE' },
        { key: 'end', header: 'End', aliases: ['end connection', 'end type'], width: 9, list: END_CHOICES, help: 'BW, THD or None. Needed when the part has more than one item.', example: 'BW' },
        { key: 'heatNo', header: 'Heat no', aliases: ['heat', 'heat number'], width: 14, format: 'text', help: 'Optional. The heat must already be in the ERP.', example: '' },
        { key: 'quantity', header: 'Quantity (pcs)', required: true, aliases: ['quantity', 'qty', 'pcs', 'stock', 'nos', 'balance'], width: 13, help: 'Pieces in the FG store now. More than 0.', example: '40' },
        { key: 'remarks', header: 'Remarks', aliases: ['notes', 'remark'], width: 26, help: 'Optional.', example: '' },
      ];
  }
}

// ====================================================================== matching headings

/** "Payment terms (days) *" -> "paymenttermsdays" */
export const headingKey = (s: string) => s.toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]/g, '');

/** Which column of the sheet each template column is in. */
export function matchHeadings(heading: Cell[], columns: ImportColumn[]): { at: Map<string, number>; ignored: string[] } {
  const at = new Map<string, number>();
  const ignored: string[] = [];
  const keys = columns.map((c) => ({ key: c.key, names: [c.header, ...(c.aliases ?? [])].map(headingKey) }));
  heading.forEach((cell, i) => {
    const h = headingKey(text(cell));
    if (!h) return;
    // the main heading first, then the other names
    const hit = keys.find((k) => k.names[0] === h && !at.has(k.key)) ?? keys.find((k) => k.names.includes(h) && !at.has(k.key));
    if (hit) at.set(hit.key, i);
    else ignored.push(text(cell));
  });
  return { at, ignored };
}

// ====================================================================== cell values

/** A number the way a person reads it: 12, 12.5 (no 12.499999999). */
function numberText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
}

/** Cell -> trimmed text ("" for empty). Line breaks become plain "\n" (Excel may save them as CR LF). */
export function text(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return numberText(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  v = v.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
  return v.replace(/ /g, ' ').trim();
}

/** Same text, compared without case and extra spaces. */
export const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** "1,23,456.50" or 123456.5 -> 123456.5; "" -> undefined; anything else -> NaN. */
export function numberOf(v: Cell | undefined): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return NaN;
  const s = v.replace(/[,\s ]/g, '').replace(/^₹/, '');
  if (!s) return undefined;
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

/** Yes / No, Y / N, True / False, 1 / 0, Active / Inactive. */
export function yesNo(v: Cell | undefined): boolean | undefined | 'bad' {
  if (typeof v === 'boolean') return v;
  const s = text(v).toLowerCase();
  if (!s) return undefined;
  if (['yes', 'y', 'true', '1', 'active'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'inactive'].includes(s)) return false;
  return 'bad';
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Excel date, 25-11-2026, 25/11/26, 2026-11-25 or 25-Nov-2026 -> "2026-11-25"; "" -> undefined; else "bad". */
export function dateOf(v: Cell | undefined, date1904: boolean): string | undefined | 'bad' {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return excelDate(v, date1904) ?? 'bad';
  const s = text(v);
  if (!s) return undefined;
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[ /-]([A-Za-z]{3})[A-Za-z]*[ /-](\d{2}|\d{4})$/))) [d, m, y] = [Number(r[1]), MONTHS[r[2].toLowerCase()] ?? 0, Number(r[3])];
  else return 'bad';
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!m || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return 'bad';
  return date.toISOString().slice(0, 10);
}

/** "Gujarat", "24", "24 · Gujarat", "gujarat state" -> "24". */
export function stateCodeOf(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const code = t.match(/^(\d{1,2})\b/);
  if (code) {
    const c = code[1].padStart(2, '0');
    return INDIAN_STATES.some((x) => x.code === c) ? c : null;
  }
  const k = headingKey(t.replace(/\bstate\b/i, '').replace(/&/g, 'and'));
  const hit = INDIAN_STATES.find((x) => headingKey(x.name.replace(/&/g, 'and')) === k);
  if (hit) return hit.code;
  // common other spellings
  const other: Record<string, string> = { orissa: '21', pondicherry: '34', uttaranchal: '05', jammuandkashmir: '01', jk: '01', delhi: '07', newdelhi: '07', nctofdelhi: '07', andaman: '35', dadranagarhaveli: '26', damananddiu: '26', telengana: '36' };
  return other[k] ?? null;
}

export function gstinOk(gstin: string): boolean {
  return GSTIN_REGEX.test(gstin);
}

/** "Job work vendor", "JOB_WORK", "jobwork", "job work" -> JOB_WORK. */
export function supplierTypeOf(s: string): SupplierType | null {
  const k = headingKey(s);
  if (!k) return null;
  for (const t of SUPPLIER_TYPES) {
    if (headingKey(t) === k || headingKey(SUPPLIER_TYPE_LABELS[t]) === k) return t;
  }
  const words: Record<string, SupplierType> = { material: 'MATERIAL', rawmaterial: 'MATERIAL', rm: 'MATERIAL', supplier: 'MATERIAL', jobwork: 'JOB_WORK', jobworker: 'JOB_WORK', vendor: 'JOB_WORK', service: 'SERVICE', services: 'SERVICE', other: 'OTHER', others: 'OTHER' };
  return words[k] ?? null;
}

/** An allowed value, ignoring case and spaces: ("round", MATERIAL_SHAPES) -> "ROUND". */
export function choiceOf<T extends string>(s: string, choices: readonly T[]): T | null {
  const k = headingKey(s);
  return choices.find((c) => headingKey(c) === k) ?? null;
}

/** First of several phone numbers or e-mails in one cell ("98250 12345 / 0281 2451234"). */
export function firstOf(s: string, splitter: RegExp): { value: string; more: boolean } {
  const parts = s.split(splitter).map((p) => p.trim()).filter(Boolean);
  return { value: parts[0] ?? '', more: parts.length > 1 };
}
