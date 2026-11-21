'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Ban, PackageOpen, ShoppingCart, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty } from '@/lib/format';
import { showApiError, useApiQuery, usePaged } from '@/hooks/use-api';
import { useListParams, type ListParams } from '@/hooks/use-list-params';
import type { HeatInStore, JobWorkMaterialRow, MaterialRequestRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { Field, FormGrid } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { MrStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const TABS: { label: string; status?: string }[] = [
  { label: 'To issue', status: 'OPEN' },
  { label: 'Issued', status: 'ISSUED' },
  { label: 'Cancelled', status: 'CANCELLED' },
  { label: 'All', status: 'ALL' },
];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export default function MaterialIssuePage() {
  return (
    <RequirePermission permission={['material_issues.view', 'material_requisitions.view']}>
      <MaterialIssue />
    </RequirePermission>
  );
}

function MaterialIssue() {
  const params = useListParams({ filters: { status: 'OPEN' } });
  const jobWork = params.filters.for === 'jw';
  const tab = (active: boolean) =>
    cn('h-8 rounded-full px-3.5 text-[13px] font-semibold text-muted-foreground transition-colors', active ? 'bg-ink text-ink-foreground' : 'hover:text-foreground');
  return (
    <>
      <PageHeader
        title="Material issue"
        description="Bar stock for route cards (asked by production) and for job-work vendors. Issued heat by heat, oldest heat first."
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex gap-1 rounded-full glass p-1" role="tablist" aria-label="Issue for">
          <button role="tab" aria-selected={!jobWork} onClick={() => params.set({ for: undefined })} className={tab(!jobWork)}>
            For route cards
          </button>
          <button role="tab" aria-selected={jobWork} onClick={() => params.set({ for: 'jw' })} className={tab(jobWork)}>
            For job work
          </button>
        </div>
        <div className="flex flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Status">
          {TABS.map((t) => (
            <button key={t.label} role="tab" aria-selected={params.filters.status === t.status} onClick={() => params.set({ status: t.status })} className={tab(params.filters.status === t.status)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {jobWork ? <JobWorkMaterials params={params} /> : <RouteCardRequests params={params} />}
    </>
  );
}

function RouteCardRequests({ params }: { params: ListParams }) {
  const { can } = useSession();
  const query = { ...params.query, status: params.filters.status === 'ALL' ? undefined : params.filters.status };
  const { data, isFetching } = usePaged<MaterialRequestRow>('/material-requests', query);
  const [issuing, setIssuing] = useState<MaterialRequestRow | null>(null);
  const [buying, setBuying] = useState<MaterialRequestRow | null>(null);
  const [closing, setClosing] = useState<MaterialRequestRow | null>(null);
  const close = useMutation({
    mutationFn: (mr: MaterialRequestRow) => api(`/material-requests/${mr.id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Request closed');
      setClosing(null);
    },
    onError: (err) => showApiError(err),
  });

  const columns = useMemo<ColumnDef<MaterialRequestRow>[]>(
    () => [
      {
        header: 'Request',
        accessorKey: 'mrNo',
        meta: { sortKey: 'mrNo' },
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-[13px] font-semibold whitespace-nowrap">{row.original.mrNo}</div>
            <div className="text-xs text-muted-foreground">
              {fmtDate(row.original.mrDate)} · {row.original.createdBy?.name ?? ''}
            </div>
          </div>
        ),
      },
      {
        header: 'For',
        id: 'rc',
        cell: ({ row }) => (
          <div className="min-w-44">
            <Link href={`/production/route-cards/${row.original.routeCard.id}`} className="font-mono text-[13px] text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.routeCard.rcNo}
            </Link>
            <div className="text-xs text-muted-foreground">{row.original.routeCard.item.name}</div>
          </div>
        ),
      },
      {
        header: 'Material',
        id: 'rm',
        cell: ({ row }) => (
          <div className="min-w-36">
            <div className="font-medium">
              {row.original.rawMaterial.grade.name} · {row.original.rawMaterial.size}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.rawMaterial.code}</div>
          </div>
        ),
      },
      {
        header: 'Asked / issued',
        accessorKey: 'requestedQty',
        meta: { sortKey: 'requestedQty', align: 'right' },
        cell: ({ row }) => (
          <div className="text-right whitespace-nowrap">
            <div className="font-semibold">{fmtQty(row.original.requestedQty)} kg</div>
            <div className="text-xs text-muted-foreground">{fmtQty(row.original.issuedQty)} issued</div>
          </div>
        ),
      },
      {
        header: 'In store',
        id: 'stock',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const r = row.original;
          const left = r3(r.requestedQty - r.issuedQty);
          const open = r.status === 'PENDING' || r.status === 'PARTIAL';
          const short = open && r.inStoreKg < left;
          return (
            <span className={cn('whitespace-nowrap', short && 'font-medium text-destructive')}>
              {short && <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />}
              {fmtQty(r.inStoreKg)} kg
            </span>
          );
        },
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <MrStatusBadge status={row.original.status} /> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const r = row.original;
          const open = r.status === 'PENDING' || r.status === 'PARTIAL';
          if (!open) {
            return r.purchaseRequisitions.length ? <Badge variant="outline">{r.purchaseRequisitions.map((p) => p.prNo).join(', ')}</Badge> : null;
          }
          return (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {can('purchase_requisitions.create') && (
                <Button variant="ghost" size="icon-sm" title="Ask purchase for the shortage" aria-label={`Ask purchase for ${r.mrNo}`} onClick={() => setBuying(r)}>
                  <ShoppingCart />
                </Button>
              )}
              {(can('material_issues.issue') || can('material_requisitions.update')) && (
                <Button variant="ghost" size="icon-sm" title="Close request" aria-label={`Close ${r.mrNo}`} onClick={() => setClosing(r)}>
                  <Ban />
                </Button>
              )}
              {can('material_issues.issue') && (
                <Button size="sm" onClick={() => setIssuing(r)}>
                  <PackageOpen /> Issue
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [can],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search request, route card, part, grade…"
        onRowClick={(r) => (r.status === 'PENDING' || r.status === 'PARTIAL') && can('material_issues.issue') && setIssuing(r)}
        empty={{ title: params.filters.status === 'OPEN' ? 'Nothing to issue' : 'No material requests', description: 'Requests come from route cards.' }}
      />
      {issuing && <IssueDialog target={mrTarget(issuing)} onClose={() => setIssuing(null)} />}
      {buying && <PurchaseDialog mr={buying} onClose={() => setBuying(null)} />}
      <ConfirmDialog
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        title={`Close ${closing?.mrNo}?`}
        description={closing?.issuedQty ? `${fmtQty(closing.issuedQty)} kg stays issued; the rest is no longer asked for.` : 'Nothing was issued; the request is cancelled.'}
        confirmLabel="Close request"
        loading={close.isPending}
        onConfirm={() => closing && close.mutate(closing)}
      />
    </>
  );
}

function JobWorkMaterials({ params }: { params: ListParams }) {
  const { can } = useSession();
  const query = { ...params.query, status: params.filters.status === 'ALL' ? undefined : params.filters.status };
  const { data, isFetching } = usePaged<JobWorkMaterialRow>('/job-work-materials', query);
  const [issuing, setIssuing] = useState<JobWorkMaterialRow | null>(null);
  const open = (m: JobWorkMaterialRow) => (m.status === 'PENDING' || m.status === 'PARTIAL') && ['OPEN', 'MATERIAL_ISSUED', 'PARTIALLY_RECEIVED'].includes(m.jobWorkOrder.status);

  const columns = useMemo<ColumnDef<JobWorkMaterialRow>[]>(
    () => [
      {
        header: 'Job work order',
        id: 'jwo',
        cell: ({ row }) => (
          <div className="min-w-40">
            <Link href={`/job-work/orders/${row.original.jobWorkOrder.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.jobWorkOrder.jwoNo}
            </Link>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.jobWorkOrder.jwoDate)}</div>
          </div>
        ),
      },
      { header: 'Vendor', id: 'vendor', cell: ({ row }) => <span className="font-medium">{row.original.jobWorkOrder.supplier.name}</span> },
      {
        header: 'Material',
        id: 'rm',
        cell: ({ row }) => (
          <div className="min-w-36">
            <div className="font-medium">
              {row.original.rawMaterial.grade.name} · {row.original.rawMaterial.size}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.rawMaterial.code}</div>
          </div>
        ),
      },
      {
        header: 'To send / sent',
        accessorKey: 'quantity',
        meta: { sortKey: 'quantity', align: 'right' },
        cell: ({ row }) => (
          <div className="text-right whitespace-nowrap">
            <div className="font-semibold">{fmtQty(row.original.quantity)} kg</div>
            <div className="text-xs text-muted-foreground">{fmtQty(row.original.issuedQty)} sent</div>
          </div>
        ),
      },
      {
        header: 'In store',
        id: 'stock',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const r = row.original;
          const short = open(r) && r.inStoreKg < r3(r.quantity - r.issuedQty);
          return (
            <span className={cn('whitespace-nowrap', short && 'font-medium text-destructive')}>
              {short && <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />}
              {fmtQty(r.inStoreKg)} kg
            </span>
          );
        },
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <MrStatusBadge status={row.original.status} /> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          open(row.original) && can('material_issues.issue') ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" onClick={() => setIssuing(row.original)}>
                <PackageOpen /> Send
              </Button>
            </div>
          ) : null,
      },
    ],
    [can],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search order no., vendor, grade…"
        onRowClick={(r) => open(r) && can('material_issues.issue') && setIssuing(r)}
        empty={{ title: params.filters.status === 'OPEN' ? 'Nothing to send' : 'No job-work material', description: 'Material to send comes from job work orders.' }}
      />
      {issuing && <IssueDialog target={jwTarget(issuing)} onClose={() => setIssuing(null)} />}
    </>
  );
}

