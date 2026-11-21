'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { APPROVAL_STAGE_LABELS, APPROVAL_STAGE_PERMISSION, APPROVAL_STAGES } from '@bht/shared';
import { useLookups, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import type { SalesOrderRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { ApprovalDots, SoStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { SO_READERS } from '@/components/sales/so-access';

const TABS: { label: string; status?: string }[] = [
  { label: 'All' },
  { label: 'Draft', status: 'DRAFT' },
  { label: 'Waiting approval', status: 'PENDING_APPROVAL' },
  { label: 'Approved', status: 'APPROVED' },
  { label: 'In production', status: 'IN_PRODUCTION' },
  { label: 'Cancelled', status: 'CANCELLED' },
];

export default function SalesOrdersPage() {
  return (
    <RequirePermission permission={SO_READERS}>
      <SalesOrders />
    </RequirePermission>
  );
}

function SalesOrders() {
  const { can } = useSession();
  const router = useRouter();
  const params = useListParams();
  const lookups = useLookups('customers');
  const { data, isFetching } = usePaged<SalesOrderRow>('/sales-orders', params.query);
  const today = new Date().toISOString().slice(0, 10);
  const myStages = APPROVAL_STAGES.filter((s) => can(APPROVAL_STAGE_PERMISSION[s]));

  const columns = useMemo<ColumnDef<SalesOrderRow>[]>(
    () => [
      {
        header: 'SO no.',
        accessorKey: 'soNo',
        meta: { sortKey: 'soNo' },
        cell: ({ row }) => (
          <div>
            <Link href={`/sales/orders/${row.original.id}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
              {row.original.soNo}
            </Link>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.soDate)}</div>
          </div>
        ),
      },
      {
        header: 'Customer',
        id: 'customer',
        cell: ({ row }) => (
          <div className="min-w-44">
            <div className="font-medium">{row.original.customer.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.customerPoNo ? `PO ${row.original.customerPoNo}` : 'No PO no.'}</div>
          </div>
        ),
      },
      {
        header: 'Products',
        id: 'products',
        cell: ({ row }) => (
          <ul className="space-y-0.5 text-[13px]">
            {row.original.lines.slice(0, 2).map((l, i) => (
              <li key={i}>
                {l.product.name} <span className="tabular text-muted-foreground">× {fmtQty(l.quantity)}</span>
              </li>
            ))}
            {row.original.lines.length > 2 && <li className="text-xs text-muted-foreground">+{row.original.lines.length - 2} more</li>}
          </ul>
        ),
      },
      {
        header: 'Delivery',
        accessorKey: 'expectedDelivery',
        meta: { sortKey: 'expectedDelivery' },
        cell: ({ row }) => {
          const open = !['DISPATCHED', 'CLOSED', 'CANCELLED'].includes(row.original.status);
          const late = open && row.original.expectedDelivery && row.original.expectedDelivery.slice(0, 10) < today;
          return <span className={cn('whitespace-nowrap', late && 'font-medium text-destructive')}>{fmtDate(row.original.expectedDelivery)}{late && ' · late'}</span>;
        },
      },
      {
        header: 'Value',
        accessorKey: 'totalAmount',
        meta: { sortKey: 'totalAmount', align: 'right' },
        cell: ({ row }) => <span className="font-medium">{fmtMoney(row.original.totalAmount, row.original.currency)}</span>,
      },
      {
        header: 'Approvals',
        id: 'approvals',
        cell: ({ row }) => <ApprovalDots f={row.original.feasibilityStatus} d={row.original.designStatus} p={row.original.productionStatus} />,
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <SoStatusBadge status={row.original.status} /> },
    ],
    [today],
  );

  const awaiting = params.filters.awaiting;
  return (
    <>
      <PageHeader
        title="Sales orders"
        description="Customer orders: feasibility → design → production approval → stock check → production."
        actions={
          can('sales_orders.create') && (
            <Button asChild>
              <Link href="/sales/orders/new">
                <Plus /> New sales order
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Status">
        {TABS.map((t) => {
          const active = !awaiting && (params.filters.status ?? undefined) === t.status;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => params.set({ status: t.status, awaiting: undefined })}
              className={cn('h-8 rounded-full px-4 text-[13px] font-semibold text-muted-foreground transition-colors', active ? 'bg-ink text-ink-foreground' : 'hover:text-foreground')}
            >
              {t.label}
            </button>
          );
        })}
        {myStages.map((s) => {
          const active = awaiting === s;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={active}
              onClick={() => params.set({ awaiting: s, status: undefined })}
              className={cn('h-8 rounded-full px-4 text-[13px] font-semibold transition-colors', active ? 'bg-ink text-ink-foreground' : 'text-primary/80 hover:text-primary')}
            >
              {APPROVAL_STAGE_LABELS[s]} to approve
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
        searchPlaceholder="Search SO no., customer PO, customer…"
        toolbar={
          <FilterSelect
            value={params.filters.customerId}
            onChange={(v) => params.set({ customerId: v })}
            options={(lookups.data?.customers ?? []).map((o) => ({ value: o.value, label: o.label }))}
            placeholder="All customers"
            className="max-w-60"
          />
        }
        onRowClick={(so) => router.push(`/sales/orders/${so.id}`)}
        empty={{ title: awaiting ? 'Nothing waiting for you' : 'No sales orders yet', description: awaiting ? undefined : 'Enter the customer PO as a new sales order.' }}
      />
    </>
  );
}
