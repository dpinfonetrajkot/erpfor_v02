'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import type { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, BellRing, Plus, ShoppingCart } from 'lucide-react';
import { humanize, PR_STATUSES, purchaseRequisitionSchema, type PurchaseRequisitionInput } from '@bht/shared';
import { api } from '@/lib/api';
import { fromEntity, useZodForm } from '@/lib/forms';
import { fmtDate, fmtQty, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { PurchaseRequisition, ReorderSuggestion } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenuItem } from '@/components/ui/overlays';
import { Badge, Checkbox, Skeleton } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { ComboboxField, FormGrid, FormSheet, TextField, TextareaField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { RowActions } from '@/components/app/row-actions';
import { PrStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const today = () => toInputDate(new Date());

export default function RequisitionsPage() {
  return (
    <RequirePermission permission="purchase_requisitions.view">
      <Requisitions />
    </RequirePermission>
  );
}

function Requisitions() {
  const { can } = useSession();
  const router = useRouter();
  const params = useListParams();
  const lookups = useLookups('rawMaterials');
  const { data, isFetching } = usePaged<PurchaseRequisition>('/purchase-requisitions', params.query);
  const [editing, setEditing] = useState<PurchaseRequisition | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<PurchaseRequisition | null>(null);
  const [deleting, setDeleting] = useState<PurchaseRequisition | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const del = useDelete('/purchase-requisitions', 'Requisition', () => setDeleting(null));
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api(`/purchase-requisitions/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Requisition cancelled');
      setCancelling(null);
    },
    onError: (err) => showApiError(err),
  });

  const canOrder = can('purchase_orders.create');
  const pendingIds = (data?.data ?? []).filter((r) => r.status === 'PENDING').map((r) => r.id);
  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const columns = useMemo<ColumnDef<PurchaseRequisition>[]>(
    () => [
      ...(canOrder
        ? [
            {
              id: 'select',
              meta: { className: 'w-10' },
              header: () => (
                <Checkbox
                  checked={pendingIds.length > 0 && pendingIds.every((id) => selected.has(id)) ? true : pendingIds.some((id) => selected.has(id)) ? 'indeterminate' : false}
                  onCheckedChange={(c) => setSelected(c === true ? new Set(pendingIds) : new Set())}
                  disabled={!pendingIds.length}
                  aria-label="Select all pending"
                />
              ),
              cell: ({ row }: { row: { original: PurchaseRequisition } }) =>
                row.original.status === 'PENDING' ? (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(row.original.id)} onCheckedChange={(c) => toggle(row.original.id, c === true)} aria-label={`Select ${row.original.prNo}`} />
                  </span>
                ) : null,
            } as ColumnDef<PurchaseRequisition>,
          ]
        : []),
      {
        header: 'PR no.',
        accessorKey: 'prNo',
        meta: { sortKey: 'prNo' },
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-[13px] font-semibold">{row.original.prNo}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.prDate)}</div>
          </div>
        ),
      },
      {
        header: 'Material',
        id: 'material',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.original.rawMaterial.grade.name} · {row.original.rawMaterial.size}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.rawMaterial.code}</div>
          </div>
        ),
      },
      {
        header: 'Quantity',
        accessorKey: 'quantity',
        meta: { sortKey: 'quantity', align: 'right' },
        cell: ({ row }) => (
          <span className="font-medium">
            {fmtQty(row.original.quantity)} <span className="text-xs text-muted-foreground">{row.original.rawMaterial.uom.toLowerCase()}</span>
          </span>
        ),
      },
      {
        header: 'Needed by',
        accessorKey: 'requiredBy',
        meta: { sortKey: 'requiredBy' },
        cell: ({ row }) => {
          const late = row.original.status === 'PENDING' && row.original.requiredBy && new Date(row.original.requiredBy) < new Date(today());
          return <span className={cn(late && 'font-medium text-destructive')}>{fmtDate(row.original.requiredBy)}{late && ' · late'}</span>;
        },
      },
      {
        header: 'Source',
        accessorKey: 'source',
        cell: ({ getValue }) => <Badge variant="outline">{getValue<string>() === 'REORDER' ? 'Reorder level' : humanize(getValue<string>())}</Badge>,
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <PrStatusBadge status={row.original.status} /> },
      {
        header: 'PO',
        id: 'po',
        cell: ({ row }) =>
          row.original.purchaseOrderLines.map((l) => (
            <Link key={l.purchaseOrder.id} href={`/purchase/orders/${l.purchaseOrder.id}`} onClick={(e) => e.stopPropagation()} className="block font-mono text-xs text-primary hover:underline">
              {l.purchaseOrder.poNo}
            </Link>
          )),
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) =>
          row.original.status === 'PENDING' ? (
            <RowActions
              onEdit={can('purchase_requisitions.update') ? () => setEditing(row.original) : undefined}
              onDelete={can('purchase_requisitions.delete') ? () => setDeleting(row.original) : undefined}
            >
              {can('purchase_requisitions.update') && (
                <DropdownMenuItem onSelect={() => setCancelling(row.original)}>
                  <Ban /> Cancel
                </DropdownMenuItem>
              )}
            </RowActions>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, canOrder, selected, pendingIds.join(',')],
  );

  return (
    <>
      <PageHeader
        title="Purchase requisitions"
        description="Requests to buy raw material. Tick pending ones and make a purchase order from them."
        actions={
          <>
            {can('purchase_requisitions.create') && (
              <Button variant="outline" onClick={() => setReorderOpen(true)}>
                <BellRing /> Reorder suggestions
              </Button>
            )}
            {can('purchase_requisitions.create') && (
              <Button onClick={() => setEditing('new')}>
                <Plus /> New requisition
              </Button>
            )}
          </>
        }
      />
      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-accent px-4 py-2.5 text-sm shadow-sm">
          <span className="font-medium text-accent-foreground">{selected.size} requisition(s) selected</span>
          <Button size="sm" onClick={() => router.push(`/purchase/orders/new?prs=${[...selected].join(',')}`)}>
            <ShoppingCart /> Create purchase order
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search PR no., grade, size…"
        toolbar={
          <>
            <FilterSelect value={params.filters.status} onChange={(v) => params.set({ status: v })} options={PR_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} placeholder="All statuses" />
            <FilterSelect
              value={params.filters.rawMaterialId}
              onChange={(v) => params.set({ rawMaterialId: v })}
              options={(lookups.data?.rawMaterials ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All materials"
              className="max-w-60"
            />
          </>
        }
        onRowClick={can('purchase_requisitions.update') ? (r) => r.status === 'PENDING' && setEditing(r) : undefined}
        empty={{ title: 'No requisitions yet', description: 'Raise one when material is needed, or use Reorder suggestions.' }}
      />
      {editing && <RequisitionSheet requisition={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {reorderOpen && <ReorderDialog onClose={() => setReorderOpen(false)} />}
      {cancelling && (
        <ReasonDialog
          title={`Cancel ${cancelling.prNo}?`}
          description="The requisition stays in the list as cancelled."
          confirmLabel="Cancel requisition"
          saving={cancel.isPending}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
          onClose={() => setCancelling(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.prNo}?`}
        description="Use this only for a requisition made by mistake. Otherwise cancel it so the history stays."
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

function RequisitionSheet({ requisition, onClose }: { requisition: PurchaseRequisition | null; onClose: () => void }) {
  const lookups = useLookups('rawMaterials');
  const defaults: z.input<typeof purchaseRequisitionSchema> = {
    prDate: today(),
    rawMaterialId: '' as unknown as number,
    quantity: '',
    requiredBy: '',
    remarks: '',
  };
  const form = useZodForm(purchaseRequisitionSchema, fromEntity(defaults, requisition));
  const save = useSave<PurchaseRequisitionInput>({ path: '/purchase-requisitions', id: requisition?.id, form, label: 'Requisition', onSaved: onClose });
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={requisition ? `Edit ${requisition.prNo}` : 'New purchase requisition'}
      description="Purchase will order it from a supplier."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <ComboboxField form={form} name="rawMaterialId" label="Raw material" required options={lookups.data?.rawMaterials} loading={lookups.isLoading} />
      <FormGrid>
        <TextField form={form} name="quantity" label="Quantity (kg)" type="number" step="0.001" min={0} required />
        <TextField form={form} name="prDate" label="Date" type="date" required />
        <TextField form={form} name="requiredBy" label="Needed by" type="date" />
      </FormGrid>
      <TextareaField form={form} name="remarks" label="Remarks" rows={2} placeholder="Why it is needed, for which order…" />
    </FormSheet>
  );
}

function ReorderDialog({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useApiQuery<ReorderSuggestion[]>('/purchase-requisitions/reorder-suggestions');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const picked = chosen ?? new Set((data ?? []).map((d) => d.rawMaterialId));
  const create = useMutation({
    mutationFn: () =>
      api<PurchaseRequisition[]>('/purchase-requisitions/from-reorder', {
        method: 'POST',
        body: {
          items: (data ?? [])
            .filter((d) => picked.has(d.rawMaterialId))
            .map((d) => ({ rawMaterialId: d.rawMaterialId, quantity: Number(qty[d.rawMaterialId] ?? d.shortfall) })),
        },
      }),
    onSuccess: (r) => {
      toast.success(`${r.length} requisition(s) raised`);
      onClose();
    },
    onError: (err) => showApiError(err),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reorder suggestions</DialogTitle>
          <DialogDescription>Raw materials below their reorder level that have no open requisition. Change the quantity if needed.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : !data?.length ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing to reorder. Set reorder levels in Raw Materials to get suggestions here.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-right">Reorder at</th>
                  <th className="px-3 py-2 text-right">Order (kg)</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.rawMaterialId} className="border-t">
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={picked.has(d.rawMaterialId)}
                        onCheckedChange={(c) => {
                          const next = new Set(picked);
                          if (c === true) next.add(d.rawMaterialId);
                          else next.delete(d.rawMaterialId);
                          setChosen(next);
                        }}
                        aria-label={`Include ${d.grade} ${d.size}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {d.grade} · {d.size}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{d.code}</div>
                    </td>
                    <td className="tabular px-3 py-2 text-right text-destructive">{fmtQty(d.stock)}</td>
                    <td className="tabular px-3 py-2 text-right">{fmtQty(d.reorderLevel)}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={1}
                        value={qty[d.rawMaterialId] ?? String(d.shortfall)}
                        onChange={(e) => setQty({ ...qty, [d.rawMaterialId]: e.target.value })}
                        className="ml-auto h-8 w-28 text-right"
                        aria-label={`Quantity for ${d.grade} ${d.size}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!data?.length || picked.size === 0}>
            Raise {picked.size || ''} requisition(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
