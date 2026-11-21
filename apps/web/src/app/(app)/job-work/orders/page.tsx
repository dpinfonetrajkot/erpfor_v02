'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useLookups, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fmtDate, fmtQty } from '@/lib/format';
import type { JobWorkOrderRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { JwoStatusBadge, PoStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { JWO_READERS } from '@/components/jobwork/jwo-access';

const TABS: { label: string; status?: string }[] = [
  { label: 'Running', status: 'RUNNING' },
  { label: 'Completed', status: 'COMPLETED' },
  { label: 'Cancelled', status: 'CANCELLED' },
  { label: 'All' },
];

export default function JobWorkOrdersPage() {
  return (
    <RequirePermission permission={JWO_READERS}>
      <JobWorkOrders />
    </RequirePermission>
  );
}

function JobWorkOrders() {
  const { can } = useSession();
  const router = useRouter();
  const params = useListParams();
  const lookups = useLookups('suppliers');
  const { data, isFetching } = usePaged<JobWorkOrderRow>('/job-work-orders', params.query);
  const today = new Date().toISOString().slice(0, 10);

  const columns = useMemo<ColumnDef<JobWorkOrderRow>[]>(
    () => [
      {
        header: 'Order',
        accessorKey: 'jwoNo',
        meta: { sortKey: 'jwoNo' },
        cell: ({ row }) => (
          <div>
            <Link href={`/job-work/orders/${row.original.id}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
              {row.original.jwoNo}
            </Link>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.jwoDate)}</div>
          </div>
        ),
      },
      {
        header: 'Vendor',
        id: 'vendor',
        cell: ({ row }) => <div className="min-w-40 font-medium">{row.original.supplier.name}</div>,
      },
      {
        header: 'For',
        id: 'for',
        cell: ({ row }) =>
          row.original.salesOrder ? (
            <div>
              <span className="font-mono text-[13px]">{row.original.salesOrder.soNo}</span>
              <div className="max-w-44 truncate text-xs text-muted-foreground">{row.original.salesOrder.customer.name}</div>
            </div>
          ) : (
            <Badge variant="secondary">For stock</Badge>
          ),
      },
      {
        header: 'Parts',
        id: 'parts',
        cell: ({ row }) => {
          const l = row.original.lines;
          const ordered = l.reduce((s, x) => s + x.quantity, 0);
          const back = l.reduce((s, x) => s + x.receivedQty, 0);
          return (
            <div className="min-w-44 text-[13px]">
              <div className="truncate">{l.map((x) => x.item.name).join(', ')}</div>
              <div className="text-xs text-muted-foreground">
                {fmtQty(back)} of {fmtQty(ordered)} pcs back
              </div>
            </div>
          );
        },
      },
      {
        header: 'Material',
        id: 'material',
        cell: ({ row }) => {
          const m = row.original.materials;
          if (!m.length) return <span className="text-xs text-muted-foreground">Vendor&apos;s own</span>;
          const asked = m.reduce((s, x) => s + x.quantity, 0);
          const sent = m.reduce((s, x) => s + x.issuedQty, 0);
          return (
            <span className={cn('text-[13px] whitespace-nowrap', sent < asked && row.original.status !== 'COMPLETED' && row.original.status !== 'CANCELLED' && 'text-warning')}>
              {fmtQty(sent)} / {fmtQty(asked)} kg sent
            </span>
          );
        },
      },
      {
        header: 'PO',
        id: 'po',
        cell: ({ row }) => {
          const po = row.original.purchaseOrders.find((p) => p.status !== 'CANCELLED');
          return po ? (
            <div className="space-y-1">
              <div className="font-mono text-[13px]">{po.poNo}</div>
              <PoStatusBadge status={po.status} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        header: 'Back by',
        accessorKey: 'expectedDate',
        meta: { sortKey: 'expectedDate' },
        cell: ({ row }) => {
          const running = ['OPEN', 'MATERIAL_ISSUED', 'PARTIALLY_RECEIVED'].includes(row.original.status);
          const late = running && row.original.expectedDate && row.original.expectedDate.slice(0, 10) < today;
          return <span className={cn('whitespace-nowrap', late && 'font-medium text-destructive')}>{fmtDate(row.original.expectedDate)}{late && ' · late'}</span>;
        },
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <JwoStatusBadge status={row.original.status} /> },
    ],
    [today],
  );

  return (
    <>
      <PageHeader
        title="Job work orders"
        description="Parts made by outside vendors: material goes out by heat, parts come back through our QC into the FG store."
        actions={
          can('job_work_orders.create') && (
            <Button asChild>
              <Link href="/job-work/orders/new">
                <Plus /> New job work order
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Status">
        {TABS.map((t) => {
          const active = (params.filters.status ?? undefined) === t.status;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => params.set({ status: t.status })}
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
        searchPlaceholder="Search order no., vendor, SO no.…"
        toolbar={
          <FilterSelect
            value={params.filters.supplierId}
            onChange={(v) => params.set({ supplierId: v })}
            options={(lookups.data?.suppliers ?? []).map((o) => ({ value: o.value, label: o.label }))}
            placeholder="All vendors"
            className="max-w-60"
          />
        }
        onRowClick={(r) => router.push(`/job-work/orders/${r.id}`)}
        empty={{ title: 'No job work orders', description: 'Make one from an outsourced sales order (stock check), or for stock.' }}
      />
    </>
  );
}
