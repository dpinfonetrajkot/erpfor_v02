'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Ban, Plus, Route } from 'lucide-react';
import { mtsRequestSchema, type MtsRequestInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtQty } from '@/lib/format';
import { showApiError, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { ProductionRequestRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { ComboboxField, FormGrid, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { RequestStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

export default function ProductionRequestsPage() {
  return (
    <RequirePermission permission={['stock_check.view', 'route_cards.view']}>
      <ProductionRequests />
    </RequirePermission>
  );
}

function ProductionRequests() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<ProductionRequestRow>('/production-requests', params.query);
  const [mtsOpen, setMtsOpen] = useState(false);
  const [cancelling, setCancelling] = useState<ProductionRequestRow | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api(`/production-requests/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Request cancelled');
      setCancelling(null);
    },
    onError: (err) => showApiError(err),
  });

  const columns = useMemo<ColumnDef<ProductionRequestRow>[]>(
    () => [
      {
        header: 'Request',
        accessorKey: 'requestNo',
        meta: { sortKey: 'requestNo' },
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-[13px] font-semibold whitespace-nowrap">{row.original.requestNo}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.createdAt)}</div>
          </div>
        ),
      },
      {
        header: 'Item',
        id: 'item',
        cell: ({ row }) => (
          <div className="min-w-48">
            <div className="font-medium">{row.original.item.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.item.code}</div>
          </div>
        ),
      },
      { header: 'Qty', accessorKey: 'quantity', meta: { sortKey: 'quantity', align: 'right' }, cell: ({ getValue }) => <span className="font-semibold">{fmtQty(getValue<number>())}</span> },
      {
        header: 'For',
        id: 'for',
        cell: ({ row }) =>
          row.original.salesOrderLine ? (
            <div>
              <Link href={`/sales/orders/${row.original.salesOrderLine.salesOrder.id}`} className="font-mono text-[13px] text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                {row.original.salesOrderLine.salesOrder.soNo}
              </Link>
              <div className="text-xs text-muted-foreground">{row.original.salesOrderLine.salesOrder.customer.name}</div>
            </div>
          ) : (
            <Badge variant="secondary">Make to stock</Badge>
          ),
      },
      {
        header: 'Needed by',
        accessorKey: 'requiredBy',
        meta: { sortKey: 'requiredBy' },
        cell: ({ row }) => {
          const late = row.original.status === 'REQUESTED' && row.original.requiredBy && row.original.requiredBy.slice(0, 10) < today;
          return <span className={cn('whitespace-nowrap', late && 'font-medium text-destructive')}>{fmtDate(row.original.requiredBy)}{late && ' · late'}</span>;
        },
      },
      {
        header: 'Note',
        accessorKey: 'remarks',
        cell: ({ row }) => <span className="line-clamp-2 text-[13px] text-muted-foreground">{row.original.cancelReason ? `Cancelled: ${row.original.cancelReason}` : (row.original.remarks ?? '')}</span>,
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <RequestStatusBadge status={row.original.status} /> },
      {
        header: 'Route card',
        id: 'rc',
        cell: ({ row }) => {
          const rc = row.original.routeCards[0];
          if (rc) {
            return (
              <Link href={`/production/route-cards/${rc.id}`} className="font-mono text-[13px] whitespace-nowrap text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                {rc.rcNo}
              </Link>
            );
          }
          return row.original.status === 'REQUESTED' && can('route_cards.create') ? (
            <Button size="sm" variant="outline" asChild onClick={(e) => e.stopPropagation()}>
              <Link href={`/production/route-cards/new?requestId=${row.original.id}`}>
                <Route /> Make route card
              </Link>
            </Button>
          ) : null;
        },
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) =>
          row.original.status === 'REQUESTED' && can('stock_check.create') ? (
            <Button variant="ghost" size="icon-sm" onClick={() => setCancelling(row.original)} aria-label={`Cancel ${row.original.requestNo}`} title="Cancel request">
              <Ban />
            </Button>
          ) : null,
      },
    ],
    [can, today],
  );

  return (
    <>
      <PageHeader
        title="Production requests"
        description="What production is asked to make: shortages of sales orders and parts for stock. Production makes a route card for each one."
        actions={
          can('stock_check.create') && (
            <Button onClick={() => setMtsOpen(true)}>
              <Plus /> Make-to-stock request
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search request no., item, SO no.…"
        toolbar={
          <>
            <FilterSelect
              value={params.filters.status}
              onChange={(v) => params.set({ status: v })}
              options={[
                { value: 'REQUESTED', label: 'Requested' },
                { value: 'ACCEPTED', label: 'Accepted' },
                { value: 'COMPLETED', label: 'Made' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
              placeholder="All statuses"
            />
            <FilterSelect
              value={params.filters.type}
              onChange={(v) => params.set({ type: v })}
              options={[
                { value: 'MAKE_TO_ORDER', label: 'For sales orders' },
                { value: 'MAKE_TO_STOCK', label: 'Make to stock' },
              ]}
              placeholder="All types"
            />
            {params.filters.salesOrderId && (
              <Button variant="ghost" size="sm" onClick={() => params.set({ salesOrderId: undefined })}>
                One order only · show all
              </Button>
            )}
          </>
        }
        empty={{ title: 'No production requests', description: 'They are made from the stock check of an approved sales order, or as make-to-stock.' }}
      />
      {mtsOpen && <MtsDialog onClose={() => setMtsOpen(false)} />}
      {cancelling && (
        <ReasonDialog
          title={`Cancel ${cancelling.requestNo}?`}
          confirmLabel="Cancel request"
          saving={cancel.isPending}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}

function MtsDialog({ onClose }: { onClose: () => void }) {
  const lookups = useLookups('items');
  const defaults: z.input<typeof mtsRequestSchema> = { itemId: '' as unknown as number, quantity: '', requiredBy: '', remarks: '' };
  const form = useZodForm(mtsRequestSchema, defaults);
  const save = useSave<MtsRequestInput>({ path: '/production-requests', form, label: 'Request', successMessage: 'Make-to-stock request sent to production', onSaved: onClose });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Make-to-stock request"
      description="Parts for the FG store without a customer order, e.g. fast-moving sizes."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel="Send to production"
    >
      <ComboboxField form={form} name="itemId" label="Item" required options={lookups.data?.items} loading={lookups.isLoading} />
      <FormGrid>
        <TextField form={form} name="quantity" label="Quantity (pcs)" type="number" min={1} required />
        <TextField form={form} name="requiredBy" label="Needed by" type="date" />
      </FormGrid>
      <TextField form={form} name="remarks" label="Note" />
    </FormDialog>
  );
}
