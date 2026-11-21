/**
 * Base data for a fresh database. Safe to run again: existing rows are kept.
 *   pnpm db:seed
 */
import 'dotenv/config';
import { WILDCARD_PERMISSION, ALL_PERMISSIONS, DELIVERED_PHASE, DOCUMENT_SERIES, MODULES } from '@bht/shared';
import { PrismaClient, ResetPeriod, StageType } from '../src/generated/prisma/client';
import { createAdapter } from '../src/prisma/create-adapter';
import { hashPassword } from '../src/auth/password';

const prisma = new PrismaClient({ adapter: createAdapter(process.env.DATABASE_URL!) });

/** Number formats. Heat numbers: grade letter + MM + YY + running no. (A102601). */
const SERIES: Record<keyof typeof DOCUMENT_SERIES, { template: string; reset: ResetPeriod }> = {
  CUSTOMER: { template: 'CUS-{SEQ:4}', reset: 'NEVER' },
  SUPPLIER: { template: 'SUP-{SEQ:4}', reset: 'NEVER' },
  PRODUCT: { template: 'PRD-{SEQ:4}', reset: 'NEVER' },
  ITEM: { template: 'ITEM-{SEQ:4}', reset: 'NEVER' },
  RAW_MATERIAL: { template: 'RM-{SEQ:4}', reset: 'NEVER' },
  HEAT: { template: '{GRADE}{MM}{YY}{SEQ:2}', reset: 'MONTHLY' },
  TOOL: { template: 'TL-{SEQ:4}', reset: 'NEVER' },
  SALES_ORDER: { template: 'SO/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  PRODUCTION_REQUEST: { template: 'PRQ/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  PURCHASE_REQUISITION: { template: 'PR/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  PURCHASE_ORDER: { template: 'PO/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  GOODS_RECEIPT: { template: 'GE/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  ROUTE_CARD: { template: 'RC/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  MATERIAL_REQUISITION: { template: 'MR/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  RC_COMPLETION: { template: 'RCC/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  JOB_WORK_ORDER: { template: 'JWO/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  JOB_WORK_RECEIPT: { template: 'JWR/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  ASSEMBLY: { template: 'ASM/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  // {CO} = company code: each billing company (GSTIN) has its own invoice series.
  INVOICE: { template: '{CO}/{FY}/{SEQ:3}', reset: 'FINANCIAL_YEAR' },
  EXPORT_INVOICE: { template: '{CO}/EXP/{FY}/{SEQ:3}', reset: 'FINANCIAL_YEAR' },
  DISPATCH: { template: 'DC/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
  PAYMENT: { template: 'PAY/{FY}/{SEQ:4}', reset: 'FINANCIAL_YEAR' },
};

const view = (...modules: string[]) => modules.map((m) => `${m}.view`);
const crud = (...modules: string[]) =>
  modules.flatMap((m) => ['view', 'create', 'update', 'delete'].map((a) => `${m}.${a}`));

/** The roles of the old ERP with a sensible starting set of permissions (edit in the app). */
const ROLES: { name: string; description: string; permissions: string[] }[] = [
  { name: 'Accounts', description: 'Purchase orders, invoices, payments', permissions: [
    'dashboard.view', ...view('customers', 'suppliers', 'products', 'items', 'raw_materials'),
    'customers.create', 'customers.update', 'suppliers.create', 'suppliers.update',
    'purchase_requisitions.view', 'goods_receipts.view', 'stock.view', 'job_work_orders.view', 'job_work_receipts.view',
    ...crud('purchase_orders', 'invoices', 'payments'), 'purchase_orders.approve', 'invoices.approve', 'reports.view',
    ...view('sales_orders', 'assemblies', 'dispatches'), 'reports.export', 'business_reports.view', 'business_reports.export', 'traceability.view',
    'payroll.view', 'loans.view'] },
  { name: 'Design', description: 'Drawing / design approval of sales orders', permissions: [
    'dashboard.view', ...view('products', 'items', 'sales_orders'), 'products.update', 'items.update', 'so_design.approve'] },
  { name: 'Dispatch', description: 'Assembly, packing and dispatch', permissions: [
    'dashboard.view', ...view('customers', 'items', 'sales_orders', 'stock', 'route_cards', 'route_card_operations'),
    'route_card_operations.update', ...crud('assemblies', 'dispatches'), 'invoices.view',
    'traceability.view', 'traceability.export', 'reports.view'] },
  { name: 'Final Inspection', description: 'PDI / final inspection', permissions: [
    'dashboard.view', ...view('items', 'heats', 'route_cards', 'route_card_operations', 'traceability'), 'route_card_operations.update',
    'traceability.export'] },
  { name: 'Forge QC', description: 'Forging inspection', permissions: [
    'dashboard.view', ...view('items', 'heats', 'route_cards', 'route_card_operations', 'traceability'), 'route_card_operations.update'] },
  { name: 'Forging', description: 'Testing, cutting, forging, heat treatment', permissions: [
    'dashboard.view', ...view('items', 'heats', 'raw_materials', 'route_cards', 'route_card_operations', 'tools', 'traceability'),
    'route_card_operations.update', 'material_requisitions.view', 'material_requisitions.create'] },
  { name: 'HR', description: 'Employees, attendance, leave, payroll', permissions: [
    'dashboard.view', ...crud('employees', 'attendance', 'leaves', 'loans', 'payroll', 'assets'),
    'attendance.approve', 'leaves.approve', 'payroll.approve'] },
  { name: 'MR', description: 'Management representative', permissions: [
    'dashboard.view', ...view('customers', 'suppliers', 'products', 'items', 'raw_materials', 'heats', 'sales_orders',
      'purchase_orders', 'route_cards', 'stock', 'stock_check', 'traceability', 'reports', 'job_work_orders', 'job_work_receipts', 'assemblies', 'invoices', 'dispatches', 'payments'),
    'business_reports.view', 'traceability.export', 'reports.export', 'business_reports.export',
    ...view('employees', 'attendance', 'assets')] },
  { name: 'Production', description: 'Planning, route cards, material requisition', permissions: [
    'dashboard.view', ...view('customers', 'products', 'items', 'raw_materials', 'heats', 'process_stages', 'tools',
      'sales_orders', 'stock', 'stock_check'),
    ...crud('route_cards', 'material_requisitions', 'job_work_orders'), 'job_work_receipts.view', 'route_card_operations.view', 'route_card_operations.update',
    'stock_check.create', 'so_feasibility.approve', 'so_production.approve',
    'traceability.view', 'traceability.export', 'reports.view', 'reports.export'] },
  { name: 'QC', description: 'Incoming, in-process and outsource QC', permissions: [
    'dashboard.view', ...view('suppliers', 'items', 'raw_materials', 'heats', 'goods_receipts', 'route_cards',
      'route_card_operations', 'job_work_receipts', 'traceability'),
    'incoming_qc.view', 'incoming_qc.update', 'incoming_qc.approve', 'heats.create', 'heats.update',
    'route_card_operations.update', 'job_work_orders.view', 'job_work_receipts.create', 'job_work_receipts.update',
    'traceability.export', 'reports.view'] },
  { name: 'Sales', description: 'Customers and sales orders', permissions: [
    'dashboard.view', ...crud('customers', 'sales_orders'), 'customers.export', ...view('products', 'items', 'stock_check', 'job_work_orders', 'assemblies', 'invoices', 'dispatches'),
    'traceability.view', 'traceability.export', 'reports.view'] },
  { name: 'Store', description: 'Gate entry, material issue, stock', permissions: [
    'dashboard.view', ...view('suppliers', 'items', 'raw_materials', 'heats', 'purchase_orders', 'route_cards', 'tools'),
    'raw_materials.create', 'raw_materials.update', 'heats.create', 'heats.update',
    ...crud('goods_receipts', 'purchase_requisitions'), 'stock.view', 'stock.create', 'stock.export',
    'material_issues.view', 'material_issues.issue', 'material_requisitions.view',
    'rc_completions.view', 'rc_completions.create', 'tools.create', 'tools.update',
    'job_work_orders.view', ...view('job_work_receipts'), 'job_work_receipts.create', 'job_work_receipts.update',
    'traceability.view', 'reports.view', 'reports.export'] },
];
// Everyone may ask the ERP (each answer still needs the permission of the screen it comes from) and chat;
// HR and the management representative may also send notices to staff.
for (const r of ROLES) r.permissions.push('assistant.view', 'chat.view', ...(['HR', 'MR'].includes(r.name) ? ['notifications.create'] : []));

/** The 16 stages of the old route card, with the roles that recorded them there. */
const STAGES: { code: string; name: string; type: StageType; weights?: boolean; report?: boolean; material?: boolean; roles: string[] }[] = [
  { code: 'chemical_testing', name: 'Chemical Testing', type: 'TEST', report: true, material: true, roles: ['Forging'] },
  { code: 'rm_inspection', name: 'RM Inspection', type: 'INSPECTION', material: true, roles: ['Forging'] },
  { code: 'ut', name: 'UT', type: 'TEST', material: true, roles: ['Forging'] },
  { code: 'cutting', name: 'Cutting', type: 'OPERATION', weights: true, roles: ['Forging'] },
  { code: 'forging', name: 'Forging', type: 'OPERATION', weights: true, roles: ['Forging'] },
  { code: 'forging_inspection', name: 'Forging Inspection', type: 'INSPECTION', roles: ['Forging', 'Forge QC'] },
  { code: 'heat_treatment', name: 'Heat Treatment', type: 'OPERATION', roles: ['Forging'] },
  { code: 'mechanical_testing', name: 'Mechanical Testing', type: 'TEST', report: true, roles: ['Forging'] },
  { code: 'shot_sand_blasting', name: 'Shot / Sand Blasting', type: 'OPERATION', roles: ['Forging'] },
  { code: 'hardness_testing', name: 'Hardness Testing', type: 'TEST', roles: ['Production'] },
  { code: 'machining', name: 'Machining', type: 'OPERATION', weights: true, roles: ['QC', 'Production'] },
  { code: 'mpi', name: 'MPI', type: 'TEST', roles: ['QC'] },
  { code: 'pressure_testing', name: 'Pressure Testing', type: 'TEST', roles: ['QC'] },
  { code: 'marking', name: 'Marking', type: 'OPERATION', roles: ['Dispatch'] },
  { code: 'painting_coating_plating', name: 'Painting / Coating / Plating', type: 'OPERATION', roles: ['Dispatch'] },
  { code: 'pdi', name: 'PDI (Pre-Dispatch Inspection)', type: 'INSPECTION', roles: ['QC', 'Final Inspection'] },
];

async function main() {
  // ------------------------------------------------------------ companies
  // A sample company. For a client, change it in Admin → Companies (name, address, GSTIN, bank) after the first login.
  const companies = [
    {
      code: 'DEMO',
      name: 'DEMO LTD',
      address: 'Plot No. 25, Demo Industrial Estate, Main Road',
      city: 'Rajkot', stateCode: '24', pincode: '360001',
      phone: '+91 98765 43210', email: 'info@example.com',
      gstin: '24AAAAA0000A1Z5', isDefault: true,
    },
  ];
  for (const c of companies) {
    await prisma.company.upsert({ where: { code: c.code }, create: c, update: {} });
  }

  // ------------------------------------------------------- number series
  for (const [code, s] of Object.entries(SERIES)) {
    await prisma.documentSeries.upsert({
      where: { code },
      create: { code, name: DOCUMENT_SERIES[code as keyof typeof DOCUMENT_SERIES], template: s.template, resetPeriod: s.reset },
      update: {},
    });
  }

  // ---------------------------------------------------------------- roles
  const admin = await prisma.role.upsert({
    where: { name: 'Admin' },
    create: { name: 'Admin', description: 'Full access to everything', isSystem: true },
    update: { isSystem: true },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permission: { roleId: admin.id, permission: WILDCARD_PERMISSION } },
    create: { roleId: admin.id, permission: WILDCARD_PERMISSION },
    update: {},
  });

  // Default roles are created once with all their permissions. When a later phase adds
  // modules, existing roles get only the permissions of the NEW modules, once, so changes
  // the admin made in the app are kept.
  const syncedSetting = await prisma.appSetting.findUnique({ where: { key: 'roles.synced_phase' } });
  const syncedPhase = Number(syncedSetting?.value ?? 1);
  const phaseOf = (permission: string) => MODULES.find((m) => m.key === permission.split('.')[0])?.phase ?? 0;

  const roleIds = new Map<string, number>([['Admin', admin.id]]);
  for (const r of ROLES) {
    const unknown = r.permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (unknown.length) throw new Error(`Role ${r.name}: unknown permissions ${unknown.join(', ')}`);
    const existing = await prisma.role.findUnique({ where: { name: r.name } });
    const role =
      existing ??
      (await prisma.role.create({
        data: {
          name: r.name,
          description: r.description,
          permissions: { create: [...new Set(r.permissions)].map((permission) => ({ permission })) },
        },
      }));
    if (existing && syncedPhase < DELIVERED_PHASE) {
      const added = [...new Set(r.permissions)].filter((p) => phaseOf(p) > syncedPhase);
      if (added.length) {
        const result = await prisma.rolePermission.createMany({
          data: added.map((permission) => ({ roleId: role.id, permission })),
          skipDuplicates: true,
        });
        if (result.count) console.log(`Role ${r.name}: added ${result.count} permission(s) for new modules`);
      }
    }
    roleIds.set(r.name, role.id);
  }

  // Permissions of modules that no longer exist grant nothing; remove them.
  const stale = await prisma.rolePermission.deleteMany({
    where: { permission: { notIn: [...ALL_PERMISSIONS, WILDCARD_PERMISSION] } },
  });
  if (stale.count) console.log(`Removed ${stale.count} outdated permission(s)`);
  await prisma.appSetting.upsert({
    where: { key: 'roles.synced_phase' },
    create: { key: 'roles.synced_phase', value: String(DELIVERED_PHASE) },
    update: { value: String(DELIVERED_PHASE) },
  });

  // ----------------------------------------------------------- admin user
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  if (!(await prisma.user.findUnique({ where: { username } }))) {
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!password) throw new Error('Set SEED_ADMIN_PASSWORD in .env');
    await prisma.user.create({
      data: { username, name: 'Administrator', roleId: admin.id, passwordHash: await hashPassword(password) },
    });
    console.log(`Created admin user "${username}" - change the password after first login.`);
  }

  // ------------------------------------------------------- process stages
  for (const [i, s] of STAGES.entries()) {
    const existing = await prisma.processStage.findUnique({ where: { code: s.code } });
    if (existing) continue;
    await prisma.processStage.create({
      data: {
        code: s.code,
        name: s.name,
        sequence: (i + 1) * 10,
        type: s.type,
        captureWeights: s.weights ?? false,
        requiresReport: s.report ?? false,
        isMaterialCheck: s.material ?? false,
        roles: { create: s.roles.map((name) => ({ roleId: roleIds.get(name)! })) },
      },
    });
  }

  // ------------------------------------------- product structure basics
  await prisma.productCategory.upsert({ where: { name: 'HAMMER UNION' }, create: { name: 'HAMMER UNION' }, update: {} });
  for (const [i, p] of [
    { name: 'MALE', hasEndConnection: true },
    { name: 'FEMALE', hasEndConnection: true },
    { name: 'NUT', hasEndConnection: false },
  ].entries()) {
    await prisma.partType.upsert({ where: { name: p.name }, create: { ...p, sortOrder: (i + 1) * 10 }, update: {} });
  }

  // Heat letters as seen in the old heat numbers (A105 -> A..., 4130 -> B..., SS304 -> E...).
  for (const g of [
    { name: 'A105', standard: 'ASTM A105', heatCode: 'A' },
    { name: '4130', standard: 'AISI 4130', heatCode: 'B' },
    { name: 'SS304', standard: 'ASTM A182 F304', heatCode: 'E' },
    { name: 'SS316', standard: 'ASTM A182 F316', heatCode: null },
    { name: 'MS', standard: 'Mild steel', heatCode: null },
  ]) {
    await prisma.materialGrade.upsert({ where: { name: g.name }, create: g, update: {} });
  }

  await prisma.appSetting.upsert({
    where: { key: 'payroll.month_days' },
    create: { key: 'payroll.month_days', value: '25' },
    update: {},
  });

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
