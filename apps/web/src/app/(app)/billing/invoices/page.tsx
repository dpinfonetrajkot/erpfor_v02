'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { useApiQuery, useLookups, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fmtDate, fmtMoney } from '@/lib/format';
import type { InvoiceRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, FileEdit, PackageCheck, Plus, ReceiptText, Wallet, type LucideIcon } from 'lucide-react';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useSession } from '@/components/app/session';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { BILLING_READERS } from '@/components/billing/billing-access';

const TABS: { label: string; filter: Record<string, string | undefined> }[] = [
  { label: 'Drafts', filter: { status: 'DRAFT', paymentStatus: undefined } },
  { label: 'Issued', filter: { status: 'ISSUED', paymentStatus: undefined } },
  { label: 'Payment due', filter: { status: undefined, paymentStatus: 'DUE' } },
  { label: 'Cancelled', filter: { status: 'CANCELLED', paymentStatus: undefined } },
  { label: 'All', filter: { status: undefined, paymentStatus: undefined } },
];

interface InvoiceSummary {
  thisMonth: { total: number; count: number };
  lastMonth: number;
  receivable: { total: number; bills: number };
  overdue: { total: number; bills: number };
  drafts: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Four figures above the list; each one opens the matching tab. Amounts in rupees. */
function SummaryStrip({ onFilter }: { onFilter: (f: Record<string, string | undefined>) => void }) {
  const { data } = useApiQuery<InvoiceSummary>('/invoices/summary');
  const tiles: { label: string; value: string; sub: string; icon: LucideIcon; tone?: 'bad' | 'muted'; filter: Record<string, string | undefined> }[] = data
    ? [
        {
          label: 'Invoiced this month',
          value: fmtMoney(data.thisMonth.total),
          sub: `${plural(data.thisMonth.count, 'invoice')} · last month ${fmtMoney(data.lastMonth)}`,
          icon: ReceiptText,
          filter: { status: undefined, paymentStatus: undefined },
        },
        {
          label: 'To receive',
          value: fmtMoney(data.receivable.total),
          sub: data.receivable.bills ? `${plural(data.receivable.bills, 'bill')} not fully paid` : 'Everything is paid',
          icon: Wallet,
          filter: { status: undefined, paymentStatus: 'DUE' },
        },
        {
          label: 'Overdue',
          value: fmtMoney(data.overdue.total),
          sub: data.overdue.bills ? `${plural(data.overdue.bills, 'bill')} past the due date` : 'Nothing overdue',
          icon: AlertTriangle,
          tone: data.overdue.bills ? 'bad' : 'muted',
          filter: { status: undefined, paymentStatus: 'DUE' },
        },
        {
          label: 'Drafts',
          value: String(data.drafts),
          sub: data.drafts ? 'Waiting to be checked and issued' : 'No drafts waiting',
          icon: FileEdit,
          filter: { status: 'DRAFT', paymentStatus: undefined },
        },
      ]
    : [];
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {!data
        ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)
        : tiles.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => onFilter(t.filter)}
              className="group rounded-lg border bg-card p-4 text-left transition-[border-color,box-shadow] hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-muted-foreground">{t.label}</span>
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-lg',
                    t.tone === 'bad' ? 'bg-destructive/10 text-destructive' : 'bg-accent text-accent-foreground',
                  )}
                >
                  <t.icon className="size-3.5" aria-hidden />
                </span>
              </div>
              <div className={cn('mt-1.5 text-xl font-semibold tracking-[-0.02em] tabular-nums', t.tone === 'bad' && 'text-destructive')}>{t.value}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{t.sub}</div>
            </button>
          ))}
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <RequirePermission permission={BILLING_READERS}>
      <Invoices />
    </RequirePermission>
  );
}

