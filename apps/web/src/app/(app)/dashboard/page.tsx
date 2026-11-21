'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Component,
  Contact,
  Cpu,
  DraftingCompass,
  Factory,
  FileEdit,
  FileSignature,
  FileText,
  FingerprintPattern,
  FireExtinguisher,
  Flame,
  Handshake,
  IndianRupee,
  Inbox,
  Landmark,
  Lightbulb,
  Package,
  PackageOpen,
  PackagePlus,
  PackageSearch,
  Rocket,
  Route,
  Send,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { humanize, WORK_LISTS, workListText, type WorkListKey } from '@bht/shared';
import { useApiQuery } from '@/hooks/use-api';
import { fmtAgo, fmtQty } from '@/lib/format';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { BusinessDashboard, DashboardSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ColumnChart } from '@/components/reports/column-chart';
import { BarList, SegmentedBar } from '@/components/reports/mini-charts';
import { Badge, Card, CardDescription, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { upcomingModules } from '@/components/app/nav';
import { DeliveriesTable, MoneyStatus, PerformanceOverview } from '@/components/dashboard/overview-e';

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr = (v: number) => `₹${rupees.format(v)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pcs = (v: number) => `${fmtQty(v)} pcs`;
const kg = (v: number) => `${fmtQty(v)} kg`;
const monthLabel = (m: string) => {
  const d = parseISO(`${m}-01`);
  return { label: format(d, 'MMMM yyyy'), short: format(d, 'MMM') };
};
const SETUP_DISMISSED_KEY = 'erp.setup.dismissed';

export default function DashboardPage() {
  return (
    <RequirePermission permission="dashboard.view">
      <Dashboard />
    </RequirePermission>
  );
}

// ------------------------------------------------------------------ building blocks

/** A card with a title, a short description and an optional "view" link at the top right. */
function Panel({
  title,
  description,
  href,
  linkLabel = 'View all',
  icon: Icon,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  href?: string;
  linkLabel?: string;
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </div>
        {href && (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {linkLabel} <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      <div className="flex-1 px-5 pt-4 pb-5">{children}</div>
    </Card>
  );
}

function EmptyNote({ icon: Icon = CheckCircle2, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
      <Icon className="size-6 text-success" aria-hidden />
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ first steps (new installation)

const SETUP_STEPS: { key: keyof NonNullable<DashboardSummary['setup']>; title: string; text: string; href: string; icon: LucideIcon }[] = [
  { key: 'company', title: 'Company details', text: 'GSTIN, address and bank for invoices and POs', href: '/admin/companies', icon: Landmark },
  { key: 'users', title: 'Add your team', text: 'A login for each person, with their role', href: '/admin/users', icon: Users },
  { key: 'customers', title: 'Customers', text: 'Who you sell to', href: '/masters/customers', icon: Building2 },
  { key: 'suppliers', title: 'Suppliers & vendors', text: 'Material suppliers and job workers', href: '/masters/suppliers', icon: Truck },
  { key: 'products', title: 'Products & parts', text: 'What you make, with its bill of material', href: '/masters/products', icon: Package },
  { key: 'rawMaterials', title: 'Raw materials', text: 'Grades and sizes you buy', href: '/masters/raw-materials', icon: Boxes },
  { key: 'employees', title: 'Employees', text: 'For attendance and payroll', href: '/hr/employees', icon: Contact },
];

function SetupChecklist({ setup }: { setup: NonNullable<DashboardSummary['setup']> }) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(SETUP_DISMISSED_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);
  const done = SETUP_STEPS.filter((s) => setup[s.key]).length;
  if (dismissed || done === SETUP_STEPS.length) return null;
  const hide = () => {
    try {
      localStorage.setItem(SETUP_DISMISSED_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    setDismissed(true);
  };
  return (
    <Card className="relative mb-6 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent to-transparent" />
      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Rocket className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-[-0.01em]">Get your ERP ready</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {done} of {SETUP_STEPS.length} first steps done. Finish them and every screen fills with your own data.
          </p>
          <div className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${(done / SETUP_STEPS.length) * 100}%` }} />
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" onClick={hide} aria-label="Hide the first steps">
          <X />
        </Button>
      </div>
      <ol className="relative grid gap-px border-t bg-border sm:grid-cols-2 xl:grid-cols-4">
        {SETUP_STEPS.map((s) => {
          const ok = setup[s.key];
          return (
            <li key={s.key} className="bg-card">
              <Link href={s.href} className="group flex h-full items-start gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50">
                <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', ok ? 'bg-success text-white' : 'border-2 border-border')}>
                  {ok ? <Check className="size-3" strokeWidth={3} aria-label="Done" /> : <span className="sr-only">To do</span>}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-medium', ok && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.text}</span>
                </span>
                <ArrowRight className="ml-auto size-4 shrink-0 self-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </Link>
            </li>
          );
        })}
        <li className="flex items-start gap-3 bg-card px-5 py-3.5">
          <Lightbulb className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <span className="text-xs leading-relaxed text-muted-foreground">
            Stuck on a step? Click <span className="font-medium text-foreground">Ask ERP</span> at the top and type, for example, &ldquo;how do I add a customer&rdquo;.
          </span>
        </li>
      </ol>
    </Card>
  );
}