/** What is being issued: a material request of a route card, or material for a job-work vendor. */
interface IssueTarget {
  title: string;
  description: React.ReactNode;
  left: number;
  heatsPath: string;
  issuePath: string;
  done: (kg: string) => string;
}

const mrTarget = (mr: MaterialRequestRow): IssueTarget => ({
  title: `Issue ${mr.mrNo}`,
  description: `${mr.rawMaterial.grade.name} ${mr.rawMaterial.size} for ${mr.routeCard.rcNo} (${mr.routeCard.item.name}).`,
  left: r3(mr.requestedQty - mr.issuedQty),
  heatsPath: `/material-requests/${mr.id}/heats`,
  issuePath: `/material-requests/${mr.id}/issue`,
  done: (kg) => `${kg} kg issued to ${mr.routeCard.rcNo}`,
});

const jwTarget = (m: JobWorkMaterialRow): IssueTarget => ({
  title: `Send to ${m.jobWorkOrder.supplier.name}`,
  description: `${m.rawMaterial.grade.name} ${m.rawMaterial.size} for job work order ${m.jobWorkOrder.jwoNo}. It is booked as "at job work" until the parts come back.`,
  left: r3(m.quantity - m.issuedQty),
  heatsPath: `/job-work-materials/${m.id}/heats`,
  issuePath: `/job-work-materials/${m.id}/issue`,
  done: (kg) => `${kg} kg sent to ${m.jobWorkOrder.supplier.name}`,
});

