'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Flame, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtQty } from '@/lib/format';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import type { GoodsReceipt } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Attachments } from '@/components/app/attachments';
import { PageHeader } from '@/components/app/page-header';
import { GrnStatusBadge, QcStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { GrnForm } from '@/components/store/grn-form';
import { QcPanel } from '@/components/store/qc-panel';

export default function GateEntryDetailPage() {
  return (
    <RequirePermission permission={['goods_receipts.view', 'incoming_qc.view']}>
      <GateEntryDetail />
    </RequirePermission>
  );
}

function GateEntryDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const { data: grn, isError } = useApiQuery<GoodsReceipt>(`/goods-receipts/${id}`);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/goods-receipts/${id}`, { method: 'DELETE' }),
    meta: { skipInvalidate: true },
    onSuccess: () => {
      toast.success('Gate entry deleted');
      router.replace('/store/gate-entry');
    },
    onError: (err) => showApiError(err),
  });

  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Gate entry not found.</p>;
  if (!grn) return <Skeleton className="h-96" />;

  const untouched = grn.status === 'PENDING_QC' && grn.lines.every((l) => l.qcStatus === 'PENDING');
  const showQc = grn.status === 'PENDING_QC' && can('incoming_qc.update');

  return (
    <>
      <PageHeader
        title={`Gate entry ${grn.grnNo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <GrnStatusBadge status={grn.status} />
            <span>
              {grn.supplier.name} · {fmtDate(grn.grnDate)}
            </span>
          </span>
        }
        actions={
          <>
            {untouched && can('goods_receipts.update') && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {untouched && can('goods_receipts.delete') && (
              <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
                <Trash2 /> Delete
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href="/store/gate-entry">
                <ArrowLeft /> All gate entries
              </Link>
            </Button>
          </>
        }
      />

      {editing ? (
        <GrnForm grn={grn} onDone={() => setEditing(false)} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Info title="Supplier" lines={[grn.supplier.name, grn.supplier.code]} />
            <Card>
              <CardHeader>
                <CardTitle>Purchase order</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {grn.purchaseOrder ? (
                  <Link href={`/purchase/orders/${grn.purchaseOrder.id}`} className="font-mono font-medium text-primary hover:underline">
                    {grn.purchaseOrder.poNo}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Direct receipt (no PO)</span>
                )}
              </CardContent>
            </Card>
            <Info
              title="Vehicle & documents"
              lines={[
                `Vehicle: ${grn.vehicleNo ?? '—'}`,
                `Challan: ${grn.supplierChallan ?? '—'}`,
                `Invoice: ${grn.supplierInvoice ?? '—'}`,
              ]}
            />
          </div>

          {showQc && <QcPanel key={grn.lines.map((l) => l.qcStatus).join()} grn={grn} />}

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Material</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Material</th>
                      <th className="px-3 py-2 text-left">Mill heat</th>
                      <th className="px-3 py-2 text-right">Received</th>
                      <th className="px-3 py-2 text-right">Accepted</th>
                      <th className="px-3 py-2 text-right">Rejected</th>
                      <th className="px-3 py-2 text-left">QC</th>
                      <th className="px-4 py-2 text-left">Heat no.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grn.lines.map((l) => (
                      <tr key={l.id} className="border-b align-top last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="font-medium">
                            {l.rawMaterial.grade.name} · {l.rawMaterial.size}
                          </div>
                          {l.qcRemarks && <div className="text-xs text-muted-foreground">QC: {l.qcRemarks}</div>}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs">{l.millHeatNo ?? '—'}</td>
                        <td className="tabular px-3 py-2.5 text-right">{fmtQty(l.receivedQty)}</td>
                        <td className="tabular px-3 py-2.5 text-right">{l.qcStatus === 'PENDING' ? '—' : fmtQty(l.acceptedQty)}</td>
                        <td className={`tabular px-3 py-2.5 text-right ${l.rejectedQty > 0 ? 'text-destructive' : ''}`}>{l.qcStatus === 'PENDING' ? '—' : fmtQty(l.rejectedQty)}</td>
                        <td className="px-3 py-2.5">
                          <QcStatusBadge status={l.qcStatus} />
                          {l.inspectedAt && <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(l.inspectedAt)}</div>}
                        </td>
                        <td className="px-4 py-2.5">
                          {l.heat ? (
                            <Link href={`/masters/heats?search=${encodeURIComponent(l.heat.heatNo)}`} className="inline-flex items-center gap-1 font-mono font-semibold text-primary hover:underline">
                              <Flame className="size-3.5" /> {l.heat.heatNo}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {grn.remarks && <Info title="Remarks" lines={[grn.remarks]} />}
            <Card>
              <CardContent className="pt-5">
                <Attachments entity="goods_receipt" entityId={grn.id} canEdit={can('goods_receipts.update') || can('incoming_qc.update')} title="Challan, invoice & photos" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete gate entry ${grn.grnNo}?`}
        description="Only possible before QC. Nothing has gone into stock yet."
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function Info({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0.5 text-sm">
        {lines.map((l, i) => (
          <div key={i} className={i === 0 ? 'font-medium' : 'text-muted-foreground'}>
            {l}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
