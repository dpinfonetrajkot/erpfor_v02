'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { fmtDate, fmtQty } from '@/lib/format';
import { useLookups, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { GoodsReceiptRow } from '@/lib/types';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { GrnStatusBadge } from '@/components/app/status';

/** Gate entries; `qcQueue` shows only the ones waiting for QC (QC's work list). */
export function GrnList({ qcQueue = false }: { qcQueue?: boolean }) {
  const router = useRouter();
  const params = useListParams();
  const lookups = useLookups('suppliers');
  const query = qcQueue ? { ...params.query, status: params.filters.status ?? 'PENDING_QC' } : params.query;
  const { data, isFetching } = usePaged<GoodsReceiptRow>('/goods-receipts', query);

  const columns = useMemo<ColumnDef<GoodsReceiptRow>[]>(
    () => [
      {
        header: 'Gate entry',
        accessorKey: 'grnNo',
        meta: { sortKey: 'grnNo' },
        cell: ({ row }) => (
          <div>
            <Link href={`/store/gate-entry/${row.original.id}${qcQueue ? '#qc' : ''}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
              {row.original.grnNo}
            </Link>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.grnDate)}</div>
          </div>
        ),
      },
      {
        header: 'Supplier',
        id: 'supplier',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.supplier.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.purchaseOrder ? row.original.purchaseOrder.poNo : 'No PO'}
              {row.original.supplierChallan && ` · Challan ${row.original.supplierChallan}`}
            </div>
          </div>
        ),
      },
      {
        header: 'Material',
        id: 'material',
        cell: ({ row }) => (
          <ul className="space-y-0.5 text-[13px]">
            {row.original.lines.slice(0, 3).map((l, i) => (
              <li key={i}>
                {l.rawMaterial.grade.name} · {l.rawMaterial.size} <span className="tabular text-muted-foreground">— {fmtQty(l.receivedQty)}</span>
              </li>
            ))}
            {row.original.lines.length > 3 && <li className="text-xs text-muted-foreground">+{row.original.lines.length - 3} more</li>}
          </ul>
        ),
      },
      { header: 'Vehicle', accessorKey: 'vehicleNo', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>() ?? '—'}</span> },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <GrnStatusBadge status={row.original.status} /> },
    ],
    [qcQueue],
  );

  return (
    <DataTable
      columns={columns}
      data={data?.data}
      total={data?.total}
      loading={isFetching}
      params={params}
      searchPlaceholder="Search gate entry, PO, challan, vehicle…"
      toolbar={
        <>
          <FilterSelect
            value={qcQueue ? (params.filters.status ?? 'PENDING_QC') : params.filters.status}
            onChange={(v) => params.set({ status: v })}
            options={[
              { value: 'PENDING_QC', label: 'Waiting for QC' },
              { value: 'COMPLETED', label: 'QC done' },
            ]}
            placeholder="All statuses"
          />
          <FilterSelect
            value={params.filters.supplierId}
            onChange={(v) => params.set({ supplierId: v })}
            options={(lookups.data?.suppliers ?? []).map((o) => ({ value: o.value, label: o.label }))}
            placeholder="All suppliers"
            className="max-w-60"
          />
        </>
      }
      onRowClick={(g) => router.push(`/store/gate-entry/${g.id}${qcQueue && g.status === 'PENDING_QC' ? '#qc' : ''}`)}
      empty={
        qcQueue
          ? { title: 'Nothing waiting for QC', description: 'New gate entries appear here for inspection.' }
          : { title: 'No gate entries yet', description: 'Record material when a vehicle arrives at the gate.' }
      }
    />
  );
}