// ------------------------------------------------------------------ work waiting

type Task = { n: number | null; label: string; href: string; icon: LucideIcon; urgent?: boolean };

const TASK_ICONS: Record<WorkListKey, LucideIcon> = {
  overdueInvoices: Banknote,
  soFeasibility: Lightbulb,
  soDesign: DraftingCompass,
  soProduction: Factory,
  soToPlan: ClipboardList,
  rcAtMyStages: Route,
  productionRequests: Cpu,
  mrToIssue: PackageOpen,
  completionsToMove: Inbox,
  jwToPlan: Handshake,
  jwMaterialToSend: PackageOpen,
  jwToReceive: PackageSearch,
  toPack: PackagePlus,
  toInvoice: FileText,
  invoicesToIssue: FileEdit,
  toDispatch: Truck,
  poToApprove: FileEdit,
  prPending: ClipboardList,
  grnPendingQc: ClipboardCheck,
  poOpen: Send,
  leavesToApprove: CalendarDays,
  punchesToFix: AlertTriangle,
  unknownCodes: FingerprintPattern,
  devicesWaiting: FingerprintPattern,
  safetyDue: FireExtinguisher,
  payrollToPrepare: Wallet,
  draftPayrolls: Wallet,
};

/** The shared work lists (same names and links as Ask ERP) with this user's counts. */
function taskList(tasks: DashboardSummary['tasks']): Task[] {
  return WORK_LISTS.map((w) => ({
    n: tasks[w.key],
    ...workListText(w, tasks.payrollLastMonth),
    icon: TASK_ICONS[w.key],
    urgent: 'urgent' in w ? w.urgent : undefined,
  }));
}

const SHOW_FIRST = 7;

