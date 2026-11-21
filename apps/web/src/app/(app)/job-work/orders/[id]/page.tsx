'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ArrowLeft, Ban, CheckCheck, FileText, PackageCheck, PackageOpen, Pencil, Printer, Undo2 } from 'lucide-react';
import { materialReturnSchema, type MaterialReturnInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups, useSave } from '@/hooks/use-api';
import type { JobWorkOrder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Attachments } from '@/components/app/attachments';
import { FormGrid, SelectField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { JwoStatusBadge, MrStatusBadge, PoStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { JWO_READERS } from '@/components/jobwork/jwo-access';
import { JobWorkEditor } from '@/components/jobwork/jwo-editor';
import { ReceiptDialog } from '@/components/jobwork/receipt-dialog';

export default function JobWorkOrderPage() {
  return (
    <RequirePermission permission={JWO_READERS}>
      <JobWorkDetail />
    </RequirePermission>
  );
}

function JobWorkDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const { data: jwo, isError } = useApiQuery<JobWorkOrder>(`/job-work-orders/${id}`);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'cancel' | 'close' | 'receive' | 'return' | null>(null);

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<{ id: number; poNo: string } | undefined>(`/job-work-orders/${id}${path}`, { method: 'POST', body }),
    onError: (err) => showApiError(err),
  });

  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Job work order not found.</p>;
  if (!jwo) return <Skeleton className="h-96" />;

  const running = ['OPEN', 'MATERIAL_ISSUED', 'PARTIALLY_RECEIVED'].includes(jwo.status);
  const untouched = jwo.status === 'OPEN' && !jwo.receipts.length && jwo.materials.every((m) => !m.issues.length);
  const po = jwo.purchaseOrders.find((p) => p.status !== 'CANCELLED');
  const ordered = jwo.lines.reduce((s, l) => s + l.quantity, 0);
  const back = jwo.lines.reduce((s, l) => s + l.receivedQty, 0);

  const makePo = () =>
    act.mutate(
      { path: '/purchase-order' },
      {
        onSuccess: (r) => {
          toast.success(`Job-work PO ${r!.poNo} made as draft`);
          router.push(`/purchase/orders/${r!.id}`);
        },
      },
    );

  return (
    <>
      <PageHeader
        title={jwo.jwoNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <JwoStatusBadge status={jwo.status} />
            <span>
              {jwo.supplier.name} · {fmtDate(jwo.jwoDate)}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/job-work-orders/${jwo.id}/pdf`} target="_blank" rel="noreferrer">
                <Printer /> Print challan
              </a>
            </Button>
            {running && can('job_work_receipts.create') && !editing && (
              <Button onClick={() => setDialog('receive')}>
                <PackageCheck /> Receive parts
              </Button>
            )}
            {untouched && !po && can('job_work_orders.update') && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {running && !po && can('purchase_orders.create') && !editing && (
              <Button variant="outline" onClick={makePo} loading={act.isPending}>
                <FileText /> Make job-work PO
              </Button>
            )}
            {running && jwo.receipts.length > 0 && can('job_work_orders.update') && !editing && (
              <Button variant="outline" onClick={() => setDialog('close')}>
                <CheckCheck /> Close short
              </Button>
            )}
            {running && !jwo.receipts.length && can('job_work_orders.update') && !editing && (
              <Button variant="outline" className="text-destructive" onClick={() => setDialog('cancel')}>
                <Ban /> Cancel
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href="/job-work/orders">
                <ArrowLeft /> All orders
              </Link>
            </Button>
          </>
        }
      />

      {jwo.status === 'CANCELLED' && (
        <div className="mb-4 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          <span className="font-medium">Cancelled:</span> {jwo.cancelReason}
        </div>
      )}
      {jwo.status === 'COMPLETED' && (
        <div role="status" className="mb-4 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm">
          {jwo.cancelReason ? (
            <>
              <span className="font-medium">Closed short:</span> {jwo.cancelReason}.{' '}
            </>
          ) : (
            'All parts received. '
          )}
          {jwo.heatsUsed.length > 0 && `Material used by the vendor: ${jwo.heatsUsed.map((h) => `${h.heatNo} ${fmtQty(h.quantity)} kg`).join(', ')}.`}
        </div>
      )}

      {editing ? (
        <EditJobWork jwo={jwo} onDone={() => setEditing(false)} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Vendor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="font-medium">{jwo.supplier.name}</div>
                <div className="text-muted-foreground">{[jwo.supplier.contactPerson, jwo.supplier.phone].filter(Boolean).join(' · ')}</div>
                {jwo.supplier.gstin && <div className="font-mono text-xs text-muted-foreground">GSTIN {jwo.supplier.gstin}</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>For</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {jwo.salesOrder ? (
                  <>
                    <Link href={`/sales/orders/${jwo.salesOrder.id}`} className="font-mono font-medium text-primary hover:underline">
                      {jwo.salesOrder.soNo}
                    </Link>
                    <div>{jwo.salesOrder.customer.name}</div>
                  </>
                ) : (
                  <Badge variant="secondary">For stock</Badge>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div>
                  <span className="text-xl font-semibold">{fmtQty(back)}</span> <span className="text-muted-foreground">of {fmtQty(ordered)} pcs back</span>
                </div>
                <div className="text-muted-foreground">
                  Back by {fmtDate(jwo.expectedDate)}
                  {jwo.challanNo && ` · challan ${jwo.challanNo}`}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Charges</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="text-xl font-semibold">{fmtMoney(jwo.charges)}</div>
                {po ? (
                  <Link href={`/purchase/orders/${po.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                    <span className="font-mono text-primary">{po.poNo}</span> <PoStatusBadge status={po.status} />
                  </Link>
                ) : (
                  <div className="text-muted-foreground">No PO yet (+ GST)</div>
                )}
              </CardContent>
            </Card>
          </div>

          {jwo.remarks && (
            <div className="rounded-lg border bg-card px-4 py-3 text-sm whitespace-pre-line">
              <span className="font-medium">Instructions: </span>
              {jwo.remarks}
            </div>
          )}

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Parts</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Part</th>
                      <th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">Accepted</th>
                      <th className="px-3 py-2 text-right">Rejected</th>
                      <th className="px-3 py-2 text-right">Pending</th>
                      <th className="px-4 py-2 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jwo.lines.map((l) => {
                      const pending = Math.max(0, l.quantity - l.receivedQty);
                      return (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="font-medium">{l.item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {[l.item.code, l.item.drawingNo && `Drg ${l.item.drawingNo}`, l.salesOrderLineId && 'SO line', l.remarks].filter(Boolean).join(' · ')}
                            </div>
                          </td>
                          <td className="tabular px-3 py-2.5 text-right">{fmtQty(l.quantity)}</td>
                          <td className="tabular px-3 py-2.5 text-right font-medium text-success">{fmtQty(l.receivedQty)}</td>
                          <td className={cn('tabular px-3 py-2.5 text-right', l.rejectedQty > 0 && 'text-destructive')}>{fmtQty(l.rejectedQty)}</td>
                          <td className={cn('tabular px-3 py-2.5 text-right', pending > 0 && running && 'font-semibold')}>{fmtQty(pending)}</td>
                          <td className="tabular px-4 py-2.5 text-right">{l.rate ? fmtMoney(l.rate) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <PackageOpen className="size-4 text-primary" /> Our material
                </CardTitle>
                <CardDescription>
                  {jwo.materials.length ? 'The store sends it from Material issue → For job work.' : 'None: the vendor uses own material.'}
                </CardDescription>
              </div>
              {jwo.heatsAtVendor.length > 0 && can('material_issues.issue') && running && (
                <Button size="sm" variant="outline" onClick={() => setDialog('return')}>
                  <Undo2 /> Back from vendor
                </Button>
              )}
            </CardHeader>
            {jwo.materials.length > 0 && (
              <CardContent className="space-y-4 pt-3">
                {jwo.heatsAtVendor.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-muted-foreground">With the vendor:</span>
                    {jwo.heatsAtVendor.map((h) => (
                      <span key={h.heatId} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1">
                        <span className="font-mono font-semibold">{h.heatNo}</span>
                        <span className="tabular">{fmtQty(h.quantity)} kg</span>
                      </span>
                    ))}
                  </div>
                )}
                <ul className="divide-y rounded-lg border text-sm">
                  {jwo.materials.map((m) => (
                    <li key={m.id} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">
                          {m.rawMaterial.grade.name} · {m.rawMaterial.size}
                        </span>
                        <span className="tabular text-muted-foreground">
                          {fmtQty(m.issuedQty)} of {fmtQty(m.quantity)} kg sent
                        </span>
                        <span className="ml-auto">
                          <MrStatusBadge status={m.status} />
                        </span>
                      </div>
                      {m.issues.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                          {m.issues.map((i) => (
                            <li key={i.id}>
                              <span className={cn('tabular font-medium', i.quantity < 0 ? 'text-warning' : 'text-foreground')}>
                                {i.quantity < 0 ? '−' : '+'}
                                {fmtQty(Math.abs(i.quantity))} kg
                              </span>{' '}
                              <span className="font-mono">{i.heat.heatNo}</span> {i.quantity < 0 ? 'back from vendor' : 'sent'} · {i.issuedBy.name} · {fmtDate(i.issueDate)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Receipts & QC</CardTitle>
              <CardDescription>Accepted pieces are in the FG store under their heat.</CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              {jwo.receipts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing received yet.</p>
              ) : (
                <ul className="space-y-3">
                  {jwo.receipts.map((r) => (
                    <li key={r.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono font-semibold">{r.receiptNo}</span>
                        <span className="text-muted-foreground">
                          {fmtDate(r.receiptDate)}
                          {r.vendorChallan && ` · challan ${r.vendorChallan}`}
                          {r.inspectorName && ` · QC ${r.inspectorName}`} · {r.createdBy?.name}
                        </span>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-[13px]">
                        {r.lines.map((l) => (
                          <li key={l.id}>
                            {l.item.name}: <span className="font-medium text-success">{fmtQty(l.acceptedQty)} accepted</span>
                            {l.rejectedQty > 0 && <span className="text-destructive"> · {fmtQty(l.rejectedQty)} rejected ({l.remarks})</span>}
                            {l.heat && <span className="font-mono text-muted-foreground"> · {l.heat.heatNo}</span>}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Attachments entity="job_work_order" entityId={jwo.id} canEdit={can('job_work_orders.update')} title="Documents (vendor challan, QC reports)" />
              <p className="mt-2 text-xs text-muted-foreground">
                Made by {jwo.createdBy?.name ?? '—'} · {fmtDateTime(jwo.createdAt)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {dialog === 'receive' && <ReceiptDialog jwo={jwo} onClose={() => setDialog(null)} />}
      {dialog === 'return' && <ReturnDialog jwo={jwo} onClose={() => setDialog(null)} />}
      {(dialog === 'cancel' || dialog === 'close') && (
        <ReasonDialog
          title={dialog === 'cancel' ? `Cancel ${jwo.jwoNo}?` : `Close ${jwo.jwoNo} short?`}
          description={
            dialog === 'cancel'
              ? 'Only before anything is received; material sent must be back from the vendor first.'
              : 'The pending pieces will not come. Material still with the vendor is booked as used.'
          }
          confirmLabel={dialog === 'cancel' ? 'Cancel order' : 'Close short'}
          saving={act.isPending}
          onConfirm={(reason) =>
            act.mutate(
              { path: `/${dialog}`, body: { reason } },
              {
                onSuccess: () => {
                  toast.success(dialog === 'cancel' ? 'Job work order cancelled' : 'Job work order closed');
                  setDialog(null);
                },
              },
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function ReturnDialog({ jwo, onClose }: { jwo: JobWorkOrder; onClose: () => void }) {
  const heats = jwo.heatsAtVendor;
  const defaults: z.input<typeof materialReturnSchema> = { heatId: heats.length === 1 ? heats[0].heatId : ('' as unknown as number), quantity: '', remarks: '' };
  const form = useZodForm(materialReturnSchema, defaults);
  const save = useSave<MaterialReturnInput>({ path: `/job-work-orders/${jwo.id}/material-returns`, form, label: 'Return', successMessage: 'Material back in the RM store', onSaved: onClose });
  const heat = heats.find((h) => h.heatId === Number(form.watch('heatId')));
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Material back from vendor"
      description={`Unused bar from ${jwo.supplier.name} goes back into the RM store under the same heat.`}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel="Back to store"
    >
      <FormGrid>
        <SelectField
          form={form}
          name="heatId"
          label="Heat"
          required
          numeric
          placeholder={heats.length > 1 ? 'Choose heat…' : undefined}
          options={heats.map((h) => ({ value: h.heatId, label: `${h.heatNo} (${fmtQty(h.quantity)} kg with vendor)` }))}
        />
        <TextField form={form} name="quantity" label="Quantity (kg)" type="number" min={0} step="0.001" required hint={heat ? `Up to ${fmtQty(heat.quantity)} kg` : undefined} />
      </FormGrid>
      <TextField form={form} name="remarks" label="Note" />
    </FormDialog>
  );
}

function EditJobWork({ jwo, onDone }: { jwo: JobWorkOrder; onDone: () => void }) {
  const lookups = useLookups('suppliers', 'items', 'rawMaterials');
  if (!lookups.data) return <Skeleton className="h-96" />;
  return (
    <JobWorkEditor
      lookups={lookups.data}
      soLabel={jwo.salesOrder ? `${jwo.salesOrder.soNo} · ${jwo.salesOrder.customer.name}` : null}
      itemLabels={Object.fromEntries(jwo.lines.map((l) => [l.itemId, l.item.name]))}
      initial={{
        jwoDate: toInputDate(jwo.jwoDate),
        supplierId: jwo.supplierId,
        salesOrderId: jwo.salesOrderId ?? '',
        challanNo: jwo.challanNo ?? '',
        expectedDate: toInputDate(jwo.expectedDate),
        remarks: jwo.remarks ?? '',
        lines: jwo.lines.map((l) => ({ itemId: l.itemId, salesOrderLineId: l.salesOrderLineId ?? '', quantity: l.quantity, rate: l.rate, remarks: l.remarks ?? '' })),
        materials: jwo.materials.map((m) => ({ rawMaterialId: m.rawMaterialId, quantity: m.quantity })),
      }}
      submit={async (values) => {
        await api(`/job-work-orders/${jwo.id}`, { method: 'PUT', body: values });
        toast.success('Job work order saved');
        onDone();
      }}
      submitLabel="Save"
      footer={
        <Button type="button" variant="outline" onClick={onDone}>
          Close
        </Button>
      }
    />
  );
}
