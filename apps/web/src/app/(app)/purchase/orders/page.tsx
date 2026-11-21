'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Mail, Plus } from 'lucide-react';
import { useLookups, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fmtDate, fmtMoney } from '@/lib/format';
import type { PurchaseOrderRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Tooltip } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { PoStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const TABS = [
  { value: undefined, label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'OPEN', label: 'Open' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function PurchaseOrdersPage() {
  return (
    <RequirePermission permission="purchase_orders.view">
      <PurchaseOrders />
    </RequirePermission>
  );
}

function PurchaseOrders() {
  const { can } = useSession();
  const router = useRouter();
  const params = useListParams();
  const lookups = useLookups('suppliers');
  const { data, isFetching } = usePaged<PurchaseOrderRow>('/purchase-orders', params.query);
  const today = new Date().toISOString().slice(0, 10);

  const columns = useMemo<ColumnDef<PurchaseOrderRow>[]>(
    () => [
      {
        header: 'PO no.',
        accessorKey: 'poNo',
        meta: { sortKey: 'poNo' },
        cell: ({ row }) => (
          <div>
            <Link href={`/purchase/orders/${row.original.id}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
              {row.original.poNo}
            </Link>
            <div className="text-xs text-muted-foreground">
              {fmtDate(row.original.poDate)} · {row.original.company.code}
            </div>
            {row.original.type === 'JOB_WORK' && (
              <Badge variant="outline" className="mt-1" title={row.original.jobWorkOrder?.jwoNo}>
                Job work
              </Badge>
            )}
          </div>
        ),
      },
      {
        header: 'Supplier',
        id: 'supplier',
        cell: ({ row }) => (
          <div className="min-w-44">
            <div className="font-medium">{row.original.supplier.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original._count.lines} material(s)
              {row.original._count.goodsReceipts > 0 && ` · ${row.original._count.goodsReceipts} gate entr${row.original._count.goodsReceipts > 1 ? 'ies' : 'y'}`}
            </div>
          </div>
        ),
      },
      {
        header: 'Expected',
        accessorKey: 'expectedDelivery',
        meta: { sortKey: 'expectedDelivery' },
        cell: ({ row }) => {
          const open = row.original.status === 'ISSUED' || row.original.status === 'PARTIALLY_RECEIVED';
          const late = open && row.original.expectedDelivery && row.original.expectedDelivery.slice(0, 10) < today;
          return <span className={cn(late && 'font-medium text-destructive')}>{fmtDate(row.original.expectedDelivery)}{late && ' · late'}</span>;
        },
      },
      {
        header: 'Amount',
        accessorKey: 'grandTotal',
        meta: { sortKey: 'grandTotal', align: 'right' },
        cell: ({ row }) => <span className="font-medium">{fmtMoney(row.original.grandTotal, row.original.currency)}</span>,
      },
      {
        header: 'Status',
        accessorKey: 'status',
        meta: { sortKey: 'status' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <PoStatusBadge status={row.original.status} />
            {row.original.emailedAt && (
              <Tooltip content={`E-mailed ${fmtDate(row.original.emailedAt)}`}>
                <Mail className="size-3.5 text-muted-foreground" aria-label="E-mailed to supplier" />
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [today],
  );

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Orders to suppliers. Draft → approve → send → receive at the gate."
        actions={
          can('purchase_orders.create') && (
            <Button asChild>
              <Link href="/purchase/orders/new">
                <Plus /> New purchase order
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Status">
        {TABS.map((t) => {
          const active = (params.filters.status ?? undefined) === t.value;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => params.set({ status: t.value })}
              className={cn(
                'h-8 rounded-full px-4 text-[13px] font-semibold text-muted-foreground transition-colors',
                active ? 'bg-ink text-ink-foreground' : 'hover:text-foreground',
              )}
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
        searchPlaceholder="Search PO no., supplier…"
        toolbar={
          <>
            <FilterSelect
              value={params.filters.supplierId}
              onChange={(v) => params.set({ supplierId: v })}
              options={(lookups.data?.suppliers ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All suppliers"
              className="max-w-60"
            />
            <FilterSelect
              value={params.filters.type}
              onChange={(v) => params.set({ type: v })}
              options={[
                { value: 'MATERIAL', label: 'Material' },
                { value: 'JOB_WORK', label: 'Job work' },
              ]}
              placeholder="All types"
            />
          </>
        }
        onRowClick={(po) => router.push(`/purchase/orders/${po.id}`)}
        empty={{ title: 'No purchase orders yet', description: 'Create one directly, or from pending requisitions.' }}
      />
    </>
  );
}
