'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fmtDate, fmtQty } from '@/lib/format';
import type { AssemblyRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { AssemblyStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { BILLING_READERS } from '@/components/billing/billing-access';

const TABS: { label: string; status?: string }[] = [
  { label: 'Packed (to invoice)', status: 'PACKED' },
  { label: 'Invoiced', status: 'INVOICED' },
  { label: 'Dispatched', status: 'DISPATCHED' },
  { label: 'Cancelled', status: 'CANCELLED' },
  { label: 'All' },
];

export default function PackingPage() {
  return (
    <RequirePermission permission={BILLING_READERS}>
      <Packing />
    </RequirePermission>
  );
}

function Packing() {
  const router = useRouter();
  const params = useListParams();
  const { data, isFetching } = usePaged<AssemblyRow>('/assemblies', params.query);
  const columns = useMemo<ColumnDef<AssemblyRow>[]>(
    () => [
      {
        header: 'Packing',
        accessorKey: 'assemblyNo',
        meta: { sortKey: 'assemblyNo' },
        cell: ({ row }) => (
          <div>
            <Link href={`/dispatch/packing/${row.original.id}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
              {row.original.assemblyNo}
            </Link>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.assemblyDate)}</div>
          </div>
        ),
      },
      {
        header: 'Order',
        id: 'so',
        cell: ({ row }) => (
          <div className="min-w-40">
            <span className="font-mono text-[13px]">{row.original.salesOrder.soNo}</span>
            <div className="text-xs text-muted-foreground">{row.original.salesOrder.customer.name}</div>
          </div>
        ),
      },
      {
        header: 'Sets',
        id: 'sets',
        cell: ({ row }) => (
          <ul className="text-[13px]">
            {row.original.lines.map((l, i) => (
              <li key={i}>
                {l.salesOrderLine.product.name} <span className="tabular text-muted-foreground">× {fmtQty(l.quantity)}</span>
              </li>
            ))}
          </ul>
        ),
      },
      { header: 'Packing', accessorKey: 'packingType', cell: ({ getValue }) => <span className="text-[13px]">{getValue<string>() ?? '—'}</span> },
      {
        header: 'Invoice',
        id: 'inv',
        cell: ({ row }) => {
          const inv = row.original.invoices[0];
          return inv ? <span className={cn('font-mono text-[13px]', inv.status === 'DRAFT' && 'text-muted-foreground')}>{inv.status === 'DRAFT' ? 'Draft' : inv.invoiceNo}</span> : <span className="text-xs text-muted-foreground">—</span>;
        },
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <AssemblyStatusBadge status={row.original.status} /> },
    ],
    [],
  );
  return (
    <>
      <PageHeader title="Packing" description="Sets assembled from finished parts (by heat) and packed for a sales order. Start from the sales order: Pack sets." />
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
        searchPlaceholder="Search packing no., SO no., customer…"
        onRowClick={(r) => router.push(`/dispatch/packing/${r.id}`)}
        empty={{ title: 'Nothing packed', description: 'Open an approved sales order and choose Pack sets.' }}
      />
    </>
  );
}