function IssueDialog({ target, onClose }: { target: IssueTarget; onClose: () => void }) {
  const { data, isLoading } = useApiQuery<{ heats: HeatInStore[] }>(target.heatsPath);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');
  const left = target.left;
  const heats = data?.heats ?? [];
  const total = r3(Object.values(qty).reduce((s, v) => s + (Number(v) || 0), 0));

  /** Oldest heat first until the request is covered. */
  const fillOldest = () => {
    let need = left;
    const next: Record<number, string> = {};
    for (const h of heats) {
      if (need <= 0 || h.status === 'BLOCKED') continue;
      const take = r3(Math.min(need, h.quantity));
      next[h.id] = String(take);
      need = r3(need - take);
    }
    setQty(next);
  };

  const issue = useMutation({
    mutationFn: () =>
      api(target.issuePath, {
        method: 'POST',
        body: {
          issueDate,
          remarks,
          lines: Object.entries(qty)
            .filter(([, v]) => Number(v) > 0)
            .map(([heatId, v]) => ({ heatId: Number(heatId), quantity: Number(v) })),
        },
      }),
    onSuccess: () => {
      toast.success(target.done(fmtQty(total)));
      onClose();
    },
    onError: (err) => showApiError(err),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target.title}</DialogTitle>
          <DialogDescription>
            {target.description} Still to issue: <b>{fmtQty(left)} kg</b>
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : heats.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-3 text-sm">No stock of this material in the RM store. Ask purchase for it.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-muted-foreground">Heats in the RM store, oldest first</span>
              <Button type="button" variant="outline" size="sm" onClick={fillOldest}>
                <Wand2 /> Fill oldest first
              </Button>
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Heat</th>
                    <th className="px-3 py-2 text-left">Received</th>
                    <th className="px-3 py-2 text-right">In store (kg)</th>
                    <th className="w-36 px-3 py-2 text-right">Issue (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {heats.map((h) => (
                    <tr key={h.id} className={cn('border-t', h.status === 'BLOCKED' && 'opacity-60')}>
                      <td className="px-3 py-2">
                        <div className="font-mono font-semibold">{h.heatNo}</div>
                        <div className="text-xs text-muted-foreground">{[h.millHeatNo && `mill ${h.millHeatNo}`, h.supplier?.name].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(h.receivedDate)}</td>
                      <td className="tabular px-3 py-2 text-right">{fmtQty(h.quantity)}</td>
                      <td className="px-3 py-1.5">
                        {h.status === 'BLOCKED' ? (
                          <Badge variant="destructive" className="ml-auto">
                            Blocked
                          </Badge>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="0.001"
                            max={h.quantity}
                            value={qty[h.id] ?? ''}
                            onChange={(e) => setQty({ ...qty, [h.id]: e.target.value })}
                            className="ml-auto h-8 w-28 text-right"
                            aria-label={`Issue from heat ${h.heatNo}`}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FormGrid>
              <Field label="Issue date">
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </Field>
              <Field label="Note">
                <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. 3 bars, 6 m each" />
              </Field>
            </FormGrid>
          </div>
        )}
        <DialogFooter className="items-center pt-2">
          <span className={cn('mr-auto text-sm', total > left + 0.0005 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
            Issuing {fmtQty(total)} of {fmtQty(left)} kg
          </span>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => issue.mutate()} loading={issue.isPending} disabled={total <= 0 || total > left + 0.0005}>
            Issue {fmtQty(total)} kg
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseDialog({ mr, onClose }: { mr: MaterialRequestRow; onClose: () => void }) {
  const short = Math.max(0, r3(mr.requestedQty - mr.issuedQty - mr.inStoreKg));
  const [quantity, setQuantity] = useState(short ? String(short) : '');
  const [requiredBy, setRequiredBy] = useState('');
  const buy = useMutation({
    mutationFn: () => api<{ prNo: string }>(`/material-requests/${mr.id}/purchase-requisition`, { method: 'POST', body: { quantity, requiredBy } }),
    onSuccess: (r) => {
      toast.success(`Purchase requisition ${r.prNo} raised`);
      onClose();
    },
    onError: (err) => showApiError(err),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask purchase</DialogTitle>
          <DialogDescription>
            A purchase requisition for {mr.rawMaterial.grade.name} {mr.rawMaterial.size}, linked to {mr.mrNo}.
          </DialogDescription>
        </DialogHeader>
        <FormGrid>
          <Field label="Quantity (kg)" required hint={short ? `Short now: ${fmtQty(short)} kg` : undefined}>
            <Input type="number" min={0} step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </Field>
          <Field label="Needed by">
            <Input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
          </Field>
        </FormGrid>
        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => buy.mutate()} loading={buy.isPending} disabled={!(Number(quantity) > 0)}>
            Raise requisition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
