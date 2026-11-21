'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Undo2 } from 'lucide-react';
import { END_CONNECTION_LABELS } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtQty } from '@/lib/format';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import type { Assembly } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { AssemblyStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { BILLING_READERS } from '@/components/billing/billing-access';

export default function AssemblyPage() {
  return (
    <RequirePermission permission={BILLING_READERS}>
      <AssemblyDetail />
    </RequirePermission>
  );
}

function AssemblyDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const { data: a, isError } = useApiQuery<Assembly>(`/assemblies/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const invoice = useMutation({
    mutationFn: () => api<{ id: number }>(`/assemblies/${id}/invoice`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success('Draft invoice made - check it and issue it');
      router.push(`/billing/invoices/${r.id}`);
    },
    onError: (err) => showApiError(err),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api(`/assemblies/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Unpacked; the parts are back in the FG store');
      setCancelling(false);
    },
    onError: (err) => showApiError(err),
  });

  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Packing not found.</p>;
  if (!a) return <Skeleton className="h-96" />;
  const liveInvoice = a.invoices.find((i) => i.status !== 'CANCELLED');

  return (
    <>
      <PageHeader
        title={a.assemblyNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AssemblyStatusBadge status={a.status} />
            <span>
              {a.salesOrder.customer.name} · {fmtDate(a.assemblyDate)}
            </span>
          </span>
        }
        actions={
          <>
            {liveInvoice ? (
              <Button asChild>
                <Link href={`/billing/invoices/${liveInvoice.id}`}>
                  <FileText /> {liveInvoice.status === 'DRAFT' ? 'Open draft invoice' : liveInvoice.invoiceNo}
                </Link>
              </Button>
            ) : (
              a.status === 'PACKED' &&
              can('invoices.create') && (
                <Button onClick={() => invoice.mutate()} loading={invoice.isPending}>
                  <FileText /> Make invoice
                </Button>
              )
            )}
            {a.status === 'PACKED' && !liveInvoice && can('assemblies.update') && (
              <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}>
                <Undo2 /> Unpack
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href={`/sales/orders/${a.salesOrder.id}`}>
                <ArrowLeft /> {a.salesOrder.soNo}
              </Link>
            </Button>
          </>
        }
      />
      {a.status === 'CANCELLED' && (
        <div className="mb-4 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          <span className="font-medium">Unpacked:</span> {a.cancelReason}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Sets and the heats of their parts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {a.lines.map((l) => {
              const parts = a.consumptions.filter((c) => c.item.productId === l.salesOrderLine.product.id);
              return (
                <div key={l.id} className="overflow-hidden rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
                    <span className="font-medium">
                      {l.salesOrderLine.product.name}
                      {l.salesOrderLine.endConnection !== 'NONE' && <span className="font-normal text-muted-foreground"> · {END_CONNECTION_LABELS[l.salesOrderLine.endConnection]}</span>}
                    </span>
                    <span className="font-semibold">{fmtQty(l.quantity)} set(s)</span>
                  </div>
                  <ul className="divide-y text-sm">
                    {parts.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2">
                        <span className="w-20 font-medium">{c.item.partType.name}</span>
                        <span className="flex-1 text-[13px] text-muted-foreground">{c.item.code}</span>
                        <span className="font-mono text-[13px]">{c.heat ? c.heat.heatNo : 'no heat'}</span>
                        <span className="tabular w-16 text-right">{fmtQty(c.quantity)} pcs</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Order" value={<Link href={`/sales/orders/${a.salesOrder.id}`} className="font-mono text-primary hover:underline">{a.salesOrder.soNo}</Link>} />
            <Row label="Customer PO" value={a.salesOrder.customerPoNo ?? '—'} />
            <Row label="Packing" value={a.packingType ?? '—'} />
            <Row label="Packages" value={a.packages ?? '—'} />
            <Row label="Gross weight" value={a.grossWeightKg != null ? `${fmtQty(a.grossWeightKg)} kg` : '—'} />
            <Row label="Packed by" value={a.packedBy ?? '—'} />
            {a.remarks && <Row label="Note" value={a.remarks} />}
            <p className="pt-2 text-xs text-muted-foreground">
              Entered by {a.createdBy?.name ?? '—'} · {fmtDateTime(a.createdAt)}
            </p>
          </CardContent>
        </Card>
      </div>
      {cancelling && (
        <ReasonDialog
          title={`Unpack ${a.assemblyNo}?`}
          description="The parts go back into the FG store under their heats."
          confirmLabel="Unpack"
          saving={cancel.isPending}
          onConfirm={(reason) => cancel.mutate(reason)}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
