/**
 * Imports master data + opening stock from the OLD ERP database into the new one.
 *
 *   pnpm import:legacy -- --dump "D:/bhterp_v2/u438199786_bht (3).sql" --dry-run
 *   pnpm import:legacy -- --dump "D:/bhterp_v2/u438199786_bht (3).sql"
 *
 * --dump     loads the phpMyAdmin .sql file into the scratch database LEGACY_DATABASE_URL first
 *            (its tables there are dropped and re-created every time).
 * --dry-run  does everything inside a transaction, prints the report, then rolls back.
 *
 * Imported: users (old passwords keep working), customers, part types, products + BOM,
 * items, material grades, raw materials, heats with opening RM stock, opening FG stock,
 * tools, employees, salary advances / loans (with what is still to repay) and attendance punches.
 * Old transactions (orders, POs, route cards ...) are NOT imported.
 * Safe to run again: records that already exist are skipped.
 */
import 'dotenv/config';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import {
  EndConnection,
  Gender,
  MaterialShape,
  PaymentMode,
  PrismaClient,
  StockKind,
  StockLocation,
  StockRefType,
  ToolStatus,
  ToolType,
} from '../src/generated/prisma/client';
import { createAdapter } from '../src/prisma/create-adapter';
import { NumberingService } from '../src/core/numbering.service';
import { StockService } from '../src/core/stock.service';
import type { PrismaService, Tx } from '../src/prisma/prisma.service';
import { itemName } from '../src/masters/item-name';
import { pairHours } from '@bht/shared';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dumpIndex = args.indexOf('--dump');
const DUMP = dumpIndex >= 0 ? args[dumpIndex + 1] : undefined;

const prisma = new PrismaClient({ adapter: createAdapter(process.env.DATABASE_URL!) });
const numbering = new NumberingService(prisma as unknown as PrismaService);
const stock = new StockService();

// ------------------------------------------------------------------ report

