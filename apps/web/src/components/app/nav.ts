import {
  ArrowLeftRight,
  Boxes,
  Banknote,
  CalendarClock,
  CalendarDays,
  Contact,
  FileSearch,
  FingerprintPattern,
  FireExtinguisher,
  HandCoins,
  Wallet,
  Gauge,
  Hourglass,
  Receipt,
  ShoppingBag,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Cpu,
  FileSignature,
  FileText,
  PackagePlus,
  Component,
  Factory,
  Flame,
  Hammer,
  Handshake,
  Hash,
  KeyRound,
  Inbox,
  Landmark,
  LayoutDashboard,
  MessagesSquare,
  type LucideIcon,
  Package,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  Route,
  ShoppingCart,
  Warehouse,
  ScrollText,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { DELIVERED_PHASE, MODULES, type ModuleCategory } from '@bht/shared';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown when the user has this permission. */
  permission: string;
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Screens that exist today. New phases add their screens here. */
export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { label: 'Chat', href: '/chat', icon: MessagesSquare, permission: 'chat.view', keywords: 'message talk group colleague whatsapp' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Sales Orders', href: '/sales/orders', icon: FileSignature, permission: 'sales_orders.view', keywords: 'so customer po order approval feasibility design stock check' },
    ],
  },
  {
    label: 'Production',
    items: [
      { label: 'Production Requests', href: '/production/requests', icon: Cpu, permission: 'stock_check.view', keywords: 'shortage make to stock mts planning' },
      { label: 'Route Cards', href: '/production/route-cards', icon: Route, permission: 'route_cards.view', keywords: 'rc job card stage forging machining pdi rejection traveler' },
    ],
  },
  {
    label: 'Job Work',
    items: [
      { label: 'Job Work Orders', href: '/job-work/orders', icon: Handshake, permission: 'job_work_orders.view', keywords: 'jwo outsource vendor job worker challan' },
      { label: 'Job Work Receipts', href: '/job-work/receipts', icon: PackageSearch, permission: 'job_work_receipts.view', keywords: 'vendor parts back qc inspection outsource' },
    ],
  },
  {
    label: 'Dispatch & Billing',
    items: [
      { label: 'Packing', href: '/dispatch/packing', icon: PackagePlus, permission: 'assemblies.view', keywords: 'assembly pack sets box heat' },
      { label: 'Invoices', href: '/billing/invoices', icon: FileText, permission: 'invoices.view', keywords: 'tax invoice gst export bill' },
      { label: 'Dispatches', href: '/dispatch/dispatches', icon: Truck, permission: 'dispatches.view', keywords: 'transport lr vehicle challan packing list' },
      { label: 'Payments', href: '/billing/payments', icon: Banknote, permission: 'payments.view', keywords: 'receipt money outstanding due receivable payable' },
    ],
  },
  {
    label: 'Purchase',
    items: [
      { label: 'Requisitions', href: '/purchase/requisitions', icon: ClipboardList, permission: 'purchase_requisitions.view', keywords: 'pr indent material request reorder' },
      { label: 'Purchase Orders', href: '/purchase/orders', icon: ShoppingCart, permission: 'purchase_orders.view', keywords: 'po supplier order pdf email' },
    ],
  },
  {
    label: 'Store',
    items: [
      { label: 'Gate Entry', href: '/store/gate-entry', icon: PackageCheck, permission: 'goods_receipts.view', keywords: 'grn inward receipt challan vehicle' },
      { label: 'Material Issue', href: '/store/material-issue', icon: PackageOpen, permission: 'material_issues.view', keywords: 'mr requisition issue heat bar return' },
      { label: 'Finished Parts In', href: '/store/rc-completion', icon: Inbox, permission: 'rc_completions.view', keywords: 'rc completion slip fg stock pdi move' },
      { label: 'Stock & Ledger', href: '/store/stock', icon: Warehouse, permission: 'stock.view', keywords: 'inventory balance heat adjustment ledger csv' },
    ],
  },
  {
    label: 'Quality',
    items: [
      { label: 'Incoming QC', href: '/quality/incoming-qc', icon: ClipboardCheck, permission: 'incoming_qc.view', keywords: 'inspection accept reject mtc' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Traceability', href: '/reports/traceability', icon: FileSearch, permission: 'traceability.view', keywords: 'heat mill mtc trace customer order certificate' },
      { label: 'Stock Movement', href: '/reports/stock', icon: ArrowLeftRight, permission: 'reports.view', keywords: 'opening closing in out inventory period' },
      { label: 'Production & Rejections', href: '/reports/production', icon: Gauge, permission: 'reports.view', keywords: 'output rejection reason stage scrap job work vendor' },
      { label: 'Pending Orders', href: '/reports/pending-orders', icon: CalendarClock, permission: 'reports.view', keywords: 'order book backlog due late dispatch' },
      { label: 'Sales & GST', href: '/reports/sales', icon: Receipt, permission: 'business_reports.view', keywords: 'sales register gstr cgst sgst igst customer month' },
      { label: 'Purchases', href: '/reports/purchases', icon: ShoppingBag, permission: 'business_reports.view', keywords: 'purchase register supplier po' },
      { label: 'Ageing', href: '/reports/ageing', icon: Hourglass, permission: 'business_reports.view', keywords: 'receivable payable outstanding overdue days' },
    ],
  },
  {
    label: 'HR & Payroll',
    items: [
      { label: 'Employees', href: '/hr/employees', icon: Contact, permission: 'employees.view', keywords: 'staff worker emp code department salary bank uan' },
      { label: 'Attendance', href: '/hr/attendance', icon: FingerprintPattern, permission: 'attendance.view', keywords: 'punch biometric machine in out hours present absent import csv' },
      { label: 'Leaves', href: '/hr/leaves', icon: CalendarDays, permission: 'leaves.view', keywords: 'cl sl el lwp leave balance holiday approve' },
      { label: 'Loans & Advances', href: '/hr/loans', icon: HandCoins, permission: 'loans.view', keywords: 'advance loan emi repay balance' },
      { label: 'Payroll', href: '/hr/payroll', icon: Wallet, permission: 'payroll.view', keywords: 'salary payslip pf net pay bank month finalize' },
      { label: 'Assets & Safety', href: '/hr/assets', icon: FireExtinguisher, permission: 'assets.view', keywords: 'laptop mobile asset fire extinguisher safety inspection due' },
    ],
  },
  {
    label: 'Masters',
    items: [
      { label: 'Customers', href: '/masters/customers', icon: Building2, permission: 'customers.view', keywords: 'client party buyer' },
      { label: 'Suppliers & Vendors', href: '/masters/suppliers', icon: Truck, permission: 'suppliers.view', keywords: 'vendor job work party' },
      { label: 'Products & BOM', href: '/masters/products', icon: Package, permission: 'products.view', keywords: 'hammer union fig category part type bom' },
      { label: 'Items (Parts)', href: '/masters/items', icon: Component, permission: 'items.view', keywords: 'male female nut finished goods fg' },
      { label: 'Raw Materials', href: '/masters/raw-materials', icon: Boxes, permission: 'raw_materials.view', keywords: 'rm grade bar size a105 4130' },
      { label: 'Heat Numbers', href: '/masters/heats', icon: Flame, permission: 'heats.view', keywords: 'heat mill mtc traceability' },
      { label: 'Process Stages', href: '/masters/process-stages', icon: Factory, permission: 'process_stages.view', keywords: 'route card forging machining pdi' },
      { label: 'Tools & Dies', href: '/masters/tools', icon: Hammer, permission: 'tools.view', keywords: 'die fixture gauge' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Users', href: '/admin/users', icon: Users, permission: 'users.view' },
      { label: 'Roles & Permissions', href: '/admin/roles', icon: ShieldCheck, permission: 'roles.view' },
      { label: 'Companies', href: '/admin/companies', icon: Landmark, permission: 'settings.view', keywords: 'gstin bank address entity' },
      { label: 'Number Series', href: '/admin/number-series', icon: Hash, permission: 'settings.view', keywords: 'document number format prefix' },
      { label: 'Audit Log', href: '/admin/audit-log', icon: ScrollText, permission: 'audit_log.view', keywords: 'history who changed' },
    ],
  },
];

export const ACCOUNT_NAV: NavItem = { label: 'Change password', href: '/account', icon: KeyRound, permission: '', keywords: 'password account security' };
export const SETTINGS_NAV: NavItem = { label: 'Settings', href: '/settings', icon: Cog, permission: '', keywords: 'font theme dark light colour color photo avatar picture profile start page size preferences appearance' };

/** Modules planned for later phases, grouped for the roadmap card. */
export function upcomingModules(): { category: ModuleCategory; phase: number; labels: string[] }[] {
  const groups = new Map<string, { category: ModuleCategory; phase: number; labels: string[] }>();
  for (const m of MODULES) {
    if (m.phase <= DELIVERED_PHASE) continue;
    const key = `${m.phase}:${m.category}`;
    if (!groups.has(key)) groups.set(key, { category: m.category, phase: m.phase, labels: [] });
    groups.get(key)!.labels.push(m.label);
  }
  return [...groups.values()].sort((a, b) => a.phase - b.phase);
}
