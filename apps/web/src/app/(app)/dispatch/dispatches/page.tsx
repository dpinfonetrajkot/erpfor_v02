'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, FileText, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty } from '@/lib/format';
import { showApiError, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { DispatchRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { BILLING_READERS } from '@/components/billing/billing-access';
import { DispatchDialog } from '@/components/billing/dialogs';

export default function DispatchesPage() {
  return (
    <RequirePermission permission={BILLING_READERS}>
      <Dispatches />
    </RequirePermission>
  );
}

function Dispatches() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<DispatchRow>('/dispatches', params.query);
  const [editing, setEditing] = useState<DispatchRow | null>(null);
  const [cancelling, setCancelling] = useState<DispatchRow | null>(null);
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api(`/dispatches/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Dispatch cancelled; the order quantities are open again');
      setCancelling(null);
    },
    onError: (err) => showApiError(err),
  });

  const columns = useMemo<ColumnDef<DispatchRow>[]>(
    () => [
      {
        header: 'Dispatch',
        accessorKey: 'dispatchNo',
        meta: { sortKey: 'dispatchNo' },
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-[13px] font-semibold whitespace-nowrap">{row.original.dispatchNo}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.dispatchDate)}</div>
          </div>
        ),
      },
      {
        header: 'Order / invoice',
        id: 'so',
        cell: ({ row }) => (
          <div className="min-w-44">
            <div className="font-medium">{row.original.salesOrder.customer.name}</div>
            <div className="text-xs">
              <span className="font-mono">{row.original.salesOrder.soNo}</span>
              {row.original.invoice && (
                <>
                  {' · '}
                  <Link href={`/billing/invoices/${row.original.invoice.id}`} className="font-mono text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                    {row.original.invoice.invoiceNo}
                  </Link>
                </>
              )}
            </div>
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
      {
        header: 'Transport',
        id: 'transport',
        cell: ({ row }) => (
          <div className="min-w-36 text-[13px]">
            <div>{row.original.transporter ?? '—'}</div>
            <div className="text-xs text-muted-foreground">{[row.original.lrNo && `LR ${row.original.lrNo}`, row.original.vehicleNo].filter(Boolean).join(' · ')}</div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.cancelledAt ? (
            <Badge variant="destructive" title={row.original.cancelReason ?? undefined}>
              Cancelled
            </Badge>
          ) : (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" asChild>
                <a href={`/api/dispatches/${row.original.id}/pdf`} target="_blank" rel="noreferrer">
                  <FileText /> Packing list
                </a>
              </Button>
              {can('dispatches.update') && (
                <>
                  <Button variant="ghost" size="icon-sm" title="Transport details" aria-label={`Edit ${row.original.dispatchNo}`} onClick={() => setEditing(row.original)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="Cancel dispatch" aria-label={`Cancel ${row.original.dispatchNo}`} onClick={() => setCancelling(row.original)}>
                    <Ban />
                  </Button>
                </>
              )}
            </div>
          ),
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader title="Dispatches" description="Goods sent out on an invoice, with transporter, LR and vehicle. Dispatch from the invoice screen." />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search dispatch, LR, vehicle, customer, invoice…"
        empty={{ title: 'Nothing dispatched yet', description: 'Open an issued invoice and choose Dispatch.' }}
      />
      {editing && <DispatchDialog dispatch={editing} onClose={() => setEditing(null)} />}
      {cancelling && (
        <ReasonDialog
          title={`Cancel ${cancelling.dispatchNo}?`}
          description="Only if the goods did not leave or came back. The sales order quantities open again."
          confirmLabel="Cancel dispatch"
          saving={cancel.isPending}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}
