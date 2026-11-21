'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, FileText, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups } from '@/hooks/use-api';
import type { PurchaseOrder } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { PoStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { initialPoValues, PoEditor } from '@/components/purchase/po-editor';
import { PoView } from '@/components/purchase/po-view';

export default function PurchaseOrderPage() {
  return (
    <RequirePermission permission="purchase_orders.view">
      <PurchaseOrderDetail />
    </RequirePermission>
  );
}

function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const { data: po, isError } = useApiQuery<PurchaseOrder>(`/purchase-orders/${id}`);
  const lookups = useLookups('companies', 'suppliers', 'rawMaterials');
  const [confirm, setConfirm] = useState<'approve' | 'delete' | null>(null);

  const approve = useMutation({
    mutationFn: () => api(`/purchase-orders/${id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Approved and issued. You can now send it to the supplier.');
      setConfirm(null);
    },
    onError: (err) => showApiError(err),
  });
  const remove = useMutation({
    mutationFn: () => api(`/purchase-orders/${id}`, { method: 'DELETE' }),
    meta: { skipInvalidate: true },
    onSuccess: () => {
      toast.success('Draft deleted');
      router.replace('/purchase/orders');
    },
    onError: (err) => showApiError(err),
  });

  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Purchase order not found.</p>;
  if (!po || !lookups.data) return <Skeleton className="h-96" />;

  const editable = po.status === 'DRAFT' && can('purchase_orders.update');

  return (
    <>
      <PageHeader
        title={po.poNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PoStatusBadge status={po.status} />
            <span>
              {po.supplier.name} · {fmtDate(po.poDate)}
            </span>
            {po.jobWorkOrder && (
              <Link href={`/job-work/orders/${po.jobWorkOrder.id}`} className="text-primary hover:underline">
                Job work · {po.jobWorkOrder.jwoNo}
              </Link>
            )}
          </span>
        }
        actions={
          <Button variant="ghost" asChild>
            <Link href="/purchase/orders">
              <ArrowLeft /> All orders
            </Link>
          </Button>
        }
      />
      {editable ? (
        <PoEditor
          key={po.id}
          po={po}
          lookups={lookups.data}
          initial={initialPoValues(lookups.data, po, [])}
          prLabels={Object.fromEntries(po.lines.filter((l) => l.purchaseRequisition).map((l) => [l.purchaseRequisition!.id, l.purchaseRequisition!.prNo]))}
          footer={({ dirty }) => (
            <>
              {can('purchase_orders.delete') && (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirm('delete')}>
                  <Trash2 /> Delete
                </Button>
              )}
              <Button type="button" variant="outline" asChild>
                <a href={`/api/purchase-orders/${po.id}/pdf`} target="_blank" rel="noreferrer">
                  <FileText /> Preview PDF
                </a>
              </Button>
              {can('purchase_orders.approve') && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirm('approve')}
                  disabled={dirty}
                  title={dirty ? 'Save the changes first' : undefined}
                >
                  <CheckCircle2 /> Approve & issue
                </Button>
              )}
            </>
          )}
        />
      ) : (
        <PoView po={po} />
      )}
      <ConfirmDialog
        open={confirm === 'approve'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Approve ${po.poNo}?`}
        description="After approval the PO cannot be edited. It can be sent to the supplier and material can be received against it."
        confirmLabel="Approve & issue"
        destructive={false}
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete draft ${po.poNo}?`}
        description="Its requisitions go back to pending."
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