function Invoices() {
  const router = useRouter();
  const { can } = useSession();
  const params = useListParams();
  const lookups = useLookups('customers');
  const { data, isFetching } = usePaged<InvoiceRow>('/invoices', params.query);
  const today = new Date().toISOString().slice(0, 10);

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(
    () => [
      {
        header: 'Invoice',
        accessorKey: 'invoiceNo',
        meta: { sortKey: 'invoiceNo' },
        cell: ({ row }) => (
          <div>
            <Link href={`/billing/invoices/${row.original.id}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
              {row.original.status === 'DRAFT' ? 'Draft' : row.original.invoiceNo}
            </Link>
            <div className="text-xs text-muted-foreground">
              {fmtDate(row.original.invoiceDate)} · {row.original.company.code}
            </div>
          </div>
        ),
      },
      {
        header: 'Customer',
        id: 'customer',
        cell: ({ row }) => (
          <div className="min-w-44">
            <div className="font-medium">{row.original.billingName}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.salesOrder?.soNo}
              {row.original.type === 'EXPORT_INVOICE' && ' · export'}
            </div>
          </div>
        ),
      },
      {
        header: 'Amount',
        accessorKey: 'grandTotal',
        meta: { sortKey: 'grandTotal', align: 'right' },
        cell: ({ row }) => (
          <div className="text-right whitespace-nowrap">
            <div className="font-semibold">{fmtMoney(row.original.grandTotal, row.original.currency)}</div>
            {row.original.amountPaid > 0 && <div className="text-xs text-muted-foreground">{fmtMoney(row.original.amountPaid, row.original.currency)} received</div>}
          </div>
        ),
      },
      {
        header: 'Due',
        accessorKey: 'dueDate',
        meta: { sortKey: 'dueDate' },
        cell: ({ row }) => {
          const r = row.original;
          const late = r.status === 'ISSUED' && r.paymentStatus !== 'PAID' && r.dueDate && r.dueDate.slice(0, 10) < today;
          return <span className={cn('whitespace-nowrap', late && 'font-medium text-destructive')}>{fmtDate(r.dueDate)}{late && ' · overdue'}</span>;
        },
      },
      {
        header: 'Payment',
        id: 'pay',
        cell: ({ row }) => (row.original.status === 'ISSUED' ? <PaymentStatusBadge status={row.original.paymentStatus} /> : null),
      },
      {
        header: 'Dispatch',
        id: 'dispatch',
        cell: ({ row }) =>
          row.original.dispatches[0] ? (
            <span className="font-mono text-[13px]">{row.original.dispatches[0].dispatchNo}</span>
          ) : row.original.status === 'ISSUED' ? (
            <Badge variant="outline">Not yet</Badge>
          ) : null,
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} /> },
    ],
    [today],
  );

  return (
    <>
      <PageHeader
        title="Invoices"
        description="GST tax invoices and export invoices for packed sets. Each company (GSTIN) has its own invoice numbers."
        actions={
          can('invoices.create') && (
            <>
              <Button variant="outline" asChild>
                <Link href="/dispatch/packing?status=PACKED">
                  <PackageCheck aria-hidden /> From packed sets
                </Link>
              </Button>
              <Button asChild>
                <Link href="/billing/invoices/new">
                  <Plus aria-hidden /> New invoice
                </Link>
              </Button>
            </>
          )
        }
      />
      <SummaryStrip onFilter={(f) => params.set(f)} />
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Invoices">
        {TABS.map((t) => {
          const active = (params.filters.status ?? undefined) === t.filter.status && (params.filters.paymentStatus ?? undefined) === t.filter.paymentStatus;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => params.set(t.filter)}
              className={cn('h-8 rounded-full px-4 text-[13px] font-semibold text-muted-foreground transition-colors', active ? 'bg-ink text-ink-foreground' : 'hover:text-foreground')}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search invoice no., customer, PO, SO…"
        toolbar={
          <FilterSelect
            value={params.filters.customerId}
            onChange={(v) => params.set({ customerId: v })}
            options={(lookups.data?.customers ?? []).map((o) => ({ value: o.value, label: o.label }))}
            placeholder="All customers"
            className="max-w-60"
          />
        }
        onRowClick={(r) => router.push(`/billing/invoices/${r.id}`)}
        empty={{ title: 'No invoices', description: 'Make one with New invoice, or from packed sets (Packing → Make invoice).' }}
      />
    </>
  );
}
