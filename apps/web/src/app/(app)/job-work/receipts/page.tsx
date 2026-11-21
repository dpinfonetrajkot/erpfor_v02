'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fmtDate, fmtQty } from '@/lib/format';
import type { JobWorkReceiptRow } from '@/lib/types';
import { DataTable } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';

export default function JobWorkReceiptsPage() {
  return (
    <RequirePermission permission={['job_work_receipts.view', 'job_work_orders.view']}>
      <JobWorkReceipts />
    </RequirePermission>
  );
}

function JobWorkReceipts() {
  const router = useRouter();
  const params = useListParams();
  const { data, isFetching } = usePaged<JobWorkReceiptRow>('/job-work-receipts', params.query);

  const columns = useMemo<ColumnDef<JobWorkReceiptRow>[]>(
    () => [
      {
        header: 'Receipt',
        accessorKey: 'receiptNo',
        meta: { sortKey: 'receiptNo' },
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-[13px] font-semibold whitespace-nowrap">{row.original.receiptNo}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.receiptDate)}</div>
          </div>
        ),
      },
      {
        header: 'Order / vendor',
        id: 'jwo',
        cell: ({ row }) => (
          <div className="min-w-44">
            <Link href={`/job-work/orders/${row.original.jobWorkOrder.id}`} className="font-mono text-[13px] text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.jobWorkOrder.jwoNo}
            </Link>
            <div className="text-xs text-muted-foreground">{row.original.jobWorkOrder.supplier.name}</div>
          </div>
        ),
      },
      {
        header: 'Parts',
        id: 'parts',
        cell: ({ row }) => (
          <ul className="min-w-56 space-y-0.5 text-[13px]">
            {row.original.lines.map((l) => (
              <li key={l.id}>
                {l.item.name}: <span className="font-medium text-success">{fmtQty(l.acceptedQty)} OK</span>
                {l.rejectedQty > 0 && <span className="text-destructive"> · {fmtQty(l.rejectedQty)} rejected</span>}
                {l.heat && <span className="font-mono text-xs text-muted-foreground"> · {l.heat.heatNo}</span>}
              </li>
            ))}
          </ul>
        ),
      },
      {
        header: 'Challan / QC',
        id: 'qc',
        cell: ({ row }) => (
          <div className="text-[13px]">
            <div>{row.original.vendorChallan ?? '—'}</div>
            <div className="text-xs text-muted-foreground">{row.original.inspectorName ?? row.original.createdBy?.name}</div>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader title="Job work receipts" description="Parts back from vendors with our QC result. Record a new one from the job work order (Receive parts)." />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search receipt, order no., vendor, challan…"
        onRowClick={(r) => router.push(`/job-work/orders/${r.jobWorkOrder.id}`)}
        empty={{ title: 'No receipts yet', description: 'They are made when parts come back from a job-work vendor.' }}
      />
    </>
  );
}