/** Only the queues with work in them, biggest first; the empty ones fold away. */
function NeedsAttention({ tasks, className }: { tasks: DashboardSummary['tasks']; className?: string }) {
  const [all, setAll] = useState(false);
  const mine = taskList(tasks).filter((t): t is Task & { n: number } => t.n !== null);
  if (!mine.length) return null;
  const open = mine.filter((t) => t.n > 0).sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || b.n - a.n);
  const clear = mine.filter((t) => t.n === 0);
  const shown = all ? [...open, ...clear] : open.slice(0, SHOW_FIRST);
  const hidden = all ? 0 : mine.length - shown.length;

  return (
    <Panel
      title="Needs your attention"
      icon={Inbox}
      description={open.length ? `${open.length} of ${mine.length} work lists have something waiting.` : 'Nothing is waiting for you.'}
      className={className}
    >
      {open.length === 0 && !all ? (
        <EmptyNote>
          <span className="font-medium text-foreground">All clear</span>
          <span className="text-xs">Every work list is empty right now.</span>
        </EmptyNote>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {shown.map((t) => (
            <li key={t.label}>
              <Link
                href={t.href}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                    t.n === 0 ? 'bg-muted text-muted-foreground' : t.urgent ? 'bg-destructive/10 text-destructive' : 'bg-accent text-accent-foreground',
                  )}
                >
                  <t.icon className="size-4" aria-hidden />
                </span>
                <span className={cn('min-w-0 flex-1 text-sm leading-snug', t.n === 0 && 'text-muted-foreground')}>{t.label}</span>
                <span
                  className={cn(
                    'tabular min-w-7 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold',
                    t.n === 0 ? 'text-muted-foreground' : t.urgent ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground',
                  )}
                >
                  {t.n}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(hidden > 0 || all) && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {all ? 'Show only lists with work' : `Show all ${mine.length} work lists (${clear.length} empty)`}
        </button>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ money

function SalesChart({ data, className }: { data: BusinessDashboard; className?: string }) {
  const total = data.months.reduce((s, m) => s + m.sales, 0);
  const got = data.months.reduce((s, m) => s + m.received, 0);
  return (
    <Panel
      title="Sales and money received"
      icon={IndianRupee}
      description={`Last 12 months: ${inr(total)} sales, ${inr(got)} received (invoice totals with GST; money by payment date).`}
      href="/reports/sales?view=month"
      linkLabel="Sales report"
      className={className}
    >
      <ColumnChart
        title="Sales and money received per month"
        series={[
          { label: 'Sales', color: 'var(--chart-1)' },
          { label: 'Received', color: 'var(--chart-2)' },
        ]}
        data={data.months.map((m) => ({ ...monthLabel(m.month), values: [m.sales, m.received] }))}
        format={inr}
        height={290}
      />
    </Panel>
  );
}

const AGE_COLORS = ['var(--age-1)', 'var(--age-2)', 'var(--age-3)', 'var(--age-4)', 'var(--age-5)'];

function ReceivableAgeing({ data, className }: { data: BusinessDashboard; className?: string }) {
  const parts = data.receivableAgeing.map((b, i) => ({ key: b.key, label: b.label, value: b.amount, color: AGE_COLORS[i] }));
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <Panel title="Money to receive, by age" icon={Clock} description="How long customer bills are past their due date." href="/reports/ageing" linkLabel="Ageing" className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="tabular text-[26px] leading-none font-semibold tracking-[-0.02em]">{inr(total)}</span>
        <span className="text-xs text-muted-foreground">{plural(data.receivable.documents, 'bill')}</span>
      </div>
      <SegmentedBar parts={parts} label="Money to receive by age" format={inr} />
      <ul className="mt-4 space-y-2.5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2.5 text-sm">
            <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{p.label}</span>
            <span className="tabular shrink-0 font-medium">{inr(p.value)}</span>
            <span className="tabular w-10 shrink-0 text-right text-xs text-muted-foreground">{total > 0 ? `${Math.round((p.value / total) * 100)}%` : '–'}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TopCustomers({ data, className }: { data: BusinessDashboard; className?: string }) {
  return (
    <Panel title="Top customers" icon={Building2} description={`FY ${data.fy}, invoice totals.`} href="/reports/sales?view=customer" linkLabel="All" className={className}>
      {data.topCustomers.length === 0 ? (
        <EmptyNote icon={Building2}>No sales this year yet.</EmptyNote>
      ) : (
        <BarList label="Top customers by sales" format={inr} rows={data.topCustomers.map((c) => ({ key: String(c.customer.id), label: c.customer.name, value: c.total }))} />
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ operations

const ORDER_STAGES: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved, to plan',
  IN_PRODUCTION: 'In production',
  PARTIALLY_DISPATCHED: 'Partly dispatched',
};

function OrdersByStage({ rows, className }: { rows: NonNullable<DashboardSummary['charts']['orders']>; className?: string }) {
  const total = rows.reduce((s, r) => s + r.orders, 0);
  return (
    <Panel title="Open sales orders" icon={FileSignature} description={`${plural(total, 'order')}, by stage.`} href="/sales/orders" linkLabel="Orders" className={className}>
      <BarList
        label="Open sales orders by stage"
        format={(v) => String(v)}
        rows={rows.map((r) => ({ key: r.status, label: ORDER_STAGES[r.status] ?? humanize(r.status), value: r.orders, href: `/sales/orders?status=${r.status}` }))}
      />
    </Panel>
  );
}

function ShopFloor({ rows, className }: { rows: NonNullable<DashboardSummary['wip']>; className?: string }) {
  const cards = rows.reduce((s, r) => s + r.cards, 0);
  return (
    <Panel title="Shop floor now" icon={Factory} description={`${plural(cards, 'open route card')}, by the stage each is at.`} href="/production/route-cards" linkLabel="Route cards" className={className}>
      {rows.length === 0 ? (
        <EmptyNote>No route cards on the floor.</EmptyNote>
      ) : (
        <BarList
          label="Open route cards by current stage"
          format={(v) => plural(v, 'card')}
          rows={rows.map((r) => ({ key: r.stage, label: r.stage, value: r.cards, valueText: `${plural(r.cards, 'card')} · ${fmtQty(r.pcs)} pcs` }))}
        />
      )}
    </Panel>
  );
}

function ProductionChart({ rows, className }: { rows: NonNullable<DashboardSummary['charts']['production']>; className?: string }) {
  const made = rows.reduce((s, r) => s + r.made, 0);
  const jw = rows.reduce((s, r) => s + r.jobWork, 0);
  return (
    <Panel
      title="Finished parts per month"
      icon={Component}
      description={`Last 12 months: ${fmtQty(made)} pcs made in the plant, ${fmtQty(jw)} pcs accepted from job work.`}
      href="/reports/production"
      linkLabel="Production report"
      className={className}
    >
      <ColumnChart
        title="Finished parts per month"
        series={[
          { label: 'Made in plant', color: 'var(--chart-1)' },
          { label: 'From job work', color: 'var(--chart-2)' },
        ]}
        data={rows.map((r) => ({ ...monthLabel(r.month), values: [r.made, r.jobWork] }))}
        format={pcs}
        tick={(v) => compact.format(v)}
        height={230}
      />
    </Panel>
  );
}

function StockByGrade({ rows, total, className }: { rows: NonNullable<DashboardSummary['charts']['rmByGrade']>; total: number; className?: string }) {
  return (
    <Panel title="Raw material in store" icon={Boxes} description={`${kg(total)} in the RM store, by grade.`} href="/store/stock" linkLabel="Stock" className={className}>
      {rows.length === 0 ? (
        <EmptyNote icon={Boxes}>No raw material in the store.</EmptyNote>
      ) : (
        <BarList label="Raw material in store by grade" format={kg} rows={rows.map((r) => ({ key: r.grade, label: r.grade, value: r.kg }))} />
      )}
    </Panel>
  );
}

function LowStock({ rows, className }: { rows: DashboardSummary['lowStock']; className?: string }) {
  return (
    <Panel title="Below reorder level" icon={AlertTriangle} description="Set a reorder level on a raw material to watch it here." href="/masters/raw-materials" linkLabel="Raw materials" className={className}>
      {rows.length ? (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5 text-sm first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">
                  {r.grade} · {r.size}
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {fmtQty(r.stock)} / {fmtQty(r.reorderLevel)} kg
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-warning" style={{ width: `${Math.min(100, Math.max(3, (r.stock / r.reorderLevel) * 100))}%` }} />
                </div>
                <Badge variant="warning" className="shrink-0">
                  <AlertTriangle aria-hidden /> Low
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>All raw materials are above their reorder level.</EmptyNote>
      )}
    </Panel>
  );
}

function RecentActivity({ rows, className }: { rows: DashboardSummary['recentActivity']; className?: string }) {
  return (
    <Panel title="Recent activity" icon={Clock} description="Latest changes made in the ERP." href="/admin/audit-log" linkLabel="Audit log" className={className}>
      {rows.length ? (
        <ol className="relative grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {rows.map((a) => (
            <li key={a.id} className="flex min-w-0 gap-3 text-sm">
              <span className="relative mt-1 flex size-2.5 shrink-0 items-center justify-center" aria-hidden>
                <span className="absolute size-2.5 rounded-full bg-primary/20" />
                <span className="size-1.5 rounded-full bg-primary" />
              </span>
              <div className="min-w-0">
                <div className="truncate">{a.summary ?? humanize(a.action)}</div>
                <div className="text-xs text-muted-foreground">
                  {a.user?.name ?? 'System'} · {fmtAgo(a.createdAt)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      )}
    </Panel>
  );
}

/** Small counts: stock, heats and masters. */
function AtAGlance({ data, className, asTiles }: { data: DashboardSummary | undefined; className?: string; asTiles?: boolean }) {
  const { can } = useSession();
  const tiles = [
    { label: 'Raw material in store', value: data?.stock.rawMaterialKg, unit: 'kg', icon: Boxes, href: '/store/stock', perm: 'stock.view' },
    { label: 'Finished parts in store', value: data?.stock.finishedGoodsPcs, unit: 'pcs', icon: Component, href: '/store/stock', perm: 'stock.view' },
    { label: 'Active heats', value: data?.counts.activeHeats, icon: Flame, href: '/masters/heats', perm: 'heats.view' },
    { label: 'Products', value: data?.counts.products, icon: Package, href: '/masters/products', perm: 'products.view' },
    { label: 'Customers', value: data?.counts.customers, icon: Building2, href: '/masters/customers', perm: 'customers.view' },
    { label: 'Suppliers & vendors', value: data?.counts.suppliers, icon: Truck, href: '/masters/suppliers', perm: 'suppliers.view' },
  ];
  const grid = (
    <div className={cn('grid gap-3', asTiles ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6' : 'grid-cols-2')}>
      {tiles.map((t) => {
        const body = (
          <div className={cn('flex h-full items-center gap-3 rounded-lg border bg-card p-3 transition-colors', can(t.perm) && 'group-hover:border-primary/30')}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <t.icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              {t.value === undefined ? (
                <Skeleton className="h-6 w-16" />
              ) : (
                <div className="flex items-baseline gap-1">
                  <span className="tabular text-lg leading-tight font-semibold tracking-[-0.01em]" title={fmtQty(t.value)}>
                    {compact.format(t.value)}
                  </span>
                  {t.unit && <span className="text-xs text-muted-foreground">{t.unit}</span>}
                </div>
              )}
              <div className="truncate text-xs leading-snug text-muted-foreground">{t.label}</div>
            </div>
          </div>
        );
        return can(t.perm) ? (
          <Link key={t.label} href={t.href} className="group block rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {body}
          </Link>
        ) : (
          <div key={t.label}>{body}</div>
        );
      })}
    </div>
  );
  if (asTiles) return <section aria-label="At a glance" className={className}>{grid}</section>;
  return (
    <Panel title="At a glance" icon={Package} description="Stock and master data." className={className}>
      {grid}
    </Panel>
  );
}

// ------------------------------------------------------------------ page

function Dashboard() {
  const { user, can } = useSession();
  const business = can('business_reports.view');
  const { data } = useApiQuery<DashboardSummary>('/dashboard/summary');
  const { data: money } = useApiQuery<BusinessDashboard>('/reports/dashboard', undefined, business);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const coming = upcomingModules();

  const waiting = data ? taskList(data.tasks).filter((t) => (t.n ?? 0) > 0).length : 0;
  const late = data?.dueOrders?.filter((o) => differenceInCalendarDays(parseISO(o.expectedDelivery), now) < 0).length ?? 0;

  const header = (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.025em] sm:text-[32px]">
          {greeting}, {user.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {format(now, 'EEEE, d MMMM yyyy')}
          {money ? ` · FY ${money.fy}` : ''}
        </p>
      </div>
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
          <Link href="#work" className={cn('glass inline-flex h-9 items-center gap-2 rounded-full px-4', !waiting && 'text-success')}>
            {waiting ? <Circle className="size-2.5 fill-primary text-primary" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
            {waiting ? `${plural(waiting, 'work list')} waiting for you` : 'Nothing waiting for you'}
          </Link>
          {late > 0 && (
            <Link href="/reports/pending-orders" className="inline-flex h-9 items-center gap-2 rounded-full bg-destructive px-4 text-destructive-foreground hover:opacity-90">
              <AlertTriangle className="size-4" aria-hidden /> {plural(late, 'order')} past delivery date
            </Link>
          )}
        </div>
      )}
    </div>
  );

  if (!data || (business && !money)) {
    return (
      <>
        {header}
        <Skeleton className="h-[420px] rounded-[28px]" />
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Skeleton className="h-80 rounded-[28px] lg:col-span-2" />
          <Skeleton className="h-80 rounded-[28px] lg:col-span-3" />
        </div>
      </>
    );
  }

  const { charts } = data;
  // Cards flow into a 3-column grid; a wide card takes 2 columns, gaps are filled by the next card that fits.
  const wide = 'lg:col-span-2';
  return (
    <>
      {header}
      {data.setup && <SetupChecklist setup={data.setup} />}

      <PerformanceOverview data={data} money={money} />

      {(money || data.dueOrders) && (
        <div className="mt-4 flex flex-wrap gap-4">
          {money && <MoneyStatus money={money} className="flex-[1_1_440px]" />}
          {data.dueOrders && <DeliveriesTable rows={data.dueOrders} className="flex-[1.35_1_560px] min-w-0" />}
        </div>
      )}

      {!money && <AtAGlance data={data} asTiles className="mt-4" />}

      <section aria-label="More" className="mt-4 grid grid-flow-row-dense grid-cols-1 gap-4 lg:grid-cols-3">
        {money ? <SalesChart data={money} className={wide} /> : charts.production && <ProductionChart rows={charts.production} className={wide} />}
        <NeedsAttention tasks={data.tasks} />
        {data.wip && <ShopFloor rows={data.wip} />}
        {charts.orders && <OrdersByStage rows={charts.orders} />}
        {money && charts.production && <ProductionChart rows={charts.production} className={wide} />}
        {money && <ReceivableAgeing data={money} />}
        {money && <TopCustomers data={money} />}
        {charts.rmByGrade && <StockByGrade rows={charts.rmByGrade} total={data.stock.rawMaterialKg} />}
        <LowStock rows={data.lowStock} />
        {can('audit_log.view') && <RecentActivity rows={data.recentActivity} className={wide} />}
        {money && <AtAGlance data={data} />}
        {coming.length > 0 && (
          <Panel title="Coming next" description="Modules being built, phase by phase.">
            <ol className="space-y-2.5">
              {coming.map((g) => (
                <li key={`${g.phase}-${g.category}`} className="flex gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{g.phase}</span>
                  <div>
                    <div className="font-medium">{g.category}</div>
                    <div className="text-xs text-muted-foreground">{g.labels.join(' · ')}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </section>
    </>
  );
}
