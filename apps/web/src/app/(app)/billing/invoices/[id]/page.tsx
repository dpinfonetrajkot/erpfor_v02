'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import {
  ArrowLeft,
  Ban,
  Banknote,
  ChevronDown,
  Clock,
  FileSearch,
  FileText,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Printer,
  Send,
  Trash2,
  Truck,
  UserRound,
} from 'lucide-react';
import { amountInWords, GST_TYPE_LABELS, INDIAN_STATES, INVOICE_TYPE_LABELS, INVOICE_UNIT_LABELS, PAYMENT_MODE_LABELS } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from '@/lib/format';
import { showApiError, useApiQuery, useLookups } from '@/hooks/use-api';
import type { Invoice } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/components/app/status';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { BILLING_READERS } from '@/components/billing/billing-access';
import { DispatchDialog, EmailDialog, PaymentDialog } from '@/components/billing/dialogs';
import { InvoiceEditor } from '@/components/billing/invoice-editor';

export default function InvoicePage() {
  return (
    <RequirePermission permission={BILLING_READERS}>
      <InvoiceDetail />
    </RequirePermission>
  );
}

type DialogKind = 'delete' | 'cancel' | 'dispatch' | 'pay' | 'email' | null;

function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, user } = useSession();
  const { data: inv, isError } = useApiQuery<Invoice>(`/invoices/${id}`);
  const lookups = useLookups('companies', 'saleItems');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [cancelPayment, setCancelPayment] = useState<number | null>(null);

  const act = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: 'POST' | 'DELETE'; body?: unknown }) => api<Invoice | undefined>(path, { method, body }),
    onError: (err) => showApiError(err),
  });

  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Invoice not found.</p>;
  if (!inv || !lookups.data) return <Skeleton className="h-96" />;

  const draft = inv.status === 'DRAFT';
  const issued = inv.status === 'ISSUED';
  const activeDispatch = inv.dispatches.find((d) => !d.cancelledAt);
  const activePayments = inv.payments.filter((p) => !p.cancelledAt);
  const balance = Math.round((inv.grandTotal - inv.amountPaid) * 100) / 100;
  const cur = inv.currency;
  const pdf = `/api/invoices/${inv.id}/pdf`;
  const canEmail = issued && (can('invoices.update') || can('invoices.approve'));
  const canPay = issued && balance > 0 && can('payments.create');
  const canDispatch = issued && !activeDispatch && !!inv.salesOrder && can('dispatches.create');
  const canCancel = issued && !activeDispatch && !activePayments.length && can('invoices.update');
  const canTrace = issued && !!inv.salesOrder && can('traceability.view');

  return (
    <>
      <PageHeader
        title={draft ? 'Draft invoice' : inv.invoiceNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={inv.status} />
            {issued && <PaymentStatusBadge status={inv.paymentStatus} />}
            <span>
              {INVOICE_TYPE_LABELS[inv.type]} · {inv.billingName} · {fmtDate(inv.invoiceDate)}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href="/billing/invoices">
                <ArrowLeft /> All invoices
              </Link>
            </Button>
            {!draft && (
              <Button variant="outline" asChild>
                <a href={pdf} target="_blank" rel="noreferrer">
                  <Printer /> PDF
                </a>
              </Button>
            )}
            {issued && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Send /> Send <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {canEmail && (
                    <DropdownMenuItem onSelect={() => setDialog('email')}>
                      <Mail /> E-mail with PDF
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <a href={whatsAppLink(inv, balance)} target="_blank" rel="noreferrer">
                      <MessageCircle /> WhatsApp message
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {(canTrace || canCancel) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {canTrace && (
                    <DropdownMenuItem onSelect={() => router.push(`/reports/traceability/order/${inv.salesOrder!.id}`)}>
                      <FileSearch /> Traceability
                    </DropdownMenuItem>
                  )}
                  {canTrace && canCancel && <DropdownMenuSeparator />}
                  {canCancel && (
                    <DropdownMenuItem destructive onSelect={() => setDialog('cancel')}>
                      <Ban /> Cancel invoice
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canDispatch && (
              <Button variant={canPay ? 'outline' : 'default'} onClick={() => setDialog('dispatch')}>
                <Truck /> Dispatch
              </Button>
            )}
            {canPay && (
              <Button onClick={() => setDialog('pay')}>
                <Banknote /> Record payment
              </Button>
            )}
          </>
        }
      />

      {inv.status === 'CANCELLED' && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/6 px-4 py-3 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            <span className="font-medium">Cancelled:</span> {inv.cancelReason}. The number {inv.invoiceNo} stays used.
          </span>
        </div>
      )}

      {draft && can('invoices.update') ? (
        <InvoiceEditor
          key={inv.id}
          inv={inv}
          companies={lookups.data.companies}
          saleItems={lookups.data.saleItems}
          canIssue={can('invoices.approve')}
          footer={() => (
            <>
              <Button type="button" variant="outline" asChild>
                <a href={pdf} target="_blank" rel="noreferrer">
                  <Printer /> Preview
                </a>
              </Button>
              {can('invoices.delete') && (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => setDialog('delete')}>
                  <Trash2 /> Delete draft
                </Button>
              )}
            </>
          )}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <InvoicePaper inv={inv} balance={balance} />
          <aside className="space-y-4 xl:sticky xl:top-20">
            <PaymentPanel inv={inv} balance={balance} onPay={canPay ? () => setDialog('pay') : undefined} onCancelPayment={can('payments.update') ? setCancelPayment : undefined} />
            <DispatchPanel inv={inv} />
            <ActivityPanel inv={inv} />
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete this draft?"
        description={inv.assembly ? 'The packed sets can be invoiced again.' : 'The draft is removed. No number was used.'}
        loading={act.isPending}
        onConfirm={() =>
          act.mutate(
            { path: `/invoices/${inv.id}`, method: 'DELETE' },
            {
              onSuccess: () => {
                toast.success('Draft deleted');
                router.replace(inv.assembly ? `/dispatch/packing/${inv.assembly.id}` : '/billing/invoices');
              },
            },
          )
        }
      />
      {dialog === 'cancel' && (
        <ReasonDialog
          title={`Cancel ${inv.invoiceNo}?`}
          description={`The number stays used (GST).${inv.assembly ? ' The packed sets can be invoiced again.' : ''}`}
          confirmLabel="Cancel invoice"
          saving={act.isPending}
          onConfirm={(reason) =>
            act.mutate(
              { path: `/invoices/${inv.id}/cancel`, body: { reason } },
              {
                onSuccess: () => {
                  toast.success('Invoice cancelled');
                  setDialog(null);
                },
              },
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'dispatch' && (
        <DispatchDialog
          invoiceId={inv.id}
          defaults={{ transporter: inv.transporter ?? '', vehicleNo: inv.vehicleNo ?? '', packages: inv.assembly?.packages, grossWeightKg: inv.assembly?.grossWeightKg }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'pay' && (
        <PaymentDialog
          target={{ direction: 'RECEIPT', id: inv.id, number: inv.invoiceNo, party: inv.billingName, balance, currency: inv.currency }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'email' && (
        <EmailDialog
          title={`E-mail ${inv.invoiceNo}`}
          path={`/invoices/${inv.id}/email`}
          initial={{
            to: inv.customer.email ?? '',
            cc: '',
            subject: `Invoice ${inv.invoiceNo} - ${inv.company.name}`,
            message: `Dear Sir / Madam,\n\nPlease find attached our invoice ${inv.invoiceNo} dated ${fmtDate(inv.invoiceDate)} for ${fmtMoney(inv.grandTotal, cur)}.\n\nRegards,\n${user.name}\n${inv.company.name}`,
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {cancelPayment && (
        <ReasonDialog
          title="Cancel this payment?"
          description="Use this for a wrong entry. The balance of the invoice opens again."
          confirmLabel="Cancel payment"
          saving={act.isPending}
          onConfirm={(reason) =>
            act.mutate(
              { path: `/payments/${cancelPayment}/cancel`, body: { reason } },
              {
                onSuccess: () => {
                  toast.success('Payment cancelled');
                  setCancelPayment(null);
                },
              },
            )
          }
          onClose={() => setCancelPayment(null)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ the invoice, laid out like the printed one

function InvoicePaper({ inv, balance }: { inv: Invoice; balance: number }) {
  const cur = inv.currency;
  const half = inv.taxRate / 2;
  const co = inv.company;
  const coState = INDIAN_STATES.find((s) => s.code === co.stateCode)?.name;
  const supply = INDIAN_STATES.find((s) => s.code === inv.placeOfSupply);
  const shipDiffers = !!inv.shippingName && (inv.shippingName !== inv.billingName || (!!inv.shippingAddress && inv.shippingAddress !== inv.billingAddress));
  const totalQty = inv.lines.reduce((s, l) => s + l.quantity, 0);
  const cancelled = inv.status === 'CANCELLED';

  return (
    <Card className="relative overflow-hidden">
      <div className="h-1.5 bg-primary" aria-hidden />
      {cancelled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 rounded-lg border-4 border-destructive/30 px-8 py-2 text-6xl font-bold tracking-widest text-destructive/20">CANCELLED</span>
        </div>
      )}

      {/* from + invoice number */}
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
        <div className="min-w-0 text-sm">
          <div className="text-lg font-semibold tracking-[-0.01em]">{co.legalName || co.name}</div>
          <div className="mt-1 space-y-0.5 text-muted-foreground">
            {co.address && <div>{co.address}</div>}
            <div>{[co.city, [coState, co.pincode].filter(Boolean).join(' '), co.country !== 'India' ? co.country : null].filter(Boolean).join(', ')}</div>
            {(co.phone || co.email) && <div>{[co.phone, co.email].filter(Boolean).join(' · ')}</div>}
          </div>
          {co.gstin && <div className="mt-2 font-mono text-xs">GSTIN {co.gstin}</div>}
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{INVOICE_TYPE_LABELS[inv.type]}</div>
          <div className="mt-1 font-mono text-2xl font-semibold tracking-tight">{inv.status === 'DRAFT' ? 'DRAFT' : inv.invoiceNo}</div>
          <div className="mt-2 flex gap-1.5 sm:justify-end">
            <InvoiceStatusBadge status={inv.status} />
            {inv.status === 'ISSUED' && <PaymentStatusBadge status={inv.paymentStatus} />}
          </div>
        </div>
      </div>

      {/* key facts */}
      <dl className="grid grid-cols-2 gap-px border-y bg-border text-sm sm:grid-cols-4">
        <Fact label="Invoice date" value={fmtDate(inv.invoiceDate)} />
        <Fact label="Due date" value={fmtDate(inv.dueDate)} />
        <Fact label="Customer PO" value={inv.customerPoNo ? `${inv.customerPoNo}${inv.customerPoDate ? ` · ${fmtDate(inv.customerPoDate)}` : ''}` : '—'} />
        <Fact
          label="Sales order"
          value={
            inv.salesOrder ? (
              <Link href={`/sales/orders/${inv.salesOrder.id}`} className="font-mono text-primary hover:underline">
                {inv.salesOrder.soNo}
              </Link>
            ) : (
              'Direct invoice'
            )
          }
        />
      </dl>

      {/* parties */}
      <div className={cn('grid gap-6 p-6 sm:p-8', shipDiffers ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        <Party title="Bill to" name={inv.billingName} address={inv.billingAddress} gstin={inv.billingGstin} />
        {shipDiffers && <Party title="Ship to" name={inv.shippingName!} address={inv.shippingAddress} gstin={inv.shippingGstin} />}
        <div className="text-sm">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Supply</div>
          <div>{GST_TYPE_LABELS[inv.gstType]}</div>
          {supply && (
            <div className="text-muted-foreground">
              Place of supply: {supply.name} ({supply.code})
            </div>
          )}
          {(inv.transporter || inv.vehicleNo) && <div className="mt-1 text-muted-foreground">{[inv.transporter, inv.vehicleNo].filter(Boolean).join(' · ')}</div>}
          {cur !== 'INR' && (
            <div className="mt-1 text-muted-foreground">
              Currency {cur} · 1 {cur} = ₹{inv.exchangeRate}
            </div>
          )}
        </div>
      </div>

      {/* items */}
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="w-10 py-2.5 pl-6 text-left sm:pl-8">#</th>
              <th className="px-3 py-2.5 text-left">Item / service</th>
              <th className="px-3 py-2.5 text-left">HSN / SAC</th>
              <th className="px-3 py-2.5 text-right">Qty</th>
              <th className="px-3 py-2.5 text-right">Rate</th>
              <th className="py-2.5 pr-6 text-right sm:pr-8">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {inv.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="py-3 pl-6 text-muted-foreground tabular-nums sm:pl-8">{i + 1}</td>
                <td className="px-3 py-3 font-medium">{l.description}</td>
                <td className="px-3 py-3 font-mono text-[13px] text-muted-foreground">{l.hsnCode ?? '—'}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                  {fmtQty(l.quantity)} <span className="text-muted-foreground">{INVOICE_UNIT_LABELS[l.uom] ?? l.uom}</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtMoney(l.rate, cur)}</td>
                <td className="py-3 pr-6 text-right font-medium tabular-nums sm:pr-8">{fmtMoney(l.amount, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* words, bank and terms on the left; totals on the right */}
      <div className="grid gap-8 border-t p-6 sm:p-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5 text-sm">
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Amount in words</div>
            <div className="font-medium">{amountInWords(inv.grandTotal, cur)}</div>
          </div>
          {(co.bankName || co.bankAccountNo) && (
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Bank details</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-muted-foreground">
                {co.bankName && (
                  <>
                    <span>Bank</span>
                    <span className="text-foreground">
                      {co.bankName}
                      {co.bankBranch ? `, ${co.bankBranch}` : ''}
                    </span>
                  </>
                )}
                {co.bankAccountNo && (
                  <>
                    <span>A/c no.</span>
                    <span className="font-mono text-foreground">{co.bankAccountNo}</span>
                  </>
                )}
                {co.bankIfsc && (
                  <>
                    <span>IFSC</span>
                    <span className="font-mono text-foreground">{co.bankIfsc}</span>
                  </>
                )}
                {cur !== 'INR' && co.swiftCode && (
                  <>
                    <span>SWIFT</span>
                    <span className="font-mono text-foreground">{co.swiftCode}</span>
                  </>
                )}
              </div>
            </div>
          )}
          {inv.notes && (
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Note</div>
              <p className="whitespace-pre-line text-muted-foreground">{inv.notes}</p>
            </div>
          )}
          {inv.terms && (
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Terms & conditions</div>
              <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">{inv.terms}</p>
            </div>
          )}
        </div>

        <div>
          <dl className="space-y-2 text-sm tabular-nums">
            <Row label={`Sub total · ${inv.lines.length} item${inv.lines.length === 1 ? '' : 's'}, qty ${fmtQty(totalQty)}`} value={fmtMoney(inv.subTotal, cur)} />
            {inv.discountAmount > 0 && <Row label={`Discount ${inv.discountPercent}%`} value={`− ${fmtMoney(inv.discountAmount, cur)}`} />}
            {inv.freight > 0 && <Row label="Freight / packing" value={fmtMoney(inv.freight, cur)} />}
            <Row label="Taxable value" value={fmtMoney(inv.taxableAmount, cur)} strong />
            {inv.gstType === 'INTRA_STATE' && (
              <>
                <Row label={`CGST ${half}%`} value={fmtMoney(inv.cgstAmount, cur)} />
                <Row label={`SGST ${half}%`} value={fmtMoney(inv.sgstAmount, cur)} />
              </>
            )}
            {inv.gstType === 'INTER_STATE' && <Row label={`IGST ${inv.taxRate}%`} value={fmtMoney(inv.igstAmount, cur)} />}
            {inv.roundOff !== 0 && <Row label="Round off" value={fmtMoney(inv.roundOff, cur)} />}
          </dl>
          <div className="mt-3 flex items-baseline justify-between rounded-lg bg-primary px-4 py-3 text-primary-foreground">
            <span className="text-sm font-medium opacity-90">Total ({cur})</span>
            <span className="text-xl font-semibold tracking-[-0.02em] tabular-nums">{fmtMoney(inv.grandTotal, cur)}</span>
          </div>
          {inv.status === 'ISSUED' && (
            <dl className="mt-3 space-y-1.5 text-sm tabular-nums">
              <Row label="Received" value={fmtMoney(inv.amountPaid, cur)} />
              <div className={cn('flex justify-between gap-4 rounded-lg px-3 py-2 font-semibold', balance > 0 ? 'bg-warning/12' : 'bg-success/10 text-success')}>
                <dt>{balance > 0 ? 'Balance due' : 'Fully paid'}</dt>
                <dd>{fmtMoney(balance, cur)}</dd>
              </div>
            </dl>
          )}
          <div className="mt-10 text-right text-sm">
            <div className="font-medium">For {co.legalName || co.name}</div>
            <div className="mt-8 inline-block border-t px-6 pt-1 text-xs text-muted-foreground">Authorised signatory</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-6 py-3 sm:px-8">
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Party({ title, name, address, gstin }: { title: string; name: string; address: string | null; gstin: string | null }) {
  return (
    <div className="text-sm">
      <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</div>
      <div className="font-semibold">{name}</div>
      {address && <div className="mt-0.5 whitespace-pre-line text-muted-foreground">{address}</div>}
      {gstin && <div className="mt-1.5 font-mono text-xs">GSTIN {gstin}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ side panels

function PaymentPanel({ inv, balance, onPay, onCancelPayment }: { inv: Invoice; balance: number; onPay?: () => void; onCancelPayment?: (id: number) => void }) {
  const cur = inv.currency;
  const paidShare = inv.grandTotal > 0 ? Math.min(1, inv.amountPaid / inv.grandTotal) : 0;
  const days = inv.dueDate ? differenceInCalendarDays(parseISO(inv.dueDate), new Date()) : null;
  const issued = inv.status === 'ISSUED';
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <Banknote className="size-4 text-primary" aria-hidden /> Payment
      </div>
      {issued ? (
        <>
          <div className="mt-3 text-xs text-muted-foreground">{balance > 0 ? 'Balance due' : 'Fully paid'}</div>
          <div className={cn('text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums', balance <= 0 && 'text-success')}>{fmtMoney(Math.max(0, balance), cur)}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-success" style={{ width: `${paidShare * 100}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>Received {fmtMoney(inv.amountPaid, cur)}</span>
            <span>of {fmtMoney(inv.grandTotal, cur)}</span>
          </div>
          {balance > 0 && days !== null && (
            <div
              className={cn(
                'mt-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
                days < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
              )}
            >
              <Clock className="size-3.5" aria-hidden />
              {days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'} (${fmtDate(inv.dueDate)})`}
            </div>
          )}
          {onPay && (
            <Button className="mt-4 w-full" onClick={onPay}>
              <Banknote /> Record payment
            </Button>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{inv.status === 'CANCELLED' ? 'Cancelled invoices take no payments.' : 'Issue the invoice first.'}</p>
      )}
      {inv.payments.length > 0 && (
        <ul className="mt-4 divide-y border-t">
          {inv.payments.map((p) => (
            <li key={p.id} className={cn('py-2.5 text-sm', p.cancelledAt && 'text-muted-foreground line-through')}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium tabular-nums">{fmtMoney(p.amount, cur)}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(p.paymentDate)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{[p.paymentNo, PAYMENT_MODE_LABELS[p.mode], p.reference].filter(Boolean).join(' · ')}</span>
                {!p.cancelledAt && onCancelPayment && (
                  <button type="button" className="shrink-0 text-destructive hover:underline" onClick={() => onCancelPayment(p.id)}>
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DispatchPanel({ inv }: { inv: Invoice }) {
  const activeDispatch = inv.dispatches.find((d) => !d.cancelledAt);
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <Truck className="size-4 text-primary" aria-hidden /> Dispatch
      </div>
      <div className="mt-3 space-y-3 text-sm">
        {inv.dispatches.length === 0 && (
          <p className="text-muted-foreground">
            {inv.salesOrder ? (inv.status === 'ISSUED' ? 'Not dispatched yet. Dispatch from the top once the truck is loaded.' : 'Not dispatched.') : 'Direct invoice: no dispatch entry needed.'}
          </p>
        )}
        {inv.dispatches.map((d) => (
          <div key={d.id} className={cn(d.cancelledAt && 'text-muted-foreground line-through')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono font-medium">{d.dispatchNo}</span>
              <span className="text-xs text-muted-foreground">{fmtDate(d.dispatchDate)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{[d.transporter, d.lrNo && `LR ${d.lrNo}`, d.vehicleNo].filter(Boolean).join(' · ') || '—'}</div>
            {!d.cancelledAt && (
              <a href={`/api/dispatches/${d.id}/pdf`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <FileText className="size-3.5" /> Packing list
              </a>
            )}
          </div>
        ))}
        {inv.assembly && (
          <Link href={`/dispatch/packing/${inv.assembly.id}`} className="block text-xs font-medium text-primary hover:underline">
            Packing {inv.assembly.assemblyNo}
          </Link>
        )}
        {activeDispatch && inv.status === 'ISSUED' && <p className="text-xs text-success">Goods on the way to the customer.</p>}
      </div>
    </Card>
  );
}

function ActivityPanel({ inv }: { inv: Invoice }) {
  const rows = [
    inv.createdBy && { label: 'Made by', value: inv.createdBy.name },
    inv.issuedAt && { label: 'Issued', value: fmtDateTime(inv.issuedAt) },
    inv.emailedAt && { label: 'E-mailed', value: fmtDateTime(inv.emailedAt) },
    (inv.customer.contactPerson || inv.customer.phone || inv.customer.email) && {
      label: 'Customer contact',
      value: [inv.customer.contactPerson, inv.customer.phone, inv.customer.email].filter(Boolean).join(' · '),
    },
  ].filter(Boolean) as { label: string; value: string }[];
  if (!rows.length) return null;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <UserRound className="size-4 text-primary" aria-hidden /> Details
      </div>
      <dl className="mt-3 space-y-2.5 text-sm">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={cn(strong ? 'font-medium' : 'text-muted-foreground')}>{label}</dt>
      <dd className={cn(strong && 'font-semibold')}>{value}</dd>
    </div>
  );
}

/**
 * WhatsApp message with the invoice details (opens WhatsApp Web / the app). With the customer's phone saved
 * it opens that chat; otherwise WhatsApp asks whom to send it to. Indian 10-digit numbers get the 91 prefix.
 */
function whatsAppLink(inv: Invoice, balance: number) {
  const cur = inv.currency;
  const lines = [
    `Dear ${inv.customer.contactPerson || inv.billingName},`,
    '',
    `Our invoice ${inv.invoiceNo} dated ${fmtDate(inv.invoiceDate)} for ${fmtMoney(inv.grandTotal, cur)} is ready.`,
    inv.dueDate ? `Due date: ${fmtDate(inv.dueDate)}.` : '',
    balance > 0 && balance < inv.grandTotal ? `Balance to pay: ${fmtMoney(balance, cur)}.` : '',
    '',
    'Thank you.',
    inv.company.name,
  ].filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '');
  let phone = (inv.customer.phone ?? '').split(/[/,]/)[0].replace(/\D/g, '');
  if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
  if (phone.length === 10) phone = `91${phone}`;
  const text = encodeURIComponent(lines.join('\n'));
  return phone.length >= 11 ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
}
