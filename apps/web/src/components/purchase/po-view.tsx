'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Download, FileText, Lock, Mail, PackageCheck } from 'lucide-react';
import { emailDocumentSchema, GST_TYPE_LABELS, INDIAN_STATES, type EmailDocumentInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from '@/lib/format';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import type { PurchaseOrder } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Attachments } from '@/components/app/attachments';
import { TextField, TextareaField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { GrnStatusBadge, PoStatusBadge } from '@/components/app/status';
import { useSession } from '@/components/app/session';

/** Read-only purchase order (after approval) with its actions. */
export function PoView({ po }: { po: PurchaseOrder }) {
  const { can } = useSession();
  const [emailOpen, setEmailOpen] = useState(false);
  const [closing, setClosing] = useState<'close' | 'cancel' | null>(null);
  const action = useMutation({
    mutationFn: ({ kind, reason }: { kind: 'close' | 'cancel'; reason: string }) =>
      api(`/purchase-orders/${po.id}/${kind}`, { method: 'POST', body: { reason } }),
    onSuccess: (_d, v) => {
      toast.success(v.kind === 'close' ? `${po.poNo} closed` : `${po.poNo} cancelled`);
      setClosing(null);
    },
    onError: (err) => showApiError(err),
  });

  const open = po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED';
  const cur = po.currency;
  const half = po.taxRate / 2;
  const state = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <a href={`/api/purchase-orders/${po.id}/pdf`} target="_blank" rel="noreferrer">
            <FileText /> View PDF
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`/api/purchase-orders/${po.id}/pdf?download=1`}>
            <Download /> Download
          </a>
        </Button>
        {can('purchase_orders.update') && po.status !== 'CANCELLED' && (
          <Button variant="outline" onClick={() => setEmailOpen(true)}>
            <Mail /> {po.emailedAt ? 'E-mail again' : 'E-mail to supplier'}
          </Button>
        )}
        {open && can('goods_receipts.create') && (
          <Button asChild>
            <Link href={`/store/gate-entry/new?poId=${po.id}&supplierId=${po.supplierId}`}>
              <PackageCheck /> Receive at gate
            </Link>
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {open && can('purchase_orders.update') && (
            <Button variant="outline" onClick={() => setClosing('close')}>
              <Lock /> Close PO
            </Button>
          )}
          {po.status === 'ISSUED' && po.goodsReceipts.length === 0 && can('purchase_orders.update') && (
            <Button variant="outline" onClick={() => setClosing('cancel')} className="text-destructive">
              <Ban /> Cancel PO
            </Button>
          )}
        </div>
      </div>

      {po.cancelReason && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
          <span className="font-medium">{po.status === 'CANCELLED' ? 'Cancelled' : 'Closed'}:</span> {po.cancelReason}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Supplier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-medium">{po.supplier.name}</div>
            <div className="text-muted-foreground">{[po.supplier.address, po.supplier.city, state(po.supplier.stateCode)].filter(Boolean).join(', ') || '—'}</div>
            {po.supplier.gstin && <div className="font-mono text-xs">GSTIN {po.supplier.gstin}</div>}
            <div className="text-muted-foreground">{[po.supplier.phone, po.supplier.email].filter(Boolean).join(' · ')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>{po.deliveryAddress || po.company.name}</div>
            <div className="text-muted-foreground">Expected: {fmtDate(po.expectedDelivery)}</div>
            <div className="text-muted-foreground">Payment: {po.paymentTerms || '—'}</div>
            {po.quotationRef && <div className="text-muted-foreground">Quotation: {po.quotationRef}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              Ordered by <span className="font-medium">{po.company.name}</span>
            </div>
            <div className="text-muted-foreground">Approved: {fmtDateTime(po.approvedAt)}</div>
            <div className="text-muted-foreground">E-mailed: {po.emailedAt ? fmtDateTime(po.emailedAt) : 'not yet'}</div>
            <div className="text-muted-foreground">GST: {GST_TYPE_LABELS[po.gstType]}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Materials</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="w-48 px-3 py-2 text-left">Received (QC accepted)</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => {
                  const pct = Math.min(100, Math.round((l.receivedQty / l.quantity) * 100));
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{l.rawMaterial ? `${l.rawMaterial.grade.name} · ${l.rawMaterial.size}` : (l.item?.name ?? l.description)}</div>
                        <div className="text-xs text-muted-foreground">
                          {[l.rawMaterial?.code ?? l.item?.code, l.purchaseRequisition?.prNo, l.description].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {fmtQty(l.quantity)} <span className="text-xs text-muted-foreground">{l.uom.toLowerCase()}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="tabular flex justify-between text-xs">
                          <span>{fmtQty(l.receivedQty)}</span>
                          <span className="text-muted-foreground">{pct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Received">
                          <div className={pct >= 100 ? 'h-full rounded-full bg-success' : 'h-full rounded-full bg-primary'} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{fmtMoney(l.rate, cur)}</td>
                      <td className="tabular px-4 py-2.5 text-right font-medium">{fmtMoney(l.amount, cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="tabular ml-auto max-w-sm space-y-1.5 px-5 py-4 text-sm">
            <Line label="Sub total" value={fmtMoney(po.subTotal, cur)} />
            {po.discountAmount > 0 && <Line label={`Discount (${po.discountPercent}%)`} value={`− ${fmtMoney(po.discountAmount, cur)}`} />}
            {po.freight > 0 && <Line label="Freight" value={fmtMoney(po.freight, cur)} />}
            <Line label="Taxable value" value={fmtMoney(po.taxableAmount, cur)} />
            {po.gstType === 'INTRA_STATE' && (
              <>
                <Line label={`CGST ${half}%`} value={fmtMoney(po.taxAmount / 2, cur)} />
                <Line label={`SGST ${half}%`} value={fmtMoney(po.taxAmount - po.taxAmount / 2, cur)} />
              </>
            )}
            {po.gstType === 'INTER_STATE' && <Line label={`IGST ${po.taxRate}%`} value={fmtMoney(po.taxAmount, cur)} />}
            {po.roundOff !== 0 && <Line label="Round off" value={fmtMoney(po.roundOff, cur)} />}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Grand total</dt>
              <dd>{fmtMoney(po.grandTotal, cur)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Gate entries</CardTitle>
          </CardHeader>
          <CardContent>
            {po.goodsReceipts.length ? (
              <ul className="divide-y text-sm">
                {po.goodsReceipts.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/store/gate-entry/${g.id}`} className="font-mono font-medium text-primary hover:underline">
                      {g.grnNo}
                    </Link>
                    <span className="text-muted-foreground">{fmtDate(g.grnDate)}</span>
                    <GrnStatusBadge status={g.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing received yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <Attachments entity="purchase_order" entityId={po.id} canEdit={can('purchase_orders.update')} title="Quotation & other files" />
          </CardContent>
        </Card>
      </div>

      {emailOpen && <EmailDialog po={po} onClose={() => setEmailOpen(false)} />}
      {closing && (
        <ReasonDialog
          title={closing === 'close' ? `Close ${po.poNo}?` : `Cancel ${po.poNo}?`}
          description={
            closing === 'close'
              ? 'Use this when the rest of the quantity will not come. No more gate entries can be made against it.'
              : 'The supplier will not supply this order. Its requisitions go back to pending.'
          }
          confirmLabel={closing === 'close' ? 'Close PO' : 'Cancel PO'}
          saving={action.isPending}
          onConfirm={(reason) => action.mutate({ kind: closing, reason })}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmailDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const { user } = useSession();
  const defaults = useApiQuery<{ mailEnabled: boolean }>('/purchase-orders/defaults');
  const form = useZodForm(emailDocumentSchema, {
    to: po.supplier.email ?? '',
    cc: '',
    subject: `Purchase Order ${po.poNo} - ${po.company.name}`,
    message: `Dear Sir / Madam,\n\nPlease find attached our purchase order ${po.poNo}. Kindly confirm receipt and the dispatch date.\nPlease send the Mill Test Certificate (MTC) with the material and mark the heat number on every bar.\n\nRegards,\n${user.name}\n${po.company.name}`,
  });
  const send = useMutation({
    mutationFn: (v: EmailDocumentInput) => api<{ sentTo: string }>(`/purchase-orders/${po.id}/email`, { method: 'POST', body: v }),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.sentTo}`);
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`E-mail ${po.poNo}`}
      description={defaults.data && !defaults.data.mailEnabled ? 'E-mail is not set up on the server yet (SMTP settings).' : 'The PO PDF is attached automatically.'}
      onSubmit={form.handleSubmit((v) => send.mutate(v))}
      saving={send.isPending}
      submitLabel="Send"
    >
      <TextField form={form} name="to" label="To" required hint="Separate several addresses with a comma" />
      <TextField form={form} name="cc" label="Cc" />
      <TextField form={form} name="subject" label="Subject" required />
      <TextareaField form={form} name="message" label="Message" rows={7} />
    </FormDialog>
  );
}