const report: Record<string, string[]> = {};
const counts: Record<string, number> = {};
function note(section: string, line: string) {
  const list = (report[section] ??= []);
  if (!list.includes(line)) list.push(line);
}
function count(key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

class DryRunRollback extends Error {}

// ------------------------------------------------------------- legacy access

async function loadDump(conn: mysql.Connection, file: string) {
  let sql = readFileSync(file, 'utf8');
  // MySQL 8 does not know MariaDB 11's uca1400 collations.
  sql = sql.replace(/utf8mb4_uca1400_ai_ci/g, 'utf8mb4_unicode_ci');
  const [tables] = await conn.query<RowDataPacket[]>('SHOW TABLES');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await conn.query(`DROP TABLE \`${Object.values(t)[0] as string}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  await conn.query(sql);
  console.log(`Loaded ${file} into the legacy scratch database.`);
}

async function rows<T = Record<string, any>>(conn: mysql.Connection, sql: string): Promise<T[]> {
  const [r] = await conn.query<RowDataPacket[]>(sql);
  return r as T[];
}

// --------------------------------------------------------------- cleaners

const s = (v: unknown) => (v == null ? '' : String(v).trim());
const orNull = (v: unknown) => s(v) || null;
const trimNum = (v: string) => String(parseFloat(v));

const ROLE_MAP: Record<string, string> = {
  admin: 'Admin',
  account: 'Accounts',
  designer: 'Design',
  dispatch: 'Dispatch',
  'final inspection': 'Final Inspection',
  'forge qc': 'Forge QC',
  forging: 'Forging',
  hr: 'HR',
  mr: 'MR',
  production: 'Production',
  qc: 'QC',
  sales: 'Sales',
  store: 'Store',
};

/** "AISI-4130" -> "4130", "ss-316" -> "SS316" */
export function normalizeGrade(raw: string): string {
  return s(raw)
    .toUpperCase()
    .replace(/^AISI[\s-]*/, '')
    .replace(/^SS[\s-]+(\d)/, 'SS$1');
}

const SHAPES: Record<string, MaterialShape> = {
  ROUND: 'ROUND', RD: 'ROUND', SQUARE: 'SQUARE', SQ: 'SQUARE', PIPE: 'PIPE', HEX: 'HEX', FLAT: 'FLAT', PLATE: 'PLATE',
};

/** "100X100MM SQUARE" / "100X100 SQUARE" / "100 X 100 MM SQ" -> "100X100 MM SQUARE" */
export function normalizeSize(raw: string): { size: string; shape: MaterialShape; sizeMm: number | null } {
  const text = s(raw).toUpperCase().replace(/\s+/g, ' ');
  const m = text.match(/^(\d+(?:\.\d+)?)\s*(?:MM)?\s*(?:X\s*(\d+(?:\.\d+)?)\s*(?:MM)?)?\s*(ROUND|RD|SQUARE|SQ|PIPE|HEX|FLAT|PLATE)$/);
  if (!m) return { size: text, shape: 'OTHER', sizeMm: null };
  const shape = SHAPES[m[3]];
  const dims = m[2] ? `${trimNum(m[1])}X${trimNum(m[2])}` : trimNum(m[1]);
  return { size: `${dims} MM ${shape}`, shape, sizeMm: parseFloat(m[1]) };
}

const EXCEL_DATE = /^\d{1,2}-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// --------------------------------------------------------------- importers

async function importUsers(tx: Tx, legacy: mysql.Connection) {
  const roles = new Map((await tx.role.findMany()).map((r) => [r.name.toLowerCase(), r.id]));
  for (const u of await rows(legacy, 'SELECT * FROM users ORDER BY id')) {
    const legacyRole = s(u.role).toLowerCase();
    const roleName = ROLE_MAP[legacyRole];
    const roleId = roleName ? roles.get(roleName.toLowerCase()) : undefined;
    const username = s(u.username).replace(/\s+/g, '.');
    if (!roleId) {
      note('Users', `SKIPPED ${u.username}: unknown role "${u.role}"`);
      continue;
    }
    if (await tx.user.findFirst({ where: { username } })) {
      note('Users', `skipped ${u.username}: a user "${username}" already exists`);
      continue;
    }
    await tx.user.create({
      data: {
        username,
        name: s(u.username),
        passwordHash: s(u.password),
        roleId,
        isActive: s(u.status) === 'active',
      },
    });
    count('users');
    if (username !== s(u.username)) note('Users', `"${u.username}" now signs in as "${username}" (no spaces allowed)`);
  }
}

async function importCustomers(tx: Tx, legacy: mysql.Connection) {
  const currencies = new Map(
    (await rows(legacy, 'SELECT customer_id, currency FROM customer_inquiries ORDER BY id')).map((r) => [Number(r.customer_id), s(r.currency)]),
  );
  for (const c of await rows(legacy, 'SELECT * FROM customers ORDER BY id')) {
    const name = s(c.company_name).toUpperCase();
    if (await tx.customer.findFirst({ where: { name } })) {
      note('Customers', `skipped ${name}: already exists`);
      continue;
    }
    const gstin = s(c.gstin).toUpperCase().replace(/\s/g, '') || null;
    if (gstin && !GSTIN.test(gstin)) note('Customers', `${name}: GSTIN "${gstin}" is not in the correct format - please check`);
    const address = orNull(c.address);
    const foreign = /\bUSA\b|UNITED STATES|U\.S\.A/i.test(address ?? '');
    const currency = (currencies.get(Number(c.id)) || (foreign ? 'USD' : 'INR')) as 'INR' | 'USD';
    await tx.customer.create({
      data: {
        code: await numbering.next('CUSTOMER', { tx }),
        name,
        phone: orNull(c.phone),
        email: orNull(c.email)?.toLowerCase() ?? null,
        address,
        contactPerson: orNull(c.handler_name),
        gstin,
        stateCode: gstin ? gstin.slice(0, 2) : null,
        country: foreign ? 'USA' : 'India',
        currency,
      },
    });
    count('customers');
  }
}

async function importProductsAndItems(tx: Tx, legacy: mysql.Connection) {
  const legacyItems = await rows(legacy, 'SELECT * FROM item_master ORDER BY id');
  const legacyParts = await rows(legacy, 'SELECT part_name FROM part_name_master');
  const categoriesFromOrders = new Map(
    (await rows(legacy, 'SELECT product_name, product_category FROM inquiry_products')).map((r) => [s(r.product_name).toUpperCase(), s(r.product_category).toUpperCase()]),
  );

  // Part types
  const partNames = new Set([...legacyParts.map((p) => s(p.part_name).toUpperCase()), ...legacyItems.map((i) => s(i.part_name).toUpperCase())]);
  for (const name of [...partNames].filter(Boolean)) {
    const hasEnd = legacyItems.some((i) => s(i.part_name).toUpperCase() === name && ['BW', 'THD'].includes(s(i.sub_category).toUpperCase()));
    const existing = await tx.partType.findUnique({ where: { name } });
    if (!existing) {
      await tx.partType.create({ data: { name, hasEndConnection: hasEnd } });
      count('part types');
    }
  }
  const partTypes = new Map((await tx.partType.findMany()).map((p) => [p.name, p]));

  // Products (one per legacy item name) with their BOM
  const itemMap = new Map<number, number>();
  const byProduct = new Map<string, typeof legacyItems>();
  for (const i of legacyItems) {
    const key = s(i.item_name).toUpperCase();
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(i);
  }

  for (const [productName, items] of byProduct) {
    const categoryName = s(items[0].product_category).toUpperCase() || categoriesFromOrders.get(productName) || 'HAMMER UNION';
    const category = await tx.productCategory.upsert({ where: { name: categoryName }, create: { name: categoryName }, update: {} });
    const parsed = productName.match(/^(\d+(?:\.\d+)?")\s*(FIG\s*[\d/]+)/);
    let product = await tx.product.findUnique({ where: { name: productName } });
    if (!product) {
      const parts = [...new Set(items.map((i) => s(i.part_name).toUpperCase()))].filter((p) => partTypes.has(p));
      product = await tx.product.create({
        data: {
          code: await numbering.next('PRODUCT', { tx }),
          name: productName,
          categoryId: category.id,
          size: parsed?.[1] ?? null,
          figure: parsed?.[2] ?? null,
          components: { create: parts.map((p) => ({ partTypeId: partTypes.get(p)!.id, quantity: 1 })) },
        },
      });
      count('products');
    }

    for (const i of items) {
      const partType = partTypes.get(s(i.part_name).toUpperCase());
      if (!partType) {
        note('Items', `SKIPPED ${i.item_code}: no part name`);
        continue;
      }
      const sub = s(i.sub_category).toUpperCase();
      const endConnection: EndConnection = partType.hasEndConnection && (sub === 'BW' || sub === 'THD') ? sub : 'NONE';
      const existing = await tx.item.findFirst({ where: { productId: product.id, partTypeId: partType.id, endConnection } });
      if (existing) {
        itemMap.set(Number(i.id), existing.id);
        continue;
      }
      const codeTaken = await tx.item.findUnique({ where: { code: s(i.item_code) } });
      const created = await tx.item.create({
        data: {
          code: codeTaken || !s(i.item_code) ? await numbering.next('ITEM', { tx }) : s(i.item_code),
          name: itemName(product.name, partType.name, endConnection),
          productId: product.id,
          partTypeId: partType.id,
          endConnection,
          uom: 'PCS',
          minPrice: Number(i.min_price) > 0 ? Number(i.min_price) : null,
        },
      });
      itemMap.set(Number(i.id), created.id);
      count('items');
    }
  }
  return itemMap;
}

async function importRawMaterialsAndHeats(tx: Tx, legacy: mysql.Connection, userId: number | null) {
  const legacyRm = await rows(legacy, 'SELECT * FROM raw_material_master ORDER BY id');

  // Grades (normalised), with the heat letter seen in the old heat numbers
  const letters = new Map<string, Set<string>>();
  for (const r of legacyRm) {
    const grade = normalizeGrade(r.material_grade);
    if (s(r.material_grade).toUpperCase() !== grade) note('Grades', `"${r.material_grade}" merged into ${grade}`);
    const letter = s(r.bht_heat_number).toUpperCase().match(/^([A-Z]+)\d/)?.[1];
    if (!letters.has(grade)) letters.set(grade, new Set());
    if (letter) letters.get(grade)!.add(letter);
  }
  for (const [name, set] of letters) {
    const existing = await tx.materialGrade.findUnique({ where: { name } });
    const heatCode = set.size === 1 ? [...set][0] : null;
    if (!existing) {
      await tx.materialGrade.create({ data: { name, heatCode } });
      count('material grades');
    } else if (!existing.heatCode && heatCode) {
      await tx.materialGrade.update({ where: { id: existing.id }, data: { heatCode } });
      note('Grades', `${name}: heat letter set to "${heatCode}" (as used in old heat numbers)`);
    }
    if (set.size > 1) note('Grades', `${name}: old heat numbers use several letters (${[...set].join(', ')}) - set the heat letter by hand`);
  }
  const grades = new Map((await tx.materialGrade.findMany()).map((g) => [g.name, g]));

  // New numbers for lots without one must come after every old number of that month.
  await bumpHeatCounters(tx, legacyRm.map((r) => s(r.bht_heat_number).toUpperCase()));

  for (const r of legacyRm) {
    const grade = grades.get(normalizeGrade(r.material_grade))!;
    const { size, shape, sizeMm } = normalizeSize(r.material_size);
    if (shape === 'OTHER') {
      note('Raw materials', `${r.material_code} "${r.material_size}": size could not be read - looks like a finished product, not bar stock. Please review.`);
    } else if (s(r.material_size).toUpperCase().replace(/\s+/g, ' ') !== size) {
      note('Raw materials', `${r.material_code} size "${r.material_size}" -> "${size}"`);
    }

    // Raw material = grade + size (several old rows become one)
    let rm = await tx.rawMaterial.findUnique({ where: { gradeId_size: { gradeId: grade.id, size } } });
    if (!rm) {
      const codeTaken = await tx.rawMaterial.findUnique({ where: { code: s(r.material_code) } });
      rm = await tx.rawMaterial.create({
        data: {
          code: codeTaken || !s(r.material_code) ? await numbering.next('RAW_MATERIAL', { tx }) : s(r.material_code),
          gradeId: grade.id,
          size,
          shape,
          sizeMm,
          uom: 'KG',
        },
      });
      count('raw materials');
    }

    // Heat. Each old row is tagged "[legacy RM-0012]" so a re-run recognises it.
    const tag = `[legacy ${s(r.material_code)}]`;
    const already = await tx.heat.findFirst({ where: { remarks: { contains: tag } } });
    if (already) continue;

    const millHeatNo = ['', 'NA', 'N/A', '-'].includes(s(r.mill_heat_number).toUpperCase()) ? null : s(r.mill_heat_number);
    if (millHeatNo && EXCEL_DATE.test(millHeatNo)) {
      note('Heats', `${r.material_code}: mill heat no. "${millHeatNo}" looks changed by Excel into a date - please check the MTC`);
    }
    const receivedDate = r.created_at ? new Date(r.created_at) : new Date();
    let heatNo = s(r.bht_heat_number).toUpperCase();
    let remarks = `Opening lot from old ERP ${tag}`;
    if (!heatNo || heatNo === 'N/A') {
      heatNo = await numbering.next('HEAT', { tx, date: receivedDate, vars: { GRADE: grade.heatCode ?? grade.name.charAt(0) } });
      remarks = `Old record had no BHT heat number; number given during import. ${tag}`;
      note('Heats', `${r.material_code} (${grade.name} ${size}) had no BHT heat no. -> given ${heatNo}`);
    }

    let heat = await tx.heat.findUnique({ where: { heatNo } });
    if (heat && heat.rawMaterialId === rm.id && (heat.millHeatNo ?? null) === millHeatNo) {
      // Same lot written twice in the old ERP: add the stock to the heat already made.
      await tx.heat.update({ where: { id: heat.id }, data: { remarks: `${heat.remarks ?? ''} ${tag}`.trim() } });
    } else if (heat) {
      // The old ERP reused one BHT heat number for a different lot; keep each lot separate.
      const original = heatNo;
      let n = 2;
      while (await tx.heat.findUnique({ where: { heatNo: `${original}-${n}` } })) n++;
      heatNo = `${original}-${n}`;
      remarks = `Old BHT heat no. ${original} was also used for another lot (mill heat ${heat.millHeatNo ?? '-'}). ${tag}`;
      note('Heats', `${original} was used for more than one lot -> this lot (mill heat ${millHeatNo ?? '-'}, ${grade.name} ${size}) is now ${heatNo}`);
      heat = null;
    }
    if (!heat) {
      heat = await tx.heat.create({
        data: { heatNo, millHeatNo, rawMaterialId: rm.id, receivedDate, remarks },
      });
      count('heats');
    }

    // Opening stock: each old row is posted once (rows already tagged were skipped above).
    const qty = Number(r.quantity) || 0;
    if (qty > 0) {
      if (qty >= 100_000) note('Stock', `${heat.heatNo}: opening stock ${qty} kg is very large - please verify`);
      await stock.post(tx, {
        kind: StockKind.RAW_MATERIAL,
        rawMaterialId: rm.id,
        heatId: heat.id,
        location: StockLocation.RM_STORE,
        quantity: qty,
        refType: StockRefType.OPENING,
        refId: heat.id,
        refNo: heat.heatNo,
        remarks: `Opening stock from old ERP (${r.material_code})`,
        date: new Date(),
        userId,
      });
      count('opening RM stock kg', qty);
    }
  }
}

async function importFinishedStock(tx: Tx, legacy: mysql.Connection, itemMap: Map<number, number>, userId: number | null) {
  for (const f of await rows(legacy, 'SELECT * FROM finished_goods_stock ORDER BY id')) {
    const itemId = itemMap.get(Number(f.item_id));
    const qty = Number(f.quantity_on_hand) || 0;
    if (!itemId) {
      if (qty > 0) note('Stock', `SKIPPED FG stock ${qty} pcs: old item id ${f.item_id} not found`);
      continue;
    }
    if (qty <= 0) continue;
    const already = await tx.stockLedger.findFirst({ where: { itemId, refType: StockRefType.OPENING } });
    if (already) continue;
    const heatNo = s(f.heat_number).toUpperCase();
    const heat = heatNo && heatNo !== 'N/A' ? await tx.heat.findUnique({ where: { heatNo } }) : null;
    if (heatNo && heatNo !== 'N/A' && !heat) note('Stock', `FG stock of item ${itemId}: heat ${heatNo} not found, stored without heat`);
    await stock.post(tx, {
      kind: StockKind.FINISHED_GOOD,
      itemId,
      heatId: heat?.id ?? null,
      location: StockLocation.FG_STORE,
      quantity: qty,
      refType: StockRefType.OPENING,
      remarks: 'Opening stock from old ERP',
      userId,
    });
    count('opening FG stock pcs', qty);
  }
}

async function importTools(tx: Tx, legacy: mysql.Connection) {
  const typeMap: Record<string, ToolType> = { DIE: 'DIE', TOOL: 'TOOL', FIXTURE: 'FIXTURE', GAUGE: 'GAUGE' };
  const statusMap: Record<string, ToolStatus> = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', 'UNDER MAINTENANCE': 'UNDER_MAINTENANCE' };
  for (const t of await rows(legacy, 'SELECT * FROM tools_dies ORDER BY id')) {
    const code = s(t.tool_code).toUpperCase();
    if (await tx.tool.findUnique({ where: { code } })) continue;
    await tx.tool.create({
      data: {
        code,
        name: s(t.tool_name),
        type: typeMap[s(t.tool_type).toUpperCase()] ?? 'TOOL',
        location: orNull(t.storage_location),
        purchaseDate: t.purchase_date ? new Date(t.purchase_date) : null,
        status: statusMap[s(t.status).toUpperCase()] ?? 'ACTIVE',
        description: orNull(t.description),
      },
    });
    count('tools');
  }
}

async function importEmployees(tx: Tx, legacy: mysql.Connection) {
  const genderMap: Record<string, Gender> = { MALE: 'MALE', FEMALE: 'FEMALE', OTHER: 'OTHER' };
  for (const e of await rows(legacy, 'SELECT * FROM employees ORDER BY id')) {
    const empCode = s(e.emp_code);
    if (!empCode) {
      note('Employees', `SKIPPED ${e.emp_name}: no employee code`);
      continue;
    }
    if (await tx.employee.findUnique({ where: { empCode } })) continue;
    await tx.employee.create({
      data: {
        empCode,
        name: s(e.emp_name).toUpperCase(),
        gender: genderMap[s(e.gender).toUpperCase()] ?? 'MALE',
        dateOfJoining: e.doj ? new Date(e.doj) : null,
        phone: orNull(e.emp_phone),
        email: orNull(e.emp_email)?.toLowerCase() ?? null,
        basicSalary: Number(e.basic_salary) || 0,
        ctc: e.ctc != null ? Number(e.ctc) : null,
        shiftHours: Number(e.shift_hours) || 8,
        isPfEligible: s(e.is_pf_eligible) === 'Yes',
      },
    });
    count('employees');
  }
}

/** Running and closed salary advances / loans with what is still to repay. */
async function importLoans(tx: Tx, legacy: mysql.Connection) {
  const modeMap: Record<string, PaymentMode> = { CASH: 'CASH', UPI: 'UPI', 'BANK TRANSFER': 'BANK_TRANSFER', BANK: 'BANK_TRANSFER', CHEQUE: 'CHEQUE' };
  for (const l of await rows(legacy, 'SELECT * FROM employee_loans ORDER BY id')) {
    const emp = await tx.employee.findUnique({ where: { empCode: s(l.emp_code) } });
    if (!emp) {
      note('Loans', `SKIPPED loan of code ${s(l.emp_code)}: no such employee`);
      continue;
    }
    const createdAt = l.created_at ? new Date(`${String(l.created_at).replace(' ', 'T')}+05:30`) : new Date();
    const amount = Number(l.total_loan_amount) || 0;
    // a loan imported earlier has the same employee, amount and time
    if (await tx.employeeLoan.findFirst({ where: { employeeId: emp.id, amount, createdAt } })) continue;
    const balance = Math.max(0, Number(l.remaining_balance) || 0);
    const emi = Number(l.emi_amount) || amount;
    const status = s(l.status).toUpperCase() === 'CLOSED' || balance <= 0 ? 'CLOSED' : s(l.status).toUpperCase() === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
    if (emi > amount) note('Loans', `${emp.empCode} ${emp.name}: EMI ${emi} is more than the loan ${amount} - the EMI taken will be the balance; check it`);
    const loan = await tx.employeeLoan.create({
      data: {
        employeeId: emp.id,
        type: /personal/i.test(s(l.loan_type)) ? 'PERSONAL_LOAN' : 'ADVANCE',
        amount,
        emiAmount: emi,
        balance,
        startMonth: /^\d{4}-\d{2}$/.test(s(l.start_month)) ? s(l.start_month) : createdAt.toISOString().slice(0, 7),
        disbursementMode: modeMap[s(l.disbursement_method).toUpperCase()] ?? 'OTHER',
        disbursementRef: orNull(l.disbursement_details),
        reason: orNull(l.loan_reason),
        status,
        createdAt,
      },
    });
    // the old ERP kept only the balance: one line for what was already paid back
    if (amount - balance > 0.005) {
      await tx.loanRepayment.create({ data: { loanId: loan.id, date: new Date(createdAt.toISOString().slice(0, 10) + 'T00:00:00Z'), amount: amount - balance, remarks: 'Paid back in the old ERP (before the import)' } });
    }
    count('loans');
  }
}

/** Machine punches per day (up to 6). Codes not in the employee list are kept for HR to sort out. */
async function importAttendance(tx: Tx, legacy: mysql.Connection) {
  const employees = new Map((await tx.employee.findMany({ select: { id: true, empCode: true } })).map((e) => [e.empCode, e.id]));
  for (const a of await rows(legacy, 'SELECT * FROM attendance_data ORDER BY punch_date, id')) {
    const empCode = s(a.emp_code);
    const day = s(a.punch_date).slice(0, 10);
    const punches = [a.punch1, a.punch2, a.punch3, a.punch4, a.punch5, a.punch6]
      .map((p) => s(p).slice(0, 5))
      .filter((p) => /^\d{2}:\d{2}$/.test(p) && p !== '00:00');
    if (!empCode || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !punches.length) continue;
    const date = new Date(`${day}T00:00:00Z`);
    const employeeId = employees.get(empCode) ?? null;
    await tx.attendancePunch.createMany({
      data: punches.map((t) => ({ empCode, employeeId, date, time: `${t}:00`, source: 'IMPORT' as const, applied: employeeId != null })),
      skipDuplicates: true,
    });
    if (!employeeId) {
      note('Attendance', `Punches of code ${empCode} kept aside: no employee with this code (add the employee and they are counted)`);
      continue;
    }
    if (await tx.attendance.findUnique({ where: { employeeId_date: { employeeId, date } } })) continue;
    const sorted = [...new Set(punches)].sort();
    const { hours } = pairHours(sorted);
    await tx.attendance.create({
      data: { employeeId, date, punches: sorted, inTime: sorted[0], outTime: sorted.length > 1 ? sorted[sorted.length - 1] : null, hoursWorked: hours, source: 'IMPORT' },
    });
    count('attendance days');
  }
}

async function setCounterAtLeast(tx: Tx, seriesCode: string, period: string, value: number) {
  if (value <= 0) return;
  const where = { seriesCode_period: { seriesCode, period } };
  const current = await tx.documentCounter.findUnique({ where });
  if (!current) await tx.documentCounter.create({ data: { seriesCode, period, lastNumber: value } });
  else if (current.lastNumber < value) await tx.documentCounter.update({ where, data: { lastNumber: value } });
}

/** Heat numbers look like <letters><MM><YY><seq>: continue each month's running number. */
async function bumpHeatCounters(tx: Tx, heatNos: string[]) {
  const perMonth = new Map<string, number>();
  for (const heatNo of heatNos) {
    const m = heatNo.match(/^[A-Z]+(\d{2})(\d{2})(\d{2})$/);
    if (!m) continue;
    const period = `M20${m[2]}${m[1]}`;
    perMonth.set(period, Math.max(perMonth.get(period) ?? 0, Number(m[3])));
  }
  for (const [period, n] of perMonth) await setCounterAtLeast(tx, 'HEAT', period, n);
}

/** Make sure new auto-numbers continue after the imported codes (no duplicates later). */
async function bumpCounters(tx: Tx) {
  const maxSuffix = (codes: string[], prefix: string) =>
    codes.reduce((max, c) => {
      const m = c.match(new RegExp(`^${prefix}(\\d+)$`));
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
  const setAtLeast = (seriesCode: string, period: string, value: number) => setCounterAtLeast(tx, seriesCode, period, value);
  await setAtLeast('ITEM', 'ALL', maxSuffix((await tx.item.findMany({ select: { code: true } })).map((i) => i.code), 'ITEM-'));
  await setAtLeast('RAW_MATERIAL', 'ALL', maxSuffix((await tx.rawMaterial.findMany({ select: { code: true } })).map((i) => i.code), 'RM-'));
  await setAtLeast('TOOL', 'ALL', maxSuffix((await tx.tool.findMany({ select: { code: true } })).map((i) => i.code), 'TL-'));
  await bumpHeatCounters(tx, (await tx.heat.findMany({ select: { heatNo: true } })).map((h) => h.heatNo));
}

// ---------------------------------------------------------------------- main

async function main() {
  const legacyUrl = process.env.LEGACY_DATABASE_URL;
  if (!legacyUrl) throw new Error('Set LEGACY_DATABASE_URL in .env');
  const legacy = await mysql.createConnection({ uri: legacyUrl, multipleStatements: true, dateStrings: true });

  try {
    if (DUMP) await loadDump(legacy, resolve(DUMP));
    const admin = await prisma.user.findFirst({ where: { role: { isSystem: true } }, orderBy: { id: 'asc' } });

    await prisma.$transaction(
      async (tx) => {
        await importUsers(tx, legacy);
        await importCustomers(tx, legacy);
        const itemMap = await importProductsAndItems(tx, legacy);
        await importRawMaterialsAndHeats(tx, legacy, admin?.id ?? null);
        await importFinishedStock(tx, legacy, itemMap, admin?.id ?? null);
        await importTools(tx, legacy);
        await importEmployees(tx, legacy);
        await importLoans(tx, legacy);
        await importAttendance(tx, legacy);
        await bumpCounters(tx);
        if (Object.keys(counts).length === 0) return;
        await tx.auditLog.create({
          data: {
            userId: admin?.id ?? null,
            action: 'CREATE',
            entity: 'import',
            summary: `Imported master data from the old ERP${DRY_RUN ? ' (dry run)' : ''}`,
            changes: counts,
          },
        });
        if (DRY_RUN) throw new DryRunRollback();
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  } finally {
    await legacy.end();
  }

  note('Not imported', 'Old transactions (sales orders, route cards, POs, gate entries, invoices, dispatches, payroll history) stay in the old database for reference. Stock was brought over as opening balances; loans with their balance still to repay.');

  const lines = [
    `# Legacy import report${DRY_RUN ? ' (DRY RUN - nothing was saved)' : ''}`,
    '',
    `Run at ${new Date().toISOString()}`,
    '',
    '## Imported',
    '',
    ...Object.entries(counts).map(([k, v]) => `- ${k}: ${Number.isInteger(v) ? v : v.toFixed(3)}`),
    '',
    ...Object.entries(report).flatMap(([section, items]) => [`## ${section}`, '', ...items.map((i) => `- ${i}`), '']),
  ];
  const text = lines.join('\n');
  console.log(`\n${text}`);
  const dir = resolve(__dirname, '../../../legacy');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `import-report-${Date.now()}.md`);
  writeFileSync(file, text);
  console.log(`Report saved to ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
