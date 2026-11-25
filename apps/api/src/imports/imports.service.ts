import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ZodError } from 'zod';
import {
  CURRENCIES,
  customerSchema,
  hasPermission,
  IMPORT_MAX_ROWS,
  IMPORT_TYPE_INFO,
  INDIAN_STATES,
  MATERIAL_SHAPES,
  productSchema,
  rawMaterialSchema,
  supplierSchema,
  UNITS,
  type DocumentSeriesCode,
  type ImportCheck,
  type ImportMode,
  type ImportResult,
  type ImportRow,
  type ImportRowStatus,
  type ImportType,
} from '@bht/shared';
import { AuditAction, EndConnection, Prisma, StockKind, StockLocation, StockRefType } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { NumberingService } from '../core/numbering.service';
import { StockService } from '../core/stock.service';
import { diff, normalize } from '../common/normalize';
import { toPlain } from '../common/serialize.interceptor';
import type { Actor, AuthUser } from '../common/auth-user';
import { itemName } from '../masters/item-name';
import {
  choiceOf,
  dateOf,
  firstOf,
  gstinOk,
  headingKey,
  importColumns,
  matchHeadings,
  norm,
  numberOf,
  stateCodeOf,
  SUPPLIER_TYPE_CHOICES,
  supplierTypeOf,
  text,
  yesNo,
  type ImportColumn,
  type TemplateLists,
} from './columns';
import { columnLetters, FileProblem, readWorkbook, STYLE, writeWorkbook, type Cell, type OutCell, type OutSheet, type Sheet } from './xlsx';

export interface Upload {
  buffer: Buffer;
  originalname: string;
}

/** One filled row of the sheet. */
class DataRow {
  constructor(
    readonly row: number,
    private readonly cells: Cell[],
    private readonly at: Map<string, number>,
  ) {}

  has(key: string) {
    return this.at.has(key);
  }

  cell(key: string): Cell {
    const i = this.at.get(key);
    return i === undefined ? null : (this.cells[i] ?? null);
  }

  text(key: string): string {
    return text(this.cell(key));
  }
}

interface ParsedFile {
  fileName: string;
  sheet: Sheet;
  columns: ImportColumn[];
  used: string[];
  missing: string[];
  ignored: string[];
  rows: DataRow[];
  /** Tells a file imported before (same type, same bytes). */
  hash: string;
}

interface Ctx {
  db: Tx;
  mode: ImportMode;
  can: (permission: string) => boolean;
  date1904: boolean;
  columns: ImportColumn[];
}

/** What the import does while saving: the audit lines, and categories / grades made on the way. */
class RunState {
  readonly audit: Prisma.AuditLogCreateManyInput[] = [];
  private readonly categories = new Map<string, number>();
  private readonly grades = new Map<string, number>();

  constructor(
    readonly tx: Tx,
    readonly actor: Actor,
  ) {}

  log(action: AuditAction, entity: string, entityId: number | string | null, summary: string, changes?: unknown) {
    this.audit.push({
      userId: this.actor.userId,
      ip: this.actor.ip,
      action,
      entity,
      entityId: entityId == null ? null : String(entityId),
      summary: summary.slice(0, 255),
      changes: changes === undefined ? undefined : (toPlain(changes) as Prisma.InputJsonValue),
    });
  }

  /** The id of a product category, made when it is not there yet. */
  async category(name: string): Promise<number> {
    const key = norm(name);
    const known = this.categories.get(key);
    if (known) return known;
    const row = (await this.tx.productCategory.findFirst({ where: { name } })) ?? (await this.tx.productCategory.create({ data: { name } }));
    if (row.name === name && !this.audit.some((a) => a.entity === 'product_category' && a.entityId === String(row.id))) {
      this.log(AuditAction.CREATE, 'product_category', row.id, `Created product category ${row.name} (Excel import)`);
    }
    this.categories.set(key, row.id);
    return row.id;
  }

  /** The id of a material grade, made when it is not there yet (names are kept in capitals, like the grade screen does). */
  async grade(name: string): Promise<number> {
    const upper = name.trim().replace(/\s+/g, ' ').toUpperCase();
    const known = this.grades.get(upper);
    if (known) return known;
    let row = await this.tx.materialGrade.findFirst({ where: { name: upper } });
    if (!row) {
      row = await this.tx.materialGrade.create({ data: { name: upper } });
      this.log(AuditAction.CREATE, 'material_grade', row.id, `Created material grade ${row.name} (Excel import)`);
    }
    this.grades.set(upper, row.id);
    return row.id;
  }
}

type Plan = (run: RunState) => Promise<'created' | 'updated'>;

/** A row being checked: problems stop it, warnings do not. */
interface Out extends ImportRow {
  problems: string[];
  plan?: Plan;
}

interface Analysis {
  rows: Out[];
  willCreate: string[];
}

const newOut = (row: number): Out => ({ row, label: '', status: 'new', notes: [], warnings: [], problems: [] });

const STATUSES: ImportRowStatus[] = ['new', 'update', 'same', 'skip', 'error'];

/** A record with its decimal numbers as plain numbers, so "100" from the database equals 100 from the sheet. */
const plain = <T extends object>(rec: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, Prisma.Decimal.isDecimal(v) ? (v as Prisma.Decimal).toNumber() : v]));

const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;

/** "Kg 1,250.5" style numbers in messages. */
const qtyText = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Zod problems as "GSTIN: Invalid GSTIN", using the column headings of the template. */
function zodProblems(error: ZodError, columns: ImportColumn[], fieldColumn: Record<string, string> = {}): string[] {
  return error.issues.map((i) => {
    const field = String(i.path[0] ?? '');
    const key = fieldColumn[field] ?? field;
    const header = columns.find((c) => c.key === key)?.header;
    return header ? `${header}: ${i.message}` : i.message;
  });
}

