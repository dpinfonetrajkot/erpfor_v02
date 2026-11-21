'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Ban, FileSearch, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react';
import { APPROVAL_STAGE_LABELS } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups } from '@/hooks/use-api';
import type { SalesOrder } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { SoStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { SO_READERS } from '@/components/sales/so-access';
import { initialSoValues, SoEditor } from '@/components/sales/so-editor';
import { SoView } from '@/components/sales/so-view';

export default function SalesOrderPage() {
  return (
    <RequirePermission permission={SO_READERS}>
      <SalesOrderDetail />
    </RequirePermission>
  );
}

function SalesOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, user } = useSession();
  const { data: so, isError } = useApiQuery<SalesOrder>(`/sales-orders/${id}`);
  const lookups = useLookups('customers', 'products', 'materialGrades', 'users');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'submit' | 'reopen' | 'cancel' | 'delete' | null>(null);

  const action = useMutation({
    mutationFn: ({ path, body, method = 'POST' }: { path: string; body?: unknown; method?: 'POST' | 'DELETE' }) =>
      api<SalesOrder>(`/sales-orders/${id}${path}`, { method, body }),
    onError: (err) => showApiError(err),
  });
  const run = (path: string, message: string, body?: unknown) =>
    action.mutate(
      { path, body },
      {
        onSuccess: () => {
          toast.success(message);
          setDialog(null);
        },
      },
    );

  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Sales order not found.</p>;
  if (!so || !lookups.data) return <Skeleton className="h-96" />;

  const editable = (so.status === 'DRAFT' || so.status === 'PENDING_APPROVAL') && can('sales_orders.update');
  const rejection = so.status === 'DRAFT' ? so.approvals.find((a) => a.decision === 'REJECTED' && so.approvals[0]?.id === a.id) : undefined;

  return (
    <>
      <PageHeader
        title={so.soNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SoStatusBadge status={so.status} />
            <span>
              {so.customer.name} · {fmtDate(so.soDate)}
            </span>
          </span>
        }
        actions={
          <>
            {editable && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {so.status === 'DRAFT' && !editing && can('sales_orders.update') && (
              <Button onClick={() => setDialog('submit')}>
                <Send /> Send for approval
              </Button>
            )}
            {so.status === 'APPROVED' && can('sales_orders.update') && (
              <Button variant="outline" onClick={() => setDialog('reopen')}>
                <RotateCcw /> Reopen for changes
              </Button>
            )}
            {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION'].includes(so.status) && can('sales_orders.update') && !editing && (
              <Button variant="outline" className="text-destructive" onClick={() => setDialog('cancel')}>
                <Ban /> Cancel order
              </Button>
            )}
            {so.status === 'DRAFT' && !so.submittedAt && can('sales_orders.delete') && !editing && (
              <Button variant="ghost" className="text-destructive" onClick={() => setDialog('delete')}>
                <Trash2 /> Delete
              </Button>
            )}
            {['IN_PRODUCTION', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'CLOSED'].includes(so.status) && can('traceability.view') && !editing && (
              <Button variant="outline" asChild>
                <Link href={`/reports/traceability/order/${so.id}`}>
                  <FileSearch /> Traceability
                </Link>
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href="/sales/orders">
                <ArrowLeft /> All orders
              </Link>
            </Button>
          </>
        }
      />

      {rejection && (
        <div role="alert" className="mb-4 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <span className="font-medium">{APPROVAL_STAGE_LABELS[rejection.stage]} rejected by {rejection.user.name}:</span> {rejection.remarks}
            <div className="text-xs text-muted-foreground">Change the order and send it for approval again.</div>
          </div>
        </div>
      )}
      {so.status === 'CANCELLED' && so.cancelReason && (
        <div className="mb-4 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          <span className="font-medium">Cancelled:</span> {so.cancelReason}
        </div>
      )}
      {so.status === 'PENDING_APPROVAL' && editing && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">Saving changes restarts all three approvals.</div>
      )}

      {editing ? (
        <SoEditor
          key={so.id}
          so={so}
          lookups={lookups.data}
          initial={initialSoValues(so, user.id)}
          onSaved={() => setEditing(false)}
          footer={() => (
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Close editor
            </Button>
          )}
        />
      ) : (
        <SoView so={so} />
      )}

      <ConfirmDialog
        open={dialog === 'submit'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Send ${so.soNo} for approval?`}
        description="Feasibility, design and production will be asked to approve it."
        confirmLabel="Send for approval"
        destructive={false}
        loading={action.isPending}
        onConfirm={() => run('/submit', `${so.soNo} sent for approval`)}
      />
      <ConfirmDialog
        open={dialog === 'reopen'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Reopen ${so.soNo}?`}
        description="It goes back to draft and needs all three approvals again after your change."
        confirmLabel="Reopen"
        destructive={false}
        loading={action.isPending}
        onConfirm={() => run('/reopen', `${so.soNo} reopened`)}
      />
      {dialog === 'cancel' && (
        <ReasonDialog
          title={`Cancel ${so.soNo}?`}
          description="Open production requests for this order are cancelled too."
          confirmLabel="Cancel order"
          saving={action.isPending}
          onConfirm={(reason) => run('/cancel', `${so.soNo} cancelled`, { reason })}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete draft ${so.soNo}?`}
        description="Only for an order entered by mistake."
        loading={action.isPending}
        onConfirm={() =>
          action.mutate(
            { path: '', method: 'DELETE' },
            {
              onSuccess: () => {
                toast.success('Draft deleted');
                router.replace('/sales/orders');
              },
            },
          )
        }
      />
    </>
  );
}
