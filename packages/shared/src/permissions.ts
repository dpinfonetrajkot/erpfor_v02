/**
 * Single source of truth for ERP modules and their permissions.
 *
 * A permission is "<module>.<action>", e.g. "customers.create".
 * The API checks these on every endpoint and the web app uses them to
 * show / hide menu items and buttons.
 *
 * `phase` is the rebuild phase in which the module's screens are delivered.
 * Modules from later phases are listed already so roles can be prepared,
 * and the UI marks them as "coming soon".
 */

export const ACTIONS = {
  view: 'View',
  create: 'Create',
  update: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
  issue: 'Issue',
  export: 'Export',
} as const;

export type Action = keyof typeof ACTIONS;

export interface ModuleDef {
  key: string;
  label: string;
  category: ModuleCategory;
  actions: readonly Action[];
  phase: number;
}

export const MODULE_CATEGORIES = [
  'Admin',
  'Masters',
  'Sales',
  'Purchase',
  'Store',
  'Production',
  'Quality',
  'Job Work',
  'Dispatch & Billing',
  'Reports',
  'HR & Payroll',
  'Communication',
] as const;

export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

const CRUD = ['view', 'create', 'update', 'delete'] as const;

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', category: 'Admin', actions: ['view'], phase: 1 },
  { key: 'users', label: 'Users', category: 'Admin', actions: CRUD, phase: 1 },
  { key: 'roles', label: 'Roles & Permissions', category: 'Admin', actions: CRUD, phase: 1 },
  { key: 'settings', label: 'Company & Settings', category: 'Admin', actions: ['view', 'update'], phase: 1 },
  { key: 'audit_log', label: 'Audit Log', category: 'Admin', actions: ['view'], phase: 1 },

  { key: 'customers', label: 'Customers', category: 'Masters', actions: [...CRUD, 'export'], phase: 1 },
  { key: 'suppliers', label: 'Suppliers & Vendors', category: 'Masters', actions: [...CRUD, 'export'], phase: 1 },
  { key: 'products', label: 'Products, Parts & BOM', category: 'Masters', actions: CRUD, phase: 1 },
  { key: 'items', label: 'Items (Finished Parts)', category: 'Masters', actions: CRUD, phase: 1 },
  { key: 'raw_materials', label: 'Raw Materials & Grades', category: 'Masters', actions: CRUD, phase: 1 },
  { key: 'heats', label: 'Heat Numbers', category: 'Masters', actions: CRUD, phase: 1 },
  { key: 'process_stages', label: 'Process Stages', category: 'Masters', actions: CRUD, phase: 1 },
  { key: 'tools', label: 'Tools & Dies', category: 'Masters', actions: CRUD, phase: 1 },

  { key: 'purchase_requisitions', label: 'Purchase Requisitions', category: 'Purchase', actions: CRUD, phase: 2 },
  { key: 'purchase_orders', label: 'Purchase Orders', category: 'Purchase', actions: [...CRUD, 'approve'], phase: 2 },
  { key: 'goods_receipts', label: 'Gate Entry (GRN)', category: 'Purchase', actions: CRUD, phase: 2 },
  { key: 'incoming_qc', label: 'Incoming QC', category: 'Quality', actions: ['view', 'update', 'approve'], phase: 2 },
  { key: 'stock', label: 'Stock & Ledger', category: 'Store', actions: ['view', 'create', 'export'], phase: 2 },

  { key: 'sales_orders', label: 'Sales Orders', category: 'Sales', actions: CRUD, phase: 3 },
  { key: 'so_feasibility', label: 'SO feasibility check (in-house / outsource)', category: 'Sales', actions: ['approve'], phase: 3 },
  { key: 'so_design', label: 'SO design approval', category: 'Sales', actions: ['approve'], phase: 3 },
  { key: 'so_production', label: 'SO production approval', category: 'Sales', actions: ['approve'], phase: 3 },
  { key: 'stock_check', label: 'Stock check & production requests', category: 'Sales', actions: ['view', 'create'], phase: 3 },

  { key: 'route_cards', label: 'Route Cards', category: 'Production', actions: CRUD, phase: 4 },
  { key: 'route_card_operations', label: 'Route Card Stages', category: 'Production', actions: ['view', 'update'], phase: 4 },
  { key: 'material_requisitions', label: 'Material Requisitions', category: 'Production', actions: CRUD, phase: 4 },
  { key: 'material_issues', label: 'Material Issue', category: 'Store', actions: ['view', 'issue'], phase: 4 },
  { key: 'rc_completions', label: 'RC Completion → FG Stock', category: 'Store', actions: ['view', 'create'], phase: 4 },

  { key: 'job_work_orders', label: 'Job Work Orders', category: 'Job Work', actions: CRUD, phase: 5 },
  { key: 'job_work_receipts', label: 'Job Work Receipt & QC', category: 'Job Work', actions: CRUD, phase: 5 },

  { key: 'assemblies', label: 'Assembly & Packing', category: 'Dispatch & Billing', actions: CRUD, phase: 6 },
  { key: 'invoices', label: 'Invoices', category: 'Dispatch & Billing', actions: [...CRUD, 'approve'], phase: 6 },
  { key: 'dispatches', label: 'Dispatch', category: 'Dispatch & Billing', actions: CRUD, phase: 6 },
  { key: 'payments', label: 'Payments', category: 'Dispatch & Billing', actions: CRUD, phase: 6 },
  { key: 'tally', label: 'Tally export (sales, purchases, payments)', category: 'Dispatch & Billing', actions: ['export'], phase: 11 },

  { key: 'traceability', label: 'Heat & Order Traceability', category: 'Reports', actions: ['view', 'export'], phase: 7 },
  { key: 'reports', label: 'Stock, Production & Order Reports', category: 'Reports', actions: ['view', 'export'], phase: 7 },
  { key: 'business_reports', label: 'Sales, Purchase & Money Reports', category: 'Reports', actions: ['view', 'export'], phase: 7 },

  { key: 'employees', label: 'Employees', category: 'HR & Payroll', actions: CRUD, phase: 8 },
  { key: 'attendance', label: 'Attendance', category: 'HR & Payroll', actions: [...CRUD, 'approve'], phase: 8 },
  { key: 'leaves', label: 'Leave Management', category: 'HR & Payroll', actions: [...CRUD, 'approve'], phase: 8 },
  { key: 'loans', label: 'Loans & Advances', category: 'HR & Payroll', actions: CRUD, phase: 8 },
  { key: 'payroll', label: 'Payroll', category: 'HR & Payroll', actions: [...CRUD, 'approve'], phase: 8 },
  { key: 'assets', label: 'Company & Safety Assets', category: 'HR & Payroll', actions: CRUD, phase: 8 },

  // answers only with data the user may already see
  { key: 'assistant', label: 'Ask ERP (questions in plain words)', category: 'Reports', actions: ['view'], phase: 9 },

  // everyone gets their own bell notifications; sending a notice to others needs notifications.create
  { key: 'chat', label: 'Chat with colleagues (and groups)', category: 'Communication', actions: ['view'], phase: 10 },
  { key: 'notifications', label: 'Send notices to staff', category: 'Communication', actions: ['create'], phase: 10 },
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof MODULES)[number]['key'];

/** Modules up to this phase have screens; later ones are shown as "coming". */
export const DELIVERED_PHASE = 11;

/** Every valid permission string. */
export const ALL_PERMISSIONS: string[] = MODULES.flatMap((m) =>
  m.actions.map((a) => `${m.key}.${a}`),
);

/** Granted to the built-in Admin role: matches every permission. */
export const WILDCARD_PERMISSION = '*';

export function permissionKey(module: ModuleKey, action: Action): string {
  return `${module}.${action}`;
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.includes(WILDCARD_PERMISSION) || granted.includes(required);
}

export function isValidPermission(p: string): boolean {
  return p === WILDCARD_PERMISSION || ALL_PERMISSIONS.includes(p);
}