/** "MALE, FEMALE, NUT x 2" -> [{ name: MALE, qty: 1 }, … { name: NUT, qty: 2 }] */
function parseParts(s: string): { name: string; qty: number }[] | string {
  const out: { name: string; qty: number }[] = [];
  for (const piece of s.split(/[,;+\n]/).map((p) => p.trim()).filter(Boolean)) {
    let m = piece.match(/^(.*?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i);
    if (m && m[1]) {
      out.push({ name: m[1].trim(), qty: Number(m[2]) });
      continue;
    }
    m = piece.match(/^(\d+(?:\.\d+)?)\s*(?:[x×*]\s*|\s)(.+)$/i);
    if (m) {
      out.push({ name: m[2].trim(), qty: Number(m[1]) });
      continue;
    }
    out.push({ name: piece, qty: 1 });
  }
  if (!out.length) return 'Parts (BOM) is empty';
  const bad = out.find((p) => !(p.qty > 0));
  return bad ? `Parts (BOM): the count for ${bad.name} must be more than 0` : out;
}

/** Items "Make items" would add: one per part and end (parts without an end get one). */
function plannedItems(parts: { partTypeId: number; hasEnd: boolean }[], ends: EndConnection[], existing: Set<string>) {
  const out: { partTypeId: number; endConnection: EndConnection }[] = [];
  for (const p of parts) {
    const variants = p.hasEnd ? ends.filter((e) => e !== EndConnection.NONE) : [EndConnection.NONE];
    for (const endConnection of variants.length ? variants : [EndConnection.NONE]) {
      const key = `${p.partTypeId}:${endConnection}`;
      if (existing.has(key)) continue;
      existing.add(key);
      out.push({ partTypeId: p.partTypeId, endConnection });
    }
  }
  return out;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
  ) {}

  // ================================================================== templates

  /** Names already in the ERP, for the drop-downs and the help text. */
  private async lists(): Promise<TemplateLists> {
    const [categories, grades, partTypes] = await Promise.all([
      this.prisma.productCategory.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      this.prisma.materialGrade.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: 'asc' } }),
      this.prisma.partType.findMany({ select: { name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);
    return { categories: categories.map((c) => c.name), grades: grades.map((g) => g.name), partTypes: partTypes.map((p) => p.name) };
  }

  /** The empty template: the sheet to fill (headings, formats, drop-downs), a Help sheet and a hidden Lists sheet. */
  async template(type: ImportType): Promise<{ name: string; data: Buffer }> {
    const info = IMPORT_TYPE_INFO[type];
    const columns = importColumns(type, await this.lists());
    const sheetName = info.label.replace(/[:\\/?*[\]]/g, '').replace(/\s+/g, ' ').slice(0, 31);

    const listed = columns.filter((c) => c.list?.length);
    const lists: OutSheet = {
      name: 'Lists',
      hidden: true,
      cols: listed.map(() => ({ width: 24 })),
      rows: [],
    };
    const longest = Math.max(0, ...listed.map((c) => c.list!.length));
    lists.rows.push(listed.map((c) => ({ v: c.header, s: STYLE.tableHead })));
    for (let i = 0; i < longest; i++) lists.rows.push(listed.map((c) => (c.list![i] !== undefined ? { v: c.list![i] } : null)));

    const data: OutSheet = {
      name: sheetName,
      freezeTopRow: true,
      cols: columns.map((c) => ({ width: c.width ?? 14, style: c.format === 'text' ? STYLE.text : c.format === 'date' ? STYLE.date : undefined })),
      rows: [columns.map((c) => ({ v: c.required ? `${c.header} *` : c.header, s: c.required ? STYLE.headRequired : STYLE.head }))],
      lists: listed.map((c) => {
        const col = columnLetters(columns.indexOf(c));
        const src = columnLetters(listed.indexOf(c));
        return { sqref: `${col}2:${col}${IMPORT_MAX_ROWS + 1}`, source: `Lists!$${src}$2:$${src}$${c.list!.length + 1}`, strict: !!c.strict };
      }),
    };

    const tips: Record<ImportType, string[]> = {
      customers: [
        'A customer already in the ERP (same code, or same name when Code is empty) is not added twice. When you upload you choose: leave it as it is, or update it from the filled cells. Empty cells never wipe out what is in the ERP.',
      ],
      suppliers: [
        'A supplier already in the ERP (same code, or same name when Code is empty) is not added twice. When you upload you choose: leave it as it is, or update it from the filled cells. Empty cells never wipe out what is in the ERP.',
      ],
      products: [
        'Part types (MALE, FEMALE, NUT …) must be in the ERP first (Products → Part types). New categories are made for you.',
        'Fill "Make items for" to make the stock items too; you need them for opening stock of finished parts.',
      ],
      raw_materials: ['New grades are made for you. A raw material already in the ERP (same code, or same grade + size) is not added twice.'],
      rm_stock: [
        'Each row makes one heat number with its stock in the RM store. Import the raw materials (and suppliers) first.',
        'Import this file once only: importing it again adds the stock again.',
      ],
      fg_stock: [
        'Import the products with "Make items for" filled first, so the items are there.',
        'Import this file once only: importing it again adds the stock again.',
      ],
    };
    const help: OutSheet = {
      name: 'Help',
      cols: [{ width: 24 }, { width: 10 }, { width: 80 }, { width: 28 }],
      rows: [
        [{ v: `How to fill the "${sheetName}" sheet`, s: STYLE.title }],
        [],
        [{ v: `1. One ${info.rowNoun} per row, from row 2. Keep the headings in row 1 as they are.` }],
        [{ v: '2. Columns marked * (dark blue) must be filled. The others can stay empty.' }],
        [{ v: `3. In the ERP open Masters → Import from Excel, choose "${info.label}" and upload this file. Every row is checked and shown to you before anything is saved.` }],
        ...tips[type].map((t, i) => [{ v: `${i + 4}. ${t}` }]),
        [],
        ['Column', 'Needed?', 'What to enter', 'Example'].map((v) => ({ v, s: STYLE.tableHead })),
        ...columns.map((c): (OutCell | null)[] => [
          { v: c.header, s: STYLE.tableKey },
          { v: c.required ? 'Yes' : '', s: STYLE.tableCell },
          { v: c.help, s: STYLE.tableCell },
          { v: c.example, s: STYLE.tableCell },
        ]),
      ],
    };
    return { name: `${type.replace(/_/g, '-')}-import-template.xlsx`, data: writeWorkbook([data, help, lists]) };
  }

  // ================================================================== reading a file

  private async read(type: ImportType, file: Upload | undefined): Promise<ParsedFile> {
    if (!file?.buffer?.length) throw new BadRequestException('Please choose a file. The file sent was empty.');
    let sheets: Sheet[];
    try {
      sheets = readWorkbook(file.buffer, file.originalname);
    } catch (err) {
      if (err instanceof FileProblem) throw new BadRequestException(err.message);
      throw err;
    }
    const columns = importColumns(type, await this.lists());

    // the sheet and heading row (within the first 10 rows) where most headings match
    let best: { sheet: Sheet; index: number; at: Map<string, number>; ignored: string[] } | null = null;
    for (const sheet of sheets) {
      for (let i = 0; i < Math.min(10, sheet.rows.length); i++) {
        const m = matchHeadings(sheet.rows[i] ?? [], columns);
        if (!best || m.at.size > best.at.size) best = { sheet, index: i, ...m };
      }
    }
    if (!best || best.at.size === 0) {
      const example = columns.filter((c) => c.required).map((c) => `"${c.header}"`).join(', ');
      throw new BadRequestException(`Could not find the column headings (${example}) in the first rows of the file. Please fill the template from this page.`);
    }
    const found = best;
    // Only the columns every row needs: a way to find the record (and the quantity for stock).
    // Other needed values (Category, Parts …) are checked row by row, as only new rows need them.
    const has = (key: string) => found.at.has(key);
    const missing: string[] = [];
    const need = (present: boolean, label: string) => {
      if (!present) missing.push(label);
    };
    switch (type) {
      case 'customers':
      case 'suppliers':
        need(has('name') || has('code'), 'Name');
        break;
      case 'products':
        need(has('name') || has('code'), 'Product name');
        break;
      case 'raw_materials':
        need(has('code') || (has('grade') && has('size')), has('grade') ? 'Size' : has('size') ? 'Grade' : 'Grade and Size');
        break;
      case 'rm_stock':
        need(has('rmCode') || (has('grade') && has('size')), 'Raw material code (or Grade and Size)');
        need(has('quantity'), 'Quantity (kg)');
        break;
      case 'fg_stock':
        need(has('itemCode') || (has('product') && has('part')), 'Item code (or Product and Part)');
        need(has('quantity'), 'Quantity (pcs)');
        break;
    }

    const rows: DataRow[] = [];
    found.sheet.rows.slice(found.index + 1).forEach((cells, i) => {
      if (!cells?.length) return;
      const row = new DataRow(found.index + 2 + i, cells, found.at);
      if ([...found.at.keys()].some((k) => row.text(k) !== '')) rows.push(row);
    });
    if (rows.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException(`The file has ${rows.length.toLocaleString('en-IN')} rows. At most ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows can be imported at a time: please split it into smaller files.`);
    }
    return {
      fileName: file.originalname,
      sheet: found.sheet,
      columns,
      used: columns.filter((c) => found.at.has(c.key)).map((c) => c.header),
      missing,
      ignored: found.ignored,
      rows,
      hash: createHash('sha256').update(`${type}:`).update(file.buffer).digest('hex').slice(0, 48),
    };
  }

  private async importedBefore(hash: string): Promise<ImportCheck['importedBefore']> {
    const last = await this.prisma.auditLog.findFirst({
      where: { entity: 'import', entityId: hash },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    });
    return last ? { at: last.createdAt.toISOString(), by: last.user?.name ?? null, summary: last.summary } : null;
  }

  // ================================================================== check and import

  /** Reads the file and checks every row; nothing is saved. */
  async check(type: ImportType, file: Upload | undefined, mode: ImportMode, user: AuthUser): Promise<ImportCheck> {
    const f = await this.read(type, file);
    const base = {
      type,
      fileName: f.fileName,
      sheet: f.sheet.name,
      columns: { used: f.used, missing: f.missing, ignored: f.ignored },
      importedBefore: await this.importedBefore(f.hash),
    };
    if (f.missing.length) {
      return { ...base, rows: [], counts: { new: 0, update: 0, same: 0, skip: 0, error: 0 }, warned: 0, willCreate: [] };
    }
    const a = await this.analyse(this.prisma, type, f, mode, user);
    const rows: ImportRow[] = a.rows.map(({ row, label, status, notes, warnings }) => ({ row, label, status, notes, warnings }));
    const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<ImportRowStatus, number>;
    return { ...base, rows, counts, warned: rows.filter((r) => r.warnings.length && r.status !== 'error').length, willCreate: a.willCreate };
  }

  /** Checks the file again and saves every good row in one go (all or nothing if the database refuses one). */
  async run(type: ImportType, file: Upload | undefined, mode: ImportMode, user: AuthUser, actor: Actor): Promise<ImportResult> {
    const f = await this.read(type, file);
    if (f.missing.length) throw new BadRequestException(`The file has no column for: ${f.missing.join(', ')}. Please fill the template from this page.`);
    const info = IMPORT_TYPE_INFO[type];
    return this.prisma.$transaction(
      async (tx) => {
        const a = await this.analyse(tx, type, f, mode, user);
        const todo = a.rows.filter((r) => r.plan);
        if (!todo.length) throw new BadRequestException('Nothing to import: every row is already in the ERP or has a problem.');
        const run = new RunState(tx, actor);
        let created = 0;
        let updated = 0;
        for (const r of todo) {
          try {
            if ((await r.plan!(run)) === 'created') created++;
            else updated++;
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            throw new BadRequestException(`Row ${r.row} (${r.label}) could not be saved: ${why}. Nothing was imported.`);
          }
        }
        const count = (s: ImportRowStatus) => a.rows.filter((r) => r.status === s).length;
        const result: ImportResult = {
          created,
          updated,
          unchanged: count('same'),
          skipped: count('skip'),
          failed: count('error'),
          summary: '',
        };
        result.summary = [
          `${created} added`,
          updated ? `${updated} updated` : '',
          result.unchanged ? `${result.unchanged} unchanged` : '',
          result.skipped ? `${result.skipped} already in the ERP` : '',
          result.failed ? `${result.failed} with problems left out` : '',
        ]
          .filter(Boolean)
          .join(', ');
        run.log(AuditAction.CREATE, 'import', f.hash, `Excel import, ${info.label}: ${result.summary} (${f.fileName})`, {
          type,
          file: f.fileName,
          sheet: f.sheet.name,
          mode,
          ...result,
          leftOut: a.rows.filter((r) => r.status === 'error').slice(0, 200).map((r) => ({ row: r.row, label: r.label, problems: r.notes })),
        });
        await tx.auditLog.createMany({ data: run.audit });
        return result;
      },
      { timeout: 10 * 60_000, maxWait: 20_000 },
    );
  }

  /** Checks every row; rows with a problem get status "error" and no plan. */
  private async analyse(db: Tx, type: ImportType, f: ParsedFile, mode: ImportMode, user: AuthUser): Promise<Analysis> {
    const ctx: Ctx = { db, mode, can: (p) => hasPermission(user.permissions, p), date1904: f.sheet.date1904, columns: f.columns };
    const result = await this.byType(type, f.rows, ctx);
    for (const o of result.rows) {
      if (!o.problems.length) continue;
      o.status = 'error';
      o.notes = o.problems;
      o.plan = undefined;
    }
    return result;
  }

  private byType(type: ImportType, rows: DataRow[], ctx: Ctx): Promise<Analysis> {
    switch (type) {
      case 'customers':
        return this.parties('customer', rows, ctx);
      case 'suppliers':
        return this.parties('supplier', rows, ctx);
      case 'products':
        return this.products(rows, ctx);
      case 'raw_materials':
        return this.rawMaterials(rows, ctx);
      case 'rm_stock':
        return this.rmStock(rows, ctx);
      case 'fg_stock':
        return this.fgStock(rows, ctx);
    }
  }

  /** The next free number of a series (skips numbers someone already typed by hand). */
  private async freshCode(tx: Tx, series: DocumentSeriesCode, taken: (code: string) => Promise<unknown>, opts: { date?: Date; vars?: Record<string, string> } = {}): Promise<string> {
    for (let i = 0; i < 1000; i++) {
      const code = await this.numbering.next(series, { tx, ...opts });
      if (!(await taken(code))) return code;
    }
    throw new BadRequestException(`No free number found in the ${series} series`);
  }

  // ================================================================== customers and suppliers

  private async parties(kind: 'customer' | 'supplier', rows: DataRow[], ctx: Ctx): Promise<Analysis> {
    const isCustomer = kind === 'customer';
    const schema = isCustomer ? customerSchema : supplierSchema;
    const keys = Object.keys(schema.shape);
    type Party = Record<string, unknown> & { id: number; code: string; name: string; gstin: string | null };
    const records: Party[] = isCustomer ? await ctx.db.customer.findMany() : await ctx.db.supplier.findMany();
    const byCode = new Map(records.map((r) => [norm(r.code), r]));
    const byName = new Map<string, Party>();
    const byGstin = new Map<string, Party>();
    for (const r of records) {
      if (!byName.has(norm(r.name))) byName.set(norm(r.name), r);
      if (r.gstin && !byGstin.has(r.gstin.toUpperCase())) byGstin.set(r.gstin.toUpperCase(), r);
    }
    const seenCode = new Map<string, number>();
    const seenName = new Map<string, number>();
    const seenGstin = new Map<string, number>();
    const header = (field: string) => ctx.columns.find((c) => c.key === (field === 'stateCode' ? 'state' : field))?.header ?? field;
    const out: Out[] = [];

    for (const r of rows) {
      const o = newOut(r.row);
      out.push(o);
      /** Filled cells only. */
      const input: Record<string, unknown> = {};
      /** Worked out from other cells (state and PAN from the GSTIN); used only where nothing else is set. */
      const soft: Record<string, unknown> = {};

      for (const k of ['code', 'name', 'contactPerson', 'address', 'shippingAddress', 'city', 'country', 'notes', 'bankName', 'bankAccountNo']) {
        if (!keys.includes(k)) continue;
        const v = r.text(k).replace(k === 'name' || k === 'code' ? /\s+/g : /[^\S\n]+/g, ' ');
        if (v) input[k] = v;
      }
      const pin = r.text('pincode').replace(/\s+/g, '');
      if (pin) input.pincode = pin;
      if (keys.includes('bankIfsc')) {
        const ifsc = r.text('bankIfsc').replace(/\s+/g, '').toUpperCase();
        if (ifsc) input.bankIfsc = ifsc;
      }
      const phone = r.text('phone');
      if (phone) {
        const first = firstOf(phone, /\s*(?:[/,;|]|\bor\b)\s*/i);
        input.phone = first.value;
        if (first.more) o.warnings.push(`Phone: only the first number was kept (${first.value})`);
      }
      const email = r.text('email');
      if (email) {
        const first = firstOf(email, /[\s,;/]+/);
        input.email = first.value.toLowerCase();
        if (first.more) o.warnings.push(`Email: only the first address was kept (${first.value})`);
      }

      let gstin = r.text('gstin').toUpperCase().replace(/[\s.-]/g, '');
      if (/^(NA|N\/A|NIL|NONE|URP|UNREGISTERED|-+|0)$/.test(gstin)) gstin = '';
      if (gstin) input.gstin = gstin;
      const validGstin = gstin && gstinOk(gstin) ? gstin : '';
      if (validGstin) {
        soft.pan = validGstin.slice(2, 12);
        const sc = validGstin.slice(0, 2);
        if (INDIAN_STATES.some((s) => s.code === sc)) soft.stateCode = sc;
      }
      const pan = r.text('pan').toUpperCase().replace(/\s+/g, '');
      if (pan) {
        input.pan = pan;
        if (validGstin && pan !== validGstin.slice(2, 12)) o.warnings.push(`PAN ${pan} is not the PAN inside the GSTIN (${validGstin.slice(2, 12)})`);
      }
      const state = r.text('state');
      if (state) {
        const sc = stateCodeOf(state);
        if (!sc) o.problems.push(`State: "${state}" is not an Indian state or GST state code`);
        else {
          input.stateCode = sc;
          if (soft.stateCode && soft.stateCode !== sc) o.warnings.push(`State ${stateName(sc)} does not match the GSTIN, which is from ${stateName(soft.stateCode as string)}`);
        }
      }
      if (isCustomer) {
        const cur = r.text('currency');
        if (cur) {
          const c = choiceOf(cur, CURRENCIES) ?? (cur === '₹' || /^(rs|rupees?)$/i.test(cur) ? 'INR' : null);
          if (c) input.currency = c;
          else o.problems.push(`Currency: "${cur}" is not one of ${CURRENCIES.join(', ')}`);
        }
      } else {
        const t = r.text('type');
        if (t) {
          const st = supplierTypeOf(t);
          if (st) input.type = st;
          else o.problems.push(`Type: "${t}" is not one of: ${SUPPLIER_TYPE_CHOICES.join(', ')}`);
        }
      }
      const terms = numberOf(r.cell('paymentTermsDays'));
      if (terms !== undefined) {
        if (!Number.isInteger(terms) || terms < 0) o.problems.push(`${header('paymentTermsDays')}: must be a whole number of days`);
        else input.paymentTermsDays = terms;
      }
      const isActive = yesNo(r.cell('isActive'));
      if (isActive === 'bad') o.problems.push('Active: use Yes or No');
      else if (isActive !== undefined) input.isActive = isActive;

      // which record is it?
      const code = (input.code as string | undefined) ?? '';
      const name = (input.name as string | undefined) ?? '';
      const rec = code ? byCode.get(norm(code)) : name ? byName.get(norm(name)) : undefined;
      o.label = [code || rec?.code, name || rec?.name].filter(Boolean).join(' · ') || '(no name)';
      if (!name && !rec) o.problems.push(code ? `Name is empty (and code ${code} is not in the ERP)` : 'Name is empty');
      const twice = (code && seenCode.get(norm(code))) || (name && seenName.get(norm(name)));
      if (twice) o.problems.push(`Same ${kind} as row ${twice}`);
      if (code && !seenCode.has(norm(code))) seenCode.set(norm(code), r.row);
      if (name && !seenName.has(norm(name))) seenName.set(norm(name), r.row);
      if (name) {
        const other = byName.get(norm(name));
        if (other && other !== rec) o.warnings.push(`Same name as ${other.code} · ${other.name} in the ERP; check it is not entered twice`);
      }
      if (validGstin) {
        const other = byGstin.get(validGstin);
        if (other && other !== rec) o.warnings.push(`Same GSTIN as ${other.code} · ${other.name} in the ERP`);
        const inFile = seenGstin.get(validGstin);
        if (inFile) o.warnings.push(`Same GSTIN as row ${inFile}`);
        else seenGstin.set(validGstin, r.row);
      }
      if (o.problems.length) continue;

      if (rec && ctx.mode === 'skip') {
        o.status = 'skip';
        o.notes.push(`Already in the ERP as ${rec.code}; left as it is`);
        continue;
      }
      if (rec) {
        if (name && norm(name) === norm(rec.name)) delete input.name; // same name, maybe other capitals: keep the ERP's
        const merged: Record<string, unknown> = { ...Object.fromEntries(keys.map((k) => [k, rec[k] ?? ''])), ...input };
        for (const [k, v] of Object.entries(soft)) if (merged[k] === '' || merged[k] == null) merged[k] = v;
        const parsed = schema.safeParse(merged);
        if (!parsed.success) {
          o.problems.push(...zodProblems(parsed.error, ctx.columns, { stateCode: 'state' }));
          continue;
        }
        const data = { ...normalize(parsed.data), code: parsed.data.code || rec.code };
        const changes = diff(plain(rec), { ...plain(rec), ...data });
        if (!Object.keys(changes).length) {
          o.status = 'same';
          o.notes.push(`Already in the ERP as ${rec.code}; nothing to change`);
          continue;
        }
        o.status = 'update';
        o.notes.push(`Changes: ${Object.keys(changes).map(header).join(', ')}`);
        o.plan = async (run) => {
          const row = isCustomer ? await run.tx.customer.update({ where: { id: rec.id }, data }) : await run.tx.supplier.update({ where: { id: rec.id }, data });
          run.log(AuditAction.UPDATE, kind, rec.id, `Updated ${kind} ${row.name} (Excel import)`, changes);
          return 'updated';
        };
        continue;
      }

      const parsed = schema.safeParse({ ...soft, ...input });
      if (!parsed.success) {
        o.problems.push(...zodProblems(parsed.error, ctx.columns, { stateCode: 'state' }));
        continue;
      }
      o.notes.push(code ? `New ${kind}, code ${code}` : `New ${kind}`);
      const values = parsed.data;
      o.plan = async (run) => {
        const tx = run.tx;
        const data = normalize(values);
        const series = isCustomer ? 'CUSTOMER' : 'SUPPLIER';
        const newCode =
          values.code ||
          (await this.freshCode(tx, series, (c) =>
            isCustomer ? tx.customer.findUnique({ where: { code: c }, select: { id: true } }) : tx.supplier.findUnique({ where: { code: c }, select: { id: true } }),
          ));
        const row = isCustomer
          ? await tx.customer.create({ data: { ...data, code: newCode, createdById: run.actor.userId } })
          : await tx.supplier.create({ data: { ...data, code: newCode, createdById: run.actor.userId } });
        run.log(AuditAction.CREATE, kind, row.id, `Created ${kind} ${row.name} (Excel import)`);
        return 'created';
      };
    }
    return { rows: out, willCreate: [] };
  }

  // ================================================================== products

  private async products(rows: DataRow[], ctx: Ctx): Promise<Analysis> {
    const categories = await ctx.db.productCategory.findMany({ select: { id: true, name: true } });
    const partTypes = await ctx.db.partType.findMany({ select: { id: true, name: true, hasEndConnection: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const products = await ctx.db.product.findMany({ include: { components: { select: { partTypeId: true, quantity: true } } } });
    const items = await ctx.db.item.findMany({ select: { productId: true, partTypeId: true, endConnection: true } });

    const catByName = new Map(categories.map((c) => [norm(c.name), c]));
    const partByName = new Map(partTypes.map((p) => [norm(p.name), p]));
    const partById = new Map(partTypes.map((p) => [p.id, p]));
    const byCode = new Map(products.map((p) => [norm(p.code), p]));
    const byName = new Map(products.map((p) => [norm(p.name), p]));
    const itemsOf = new Map<number, Set<string>>();
    for (const i of items) {
      if (!itemsOf.has(i.productId)) itemsOf.set(i.productId, new Set());
      itemsOf.get(i.productId)!.add(`${i.partTypeId}:${i.endConnection}`);
    }
    const newCategories = new Map<string, string>();
    const seenCode = new Map<string, number>();
    const seenName = new Map<string, number>();
    const header = (field: string) => ctx.columns.find((c) => c.key === field)?.header ?? field;
    const fieldColumn = { categoryId: 'category', components: 'parts' };
    const bomText = (list: { partTypeId: number; quantity: number }[]) =>
      list.map((c) => `${partById.get(c.partTypeId)?.name ?? c.partTypeId}${c.quantity !== 1 ? ` x ${c.quantity}` : ''}`).join(', ');
    const sig = (list: { partTypeId: number; quantity: number }[]) =>
      [...list].sort((a, b) => a.partTypeId - b.partTypeId).map((c) => `${c.partTypeId}:${c.quantity}`).join(',');
    const out: Out[] = [];

    for (const r of rows) {
      const o = newOut(r.row);
      out.push(o);
      const input: Record<string, unknown> = {};
      for (const k of ['code', 'name', 'size', 'figure', 'pressureRating', 'hsnCode', 'description']) {
        const v = r.text(k).replace(/[^\S\n]+/g, ' ');
        if (v) input[k] = k === 'hsnCode' ? v.replace(/\s+/g, '') : v;
      }
      const isActive = yesNo(r.cell('isActive'));
      if (isActive === 'bad') o.problems.push('Active: use Yes or No');
      else if (isActive !== undefined) input.isActive = isActive;

      const code = (input.code as string | undefined) ?? '';
      const name = (input.name as string | undefined) ?? '';
      const rec = code ? byCode.get(norm(code)) : name ? byName.get(norm(name)) : undefined;
      o.label = [code || rec?.code, name || rec?.name].filter(Boolean).join(' · ') || '(no name)';
      if (!name && !rec) o.problems.push(code ? `Product name is empty (and code ${code} is not in the ERP)` : 'Product name is empty');
      if (name) {
        const other = byName.get(norm(name));
        if (other && other !== rec) o.problems.push(`Product name is already used by ${other.code}; names must be unique`);
      }
      const twice = (code && seenCode.get(norm(code))) || (name && seenName.get(norm(name)));
      if (twice) o.problems.push(`Same product as row ${twice}`);
      if (code && !seenCode.has(norm(code))) seenCode.set(norm(code), r.row);
      if (name && !seenName.has(norm(name))) seenName.set(norm(name), r.row);

      // category: made when new
      const catText = r.text('category').replace(/\s+/g, ' ');
      let categoryId: number | undefined;
      let newCategory: string | undefined;
      if (catText) {
        const c = catByName.get(norm(catText));
        if (c) categoryId = c.id;
        else {
          newCategory = newCategories.get(norm(catText)) ?? catText;
          newCategories.set(norm(catText), newCategory);
        }
      } else if (!rec) o.problems.push('Category is empty');

      // BOM
      let components: { partTypeId: number; quantity: number }[] | undefined;
      const partsText = r.text('parts');
      if (partsText) {
        const parts = parseParts(partsText);
        if (typeof parts === 'string') o.problems.push(parts);
        else {
          const unknown = parts.filter((p) => !partByName.has(norm(p.name))).map((p) => p.name);
          if (unknown.length) {
            o.problems.push(
              `Parts (BOM): ${unknown.map((u) => `"${u}"`).join(', ')} ${unknown.length === 1 ? 'is not a part type' : 'are not part types'} in the ERP (${partTypes.map((p) => p.name).join(', ') || 'none yet'}). Add ${unknown.length === 1 ? 'it' : 'them'} in Products → Part types first.`,
            );
          } else {
            const byPart = new Map<number, number>();
            for (const p of parts) byPart.set(partByName.get(norm(p.name))!.id, p.qty);
            components = [...byPart].map(([partTypeId, quantity]) => ({ partTypeId, quantity }));
          }
        }
      } else if (!rec) o.problems.push('Parts (BOM) is empty');

      // items to make
      const endsText = r.text('itemEnds');
      let ends: EndConnection[] | null = null;
      if (endsText) {
        const k = headingKey(endsText);
        if (['noitems', 'no', 'later', 'skip'].includes(k)) ends = null;
        else if (['none', 'na', 'noend', 'withoutend', 'nil'].includes(k)) ends = [EndConnection.NONE];
        else {
          const pieces = endsText.split(/[,;/&+]|\band\b/i).map((p) => p.trim()).filter(Boolean);
          const picked = pieces.map((p) => choiceOf(p, ['BW', 'THD'] as const));
          if (!pieces.length || picked.some((p) => !p)) o.problems.push(`Make items for: "${endsText}" should be BW, THD, "BW, THD" or None`);
          else ends = [...new Set(picked as EndConnection[])];
        }
      }
      if (ends && !ctx.can('items.create')) {
        o.warnings.push('Items are not made: that needs the "Items (Finished Parts): Create" permission');
        ends = null;
      }
      if (o.problems.length) continue;

      if (rec && ctx.mode === 'skip') {
        o.status = 'skip';
        o.notes.push(`Already in the ERP as ${rec.code}; left as it is`);
        continue;
      }

      if (rec && name && norm(name) === norm(rec.name)) delete input.name;
      const recComponents = rec?.components.map((c) => ({ partTypeId: c.partTypeId, quantity: c.quantity.toNumber() })) ?? [];
      const merged = {
        ...(rec
          ? {
              code: rec.code,
              name: rec.name,
              size: rec.size ?? '',
              figure: rec.figure ?? '',
              pressureRating: rec.pressureRating ?? '',
              hsnCode: rec.hsnCode ?? '',
              description: rec.description ?? '',
              isActive: rec.isActive,
            }
          : {}),
        ...input,
        categoryId: categoryId ?? (newCategory ? 1 : rec?.categoryId),
        components: components ?? recComponents,
      };
      const parsed = productSchema.safeParse(merged);
      if (!parsed.success) {
        o.problems.push(...zodProblems(parsed.error, ctx.columns, fieldColumn));
        continue;
      }
      const { components: bom, categoryId: _placeholder, ...fields } = parsed.data;
      const toMake = ends
        ? plannedItems(
            bom.map((c) => ({ partTypeId: c.partTypeId, hasEnd: partById.get(c.partTypeId)!.hasEndConnection })),
            ends,
            new Set(rec ? itemsOf.get(rec.id) : []),
          )
        : [];
      if (newCategory) o.notes.push(`New category ${newCategory}`);

      if (rec) {
        const fieldData = { ...normalize(fields), code: fields.code || rec.code };
        const changes: Record<string, unknown> = diff(plain(rec), { ...plain(rec), ...fieldData });
        if (newCategory || (categoryId && categoryId !== rec.categoryId)) changes.category = [rec.categoryId, newCategory ?? categoryId];
        const bomChanged = !!components && sig(components) !== sig(recComponents);
        if (bomChanged) changes.parts = [bomText(recComponents), bomText(bom)];
        if (!Object.keys(changes).length && !toMake.length) {
          o.status = 'same';
          o.notes.push(`Already in the ERP as ${rec.code}; nothing to change`);
          continue;
        }
        o.status = 'update';
        if (Object.keys(changes).length) o.notes.push(`Changes: ${Object.keys(changes).map((k) => (k === 'parts' ? header('parts') : header(k))).join(', ')}`);
        if (toMake.length) o.notes.push(`Makes ${toMake.length} new item${toMake.length === 1 ? '' : 's'}`);
        o.plan = async (run) => {
          const tx = run.tx;
          const catId = newCategory ? await run.category(newCategory) : (categoryId ?? rec.categoryId);
          if (bomChanged) await tx.productComponent.deleteMany({ where: { productId: rec.id } });
          const product = await tx.product.update({
            where: { id: rec.id },
            data: { ...fieldData, categoryId: catId, ...(bomChanged ? { components: { create: bom } } : {}) },
          });
          if (product.name !== rec.name) {
            const own = await tx.item.findMany({ where: { productId: rec.id }, include: { partType: true } });
            for (const item of own) await tx.item.update({ where: { id: item.id }, data: { name: itemName(product.name, item.partType.name, item.endConnection) } });
          }
          if (Object.keys(changes).length) run.log(AuditAction.UPDATE, 'product', rec.id, `Updated product ${product.name} (Excel import)`, changes);
          await this.makeItems(run, product, toMake, partById);
          return 'updated';
        };
        continue;
      }

      o.notes.push(`New product${code ? `, code ${code}` : ''}: ${bomText(bom)}`);
      o.notes.push(toMake.length ? `Makes ${toMake.length} item${toMake.length === 1 ? '' : 's'}` : 'No items made now');
      o.plan = async (run) => {
        const tx = run.tx;
        const catId = newCategory ? await run.category(newCategory) : categoryId!;
        const newCode = fields.code || (await this.freshCode(tx, 'PRODUCT', (c) => tx.product.findUnique({ where: { code: c }, select: { id: true } })));
        const product = await tx.product.create({ data: { ...normalize(fields), code: newCode, categoryId: catId, components: { create: bom } } });
        run.log(AuditAction.CREATE, 'product', product.id, `Created product ${product.name} (Excel import)`);
        await this.makeItems(run, product, toMake, partById);
        return 'created';
      };
    }
    return { rows: out, willCreate: [...newCategories.values()].map((c) => `New category: ${c}`) };
  }

  private async makeItems(
    run: RunState,
    product: { id: number; name: string; hsnCode: string | null },
    toMake: { partTypeId: number; endConnection: EndConnection }[],
    partById: Map<number, { name: string }>,
  ) {
    if (!toMake.length) return;
    const tx = run.tx;
    const names: string[] = [];
    for (const m of toMake) {
      const name = itemName(product.name, partById.get(m.partTypeId)!.name, m.endConnection);
      const code = await this.freshCode(tx, 'ITEM', (c) => tx.item.findUnique({ where: { code: c }, select: { id: true } }));
      await tx.item.create({ data: { code, name, productId: product.id, partTypeId: m.partTypeId, endConnection: m.endConnection, hsnCode: product.hsnCode } });
      names.push(name);
    }
    run.log(AuditAction.CREATE, 'item', null, `Generated ${names.length} item(s) for ${product.name} (Excel import)`, { items: names });
  }

  // ================================================================== raw materials

  private async rawMaterials(rows: DataRow[], ctx: Ctx): Promise<Analysis> {
    const grades = await ctx.db.materialGrade.findMany({ select: { id: true, name: true } });
    const materials = await ctx.db.rawMaterial.findMany({ include: { grade: { select: { name: true } } } });
    const gradeByName = new Map(grades.map((g) => [norm(g.name), g]));
    const byCode = new Map(materials.map((m) => [norm(m.code), m]));
    const byKey = new Map(materials.map((m) => [`${m.gradeId}:${norm(m.size)}`, m]));
    const newGrades = new Map<string, string>();
    const seen = new Map<string, number>();
    const header = (field: string) => ctx.columns.find((c) => c.key === field)?.header ?? field;
    const out: Out[] = [];

    for (const r of rows) {
      const o = newOut(r.row);
      out.push(o);
      const input: Record<string, unknown> = {};
      const code = r.text('code').replace(/\s+/g, ' ');
      if (code) input.code = code;
      const gradeText = norm(r.text('grade'));
      const size = norm(r.text('size'));
      if (size) input.size = size;
      const grade = gradeText ? gradeByName.get(gradeText) : undefined;
      const newGrade = gradeText && !grade ? gradeText : undefined;
      if (newGrade) newGrades.set(newGrade, newGrade);

      const shape = r.text('shape');
      if (shape) {
        const s = choiceOf(shape, MATERIAL_SHAPES);
        if (s) input.shape = s;
        else o.problems.push(`Shape: "${shape}" is not one of ${MATERIAL_SHAPES.join(', ')}`);
      }
      const uom = r.text('uom');
      if (uom) {
        const u = choiceOf(uom, UNITS) ?? (/^kgs?$/i.test(uom) ? 'KG' : /^(mtrs?|meters?|metres?|m)$/i.test(uom) ? 'MTR' : /^(pcs?|pieces?|nos?)$/i.test(uom) ? 'PCS' : null);
        if (u) input.uom = u;
        else o.problems.push(`Unit: "${uom}" is not one of ${UNITS.join(', ')}`);
      }
      for (const k of ['sizeMm', 'densityKgM3', 'reorderLevel']) {
        const n = numberOf(r.cell(k));
        if (n === undefined) continue;
        if (Number.isNaN(n)) o.problems.push(`${header(k)}: not a number`);
        else input[k] = n;
      }
      const isActive = yesNo(r.cell('isActive'));
      if (isActive === 'bad') o.problems.push('Active: use Yes or No');
      else if (isActive !== undefined) input.isActive = isActive;

      const rec = code ? byCode.get(norm(code)) : grade && size ? byKey.get(`${grade.id}:${size}`) : undefined;
      const gradeName = grade?.name ?? newGrade ?? rec?.grade.name ?? '';
      o.label = [code || rec?.code, [gradeName, size || rec?.size].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '(empty)';
      if (!rec) {
        if (!gradeText) o.problems.push(code ? `Grade is empty (and code ${code} is not in the ERP)` : 'Grade is empty');
        if (!size) o.problems.push(code ? `Size is empty (and code ${code} is not in the ERP)` : 'Size is empty');
      }
      if (grade && size) {
        const other = byKey.get(`${grade.id}:${size}`);
        if (other && other !== rec) o.problems.push(`${grade.name} ${size} is already in the ERP as ${other.code}`);
      }
      const key = `${gradeName}:${size || rec?.size}`;
      const twice = (code && seen.get(`c:${norm(code)}`)) || seen.get(`k:${key}`);
      if (twice) o.problems.push(`Same raw material as row ${twice}`);
      if (code && !seen.has(`c:${norm(code)}`)) seen.set(`c:${norm(code)}`, r.row);
      if (!seen.has(`k:${key}`)) seen.set(`k:${key}`, r.row);
      if (o.problems.length) continue;

      if (rec && ctx.mode === 'skip') {
        o.status = 'skip';
        o.notes.push(`Already in the ERP as ${rec.code}; left as it is`);
        continue;
      }
      const merged = {
        ...(rec
          ? {
              code: rec.code,
              shape: rec.shape,
              size: rec.size,
              sizeMm: rec.sizeMm?.toNumber() ?? '',
              densityKgM3: rec.densityKgM3?.toNumber() ?? '',
              uom: rec.uom,
              reorderLevel: rec.reorderLevel?.toNumber() ?? '',
              isActive: rec.isActive,
            }
          : {}),
        ...input,
        gradeId: grade?.id ?? (newGrade ? 1 : rec?.gradeId),
      };
      const parsed = rawMaterialSchema.safeParse(merged);
      if (!parsed.success) {
        o.problems.push(...zodProblems(parsed.error, ctx.columns, { gradeId: 'grade' }));
        continue;
      }
      const { gradeId: _placeholder, ...fields } = parsed.data;
      const data = { ...normalize(fields), size: fields.size.toUpperCase() };
      if (newGrade) o.notes.push(`New grade ${newGrade}`);

      if (rec) {
        const fieldData = { ...data, code: fields.code || rec.code };
        const changes: Record<string, unknown> = diff(plain(rec), { ...plain(rec), ...fieldData });
        if (newGrade || (grade && grade.id !== rec.gradeId)) changes.grade = [rec.grade.name, gradeName];
        if (!Object.keys(changes).length) {
          o.status = 'same';
          o.notes.push(`Already in the ERP as ${rec.code}; nothing to change`);
          continue;
        }
        o.status = 'update';
        o.notes.push(`Changes: ${Object.keys(changes).map(header).join(', ')}`);
        o.plan = async (run) => {
          const gradeId = newGrade ? await run.grade(newGrade) : (grade?.id ?? rec.gradeId);
          await run.tx.rawMaterial.update({ where: { id: rec.id }, data: { ...fieldData, gradeId } });
          run.log(AuditAction.UPDATE, 'raw_material', rec.id, `Updated raw material ${gradeName} ${fieldData.size} (Excel import)`, changes);
          return 'updated';
        };
        continue;
      }

      o.notes.push(code ? `New raw material, code ${code}` : 'New raw material');
      o.plan = async (run) => {
        const tx = run.tx;
        const gradeId = newGrade ? await run.grade(newGrade) : grade!.id;
        const newCode = fields.code || (await this.freshCode(tx, 'RAW_MATERIAL', (c) => tx.rawMaterial.findUnique({ where: { code: c }, select: { id: true } })));
        const row = await tx.rawMaterial.create({ data: { ...data, code: newCode, gradeId } });
        run.log(AuditAction.CREATE, 'raw_material', row.id, `Created raw material ${gradeName} ${row.size} (Excel import)`);
        return 'created';
      };
    }
    return { rows: out, willCreate: [...newGrades.values()].map((g) => `New grade: ${g}`) };
  }

  // ================================================================== opening stock: raw material

  private async rmStock(rows: DataRow[], ctx: Ctx): Promise<Analysis> {
    const materials = await ctx.db.rawMaterial.findMany({ include: { grade: { select: { name: true, heatCode: true } } } });
    const heats = await ctx.db.heat.findMany({ select: { heatNo: true, millHeatNo: true, rawMaterialId: true } });
    const suppliers = await ctx.db.supplier.findMany({ select: { id: true, code: true, name: true } });
    const byCode = new Map(materials.map((m) => [norm(m.code), m]));
    const byKey = new Map(materials.map((m) => [`${norm(m.grade.name)}:${norm(m.size)}`, m]));
    const heatNos = new Set(heats.map((h) => norm(h.heatNo)));
    const millHeats = new Map(heats.filter((h) => h.millHeatNo).map((h) => [`${h.rawMaterialId}:${norm(h.millHeatNo!)}`, h.heatNo]));
    const supplierBy = new Map<string, { id: number; name: string }>();
    for (const s of suppliers) {
      supplierBy.set(norm(s.code), s);
      if (!supplierBy.has(norm(s.name))) supplierBy.set(norm(s.name), s);
    }
    const seenHeat = new Map<string, number>();
    const today = new Date().toISOString().slice(0, 10);
    const out: Out[] = [];

    for (const r of rows) {
      const o = newOut(r.row);
      out.push(o);
      const rmCode = r.text('rmCode');
      const grade = norm(r.text('grade'));
      const size = norm(r.text('size'));
      const rm = rmCode ? byCode.get(norm(rmCode)) : grade && size ? byKey.get(`${grade}:${size}`) : undefined;
      const heatNo = norm(r.text('heatNo'));
      const millHeatNo = r.text('millHeatNo').replace(/\s+/g, ' ');
      const qty = numberOf(r.cell('quantity'));
      const unit = (rm?.uom ?? 'KG').toLowerCase();
      o.label = [rm ? `${rm.grade.name} ${rm.size}` : rmCode || [grade, size].filter(Boolean).join(' ') || '(no material)', heatNo || 'new heat no', qty !== undefined && !Number.isNaN(qty) ? `${qtyText(qty)} ${unit}` : '']
        .filter(Boolean)
        .join(' · ');

      if (!rm) {
        if (rmCode) o.problems.push(`Raw material code ${rmCode} is not in the ERP`);
        else if (!grade || !size) o.problems.push('Fill the raw material code, or Grade and Size');
        else o.problems.push(`Raw material ${grade} ${size} is not in the ERP. Import it with the Raw materials template first.`);
      }
      if (heatNo) {
        if (heatNos.has(heatNo)) o.problems.push(`Heat ${heatNo} is already in the ERP. To change its stock use Stock & Ledger → Adjust stock.`);
        const twice = seenHeat.get(heatNo);
        if (twice) o.problems.push(`Heat ${heatNo} is also on row ${twice}`);
        else seenHeat.set(heatNo, r.row);
        if (heatNo.length > 50) o.problems.push('Heat no: at most 50 characters');
      }
      if (millHeatNo.length > 100) o.problems.push('Mill heat no: at most 100 characters');
      if (rm && millHeatNo) {
        const same = millHeats.get(`${rm.id}:${norm(millHeatNo)}`);
        if (same) o.warnings.push(`Heat ${same} in the ERP has the same mill heat no; is this the same lot?`);
      }
      let supplierId: number | null = null;
      const supplier = r.text('supplier');
      if (supplier) {
        const s = supplierBy.get(norm(supplier));
        if (s) supplierId = s.id;
        else o.warnings.push(`Supplier "${supplier}" is not in the ERP; the heat is saved without a supplier`);
      }
      const received = dateOf(r.cell('receivedDate'), ctx.date1904);
      if (received === 'bad') o.problems.push(`Received date: "${r.text('receivedDate')}" is not a date (use dd-mm-yyyy)`);
      else if (received && received > today) o.problems.push('Received date is in the future');
      if (qty === undefined) o.problems.push('Quantity is empty');
      else if (Number.isNaN(qty)) o.problems.push(`Quantity: "${r.text('quantity')}" is not a number`);
      else if (qty <= 0) o.problems.push('Quantity must be more than 0');
      else if (qty >= 1e10) o.problems.push('Quantity is too big');
      const remarks = r.text('remarks').replace(/\s+/g, ' ').slice(0, 450);
      if (o.problems.length || !rm || qty === undefined) continue;

      const amount = Math.round(qty * 1000) / 1000;
      o.notes.push(`${heatNo ? `New heat ${heatNo}` : 'New heat, number given automatically'} with ${qtyText(amount)} ${unit} in the RM store`);
      o.plan = async (run) => {
        const tx = run.tx;
        const receivedDate = received ? new Date(`${received}T00:00:00.000Z`) : null;
        const no =
          heatNo ||
          (await this.freshCode(tx, 'HEAT', (c) => tx.heat.findUnique({ where: { heatNo: c }, select: { id: true } }), {
            date: receivedDate ?? undefined,
            vars: { GRADE: rm.grade.heatCode ?? rm.grade.name.charAt(0) },
          }));
        const heat = await tx.heat.create({
          data: { heatNo: no, millHeatNo: millHeatNo || null, rawMaterialId: rm.id, supplierId, receivedDate, remarks: remarks || null },
        });
        await this.stock.post(tx, {
          kind: StockKind.RAW_MATERIAL,
          rawMaterialId: rm.id,
          heatId: heat.id,
          location: StockLocation.RM_STORE,
          quantity: amount,
          refType: StockRefType.OPENING,
          refId: heat.id,
          refNo: heat.heatNo,
          remarks: 'Opening stock (Excel import)',
          userId: run.actor.userId,
        });
        run.log(AuditAction.CREATE, 'heat', heat.id, `Created heat ${heat.heatNo} with opening stock ${qtyText(amount)} ${unit} (Excel import)`);
        return 'created';
      };
    }
    return { rows: out, willCreate: [] };
  }

  // ================================================================== opening stock: finished parts

  private async fgStock(rows: DataRow[], ctx: Ctx): Promise<Analysis> {
    const items = await ctx.db.item.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        uom: true,
        endConnection: true,
        product: { select: { id: true, code: true, name: true } },
        partType: { select: { id: true, name: true } },
      },
    });
    const heats = await ctx.db.heat.findMany({ select: { id: true, heatNo: true } });
    const opening = await ctx.db.stockLedger.groupBy({
      by: ['itemId'],
      where: { kind: StockKind.FINISHED_GOOD, refType: StockRefType.OPENING },
      _sum: { qtyIn: true },
    });
    const byCode = new Map(items.map((i) => [norm(i.code), i]));
    const heatBy = new Map(heats.map((h) => [norm(h.heatNo), h]));
    const openingOf = new Map(opening.map((o) => [o.itemId, o._sum.qtyIn?.toNumber() ?? 0]));
    const seen = new Map<string, number>();
    const out: Out[] = [];

    for (const r of rows) {
      const o = newOut(r.row);
      out.push(o);
      const itemCode = r.text('itemCode');
      const product = norm(r.text('product'));
      const part = norm(r.text('part'));
      const endText = r.text('end');
      const qty = numberOf(r.cell('quantity'));

      let item: (typeof items)[number] | undefined;
      if (itemCode) {
        item = byCode.get(norm(itemCode));
        if (!item) o.problems.push(`Item code ${itemCode} is not in the ERP`);
      } else if (!product || !part) {
        o.problems.push('Fill the item code, or Product and Part');
      } else {
        let found = items.filter((i) => (norm(i.product.name) === product || norm(i.product.code) === product) && norm(i.partType.name) === part);
        if (endText) {
          const end = choiceOf(endText, ['BW', 'THD', 'NONE'] as const) ?? (/^(-|na|n\/a|no|nil|blank)$/i.test(endText) ? 'NONE' : null);
          if (!end) o.problems.push(`End: "${endText}" should be BW, THD or None`);
          else found = found.filter((i) => i.endConnection === end);
        }
        if (o.problems.length) {
          /* already explained */
        } else if (found.length === 1) item = found[0];
        else if (!found.length) {
          const anyProduct = items.some((i) => norm(i.product.name) === product || norm(i.product.code) === product);
          o.problems.push(
            anyProduct
              ? `No item for ${r.text('part')}${endText ? ` ${endText}` : ''} of this product. Make the items on the product first (or fill "Make items for" in the products template).`
              : `Product "${r.text('product')}" has no items in the ERP. Import the product with "Make items for" filled, or make its items first.`,
          );
        } else o.problems.push(`This part has ${found.map((i) => (i.endConnection === 'NONE' ? 'no-end' : i.endConnection)).join(' and ')} items: fill the End column`);
      }

      const heatNo = norm(r.text('heatNo'));
      const heat = heatNo ? heatBy.get(heatNo) : undefined;
      if (heatNo && !heat) o.problems.push(`Heat ${heatNo} is not in the ERP. Leave it empty, or add the heat first.`);
      const unit = (item?.uom ?? 'PCS').toLowerCase();
      if (qty === undefined) o.problems.push('Quantity is empty');
      else if (Number.isNaN(qty)) o.problems.push(`Quantity: "${r.text('quantity')}" is not a number`);
      else if (qty <= 0) o.problems.push('Quantity must be more than 0');
      else if (qty >= 1e10) o.problems.push('Quantity is too big');
      else if (item && ['PCS', 'NOS', 'SET'].includes(item.uom) && !Number.isInteger(qty)) o.problems.push(`Quantity: ${item.uom.toLowerCase()} must be a whole number`);
      o.label = [item ? `${item.code} · ${item.name}` : itemCode || [r.text('product'), r.text('part'), endText].filter(Boolean).join(' '), heatNo, qty !== undefined && !Number.isNaN(qty) ? `${qtyText(qty)} ${unit}` : '']
        .filter(Boolean)
        .join(' · ');
      if (item) {
        const before = openingOf.get(item.id);
        if (before) o.warnings.push(`This item already has ${qtyText(before)} ${unit} opening stock in the ERP; this row adds more`);
        const key = `${item.id}:${heat?.id ?? 0}`;
        const twice = seen.get(key);
        if (twice) o.warnings.push(`Same item${heat ? ' and heat' : ''} as row ${twice}; both are added`);
        else seen.set(key, r.row);
      }
      const remarks = r.text('remarks').replace(/\s+/g, ' ').slice(0, 450);
      if (o.problems.length || !item || qty === undefined) continue;

      const amount = Math.round(qty * 1000) / 1000;
      const it = item;
      o.notes.push(`${qtyText(amount)} ${unit} into the FG store${heat ? `, heat ${heat.heatNo}` : ''}`);
      o.plan = async (run) => {
        await this.stock.post(run.tx, {
          kind: StockKind.FINISHED_GOOD,
          itemId: it.id,
          heatId: heat?.id ?? null,
          location: StockLocation.FG_STORE,
          quantity: amount,
          refType: StockRefType.OPENING,
          refNo: 'OPENING',
          remarks: remarks ? `Opening stock (Excel import): ${remarks}` : 'Opening stock (Excel import)',
          userId: run.actor.userId,
        });
        run.log(AuditAction.CREATE, 'stock', it.id, `Opening stock ${qtyText(amount)} ${unit} of ${it.name}${heat ? ` (heat ${heat.heatNo})` : ''} (Excel import)`);
        return 'created';
      };
    }
    return { rows: out, willCreate: [] };
  }
}
