'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Banknote } from 'lucide-react';
import { PAYMENT_MODE_LABELS } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { showApiError, useApiQuery, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { OutstandingRow, PaymentRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { PaymentDialog } from '@/components/billing/dialogs';

const TABS = [
  { key: 'owed', label: 'Customers owe us' },
  { key: 'owe', label: 'We owe suppliers' },
  { key: 'in', label: 'Money received' },
  { key: 'out', label: 'Money paid' },
] as const;

export default function PaymentsPage() {
  return (
    <RequirePermission permission="payments.view">
      <Payments />
    </RequirePermission>
  );
}

function Payments() {
  const params = useListParams({ filters: { tab: 'owed' } });
  const tab = params.filters.tab as (typeof TABS)[number]['key'];
  return (
    <>
      <PageHeader title="Payments" description="Money received from customers against invoices and paid to suppliers against purchase orders." />
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1" role="tablist" aria-label="Payments">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => params.set({ tab: t.key, page: undefined, search: undefined })}
            className={cn('h-8 rounded-full px-4 text-[13px] font-semibold text-muted-foreground transition-colors', tab === t.key ? 'bg-ink text-ink-foreground' : 'hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'owed' || tab === 'owe' ? <Outstanding direction={tab === 'owed' ? 'RECEIPT' : 'PAYMENT'} /> : <History direction={tab === 'in' ? 'RECEIPT' : 'PAYMENT'} />}
    </>
  );
}

function Outstanding({ direction }: { direction: 'RECEIPT' | 'PAYMENT' }) {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<OutstandingRow[]>('/payments/outstanding', { direction });
  const [paying, setPaying] = useState<OutstandingRow | null>(null);
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const inr = data.filter((r) => r.currency === 'INR');
  const total = inr.reduce((s, r) => s + r.balance, 0);
  const overdue = inr.filter((r) => r.overdueDays > 0).reduce((s, r) => s + r.balance, 0);
  const receipt = direction === 'RECEIPT';
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-[13px] text-muted-foreground">{receipt ? 'To receive (INR)' : 'To pay (INR)'}</div>
          <div className="mt-1 text-2xl font-semibold">{fmtMoney(total)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[13px] text-muted-foreground">Overdue (INR)</div>
          <div className={cn('mt-1 text-2xl font-semibold', overdue > 0 && 'text-destructive')}>{fmtMoney(overdue)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[13px] text-muted-foreground">{receipt ? 'Open invoices' : 'Open purchase orders'}</div>
          <div className="mt-1 text-2xl font-semibold">{data.length}</div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        {data.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{receipt ? 'Every issued invoice is paid.' : 'Every purchase order is paid.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">{receipt ? 'Invoice' : 'Purchase order'}</th>
                  <th className="px-3 py-2 text-left">{receipt ? 'Customer' : 'Supplier'}</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={r.kind === 'invoice' ? `/billing/invoices/${r.id}` : `/purchase/orders/${r.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">
                        {r.number}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(r.date)}
                        {r.type === 'JOB_WORK' && ' · job work'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{r.party.name}</td>
                    <td className={cn('px-3 py-2.5 whitespace-nowrap', r.overdueDays > 0 && 'font-medium text-destructive')}>
                      {fmtDate(r.dueDate)}
                      {r.overdueDays > 0 && ` · ${r.overdueDays} days late`}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtMoney(r.total, r.currency)}</td>
                    <td className="tabular px-3 py-2.5 text-right text-muted-foreground">{fmtMoney(r.paid, r.currency)}</td>
                    <td className="tabular px-3 py-2.5 text-right font-semibold">{fmtMoney(r.balance, r.currency)}</td>
                    <td className="px-4 py-1.5 text-right">
                      {can('payments.create') && (
                        <Button size="sm" variant="outline" onClick={() => setPaying(r)}>
                          <Banknote /> {receipt ? 'Received' : 'Paid'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {paying && (
        <PaymentDialog
          target={{ direction, id: paying.id, number: paying.number, party: paying.party.name, balance: paying.balance, currency: paying.currency }}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}

function History({ direction }: { direction: 'RECEIPT' | 'PAYMENT' }) {
  const { can } = useSession();
  const params = useListParams({ filters: { tab: direction === 'RECEIPT' ? 'in' : 'out' } });
  const { data, isFetching } = usePaged<PaymentRow>('/payments', { ...params.query, tab: undefined, direction });
  const [cancelling, setCancelling] = useState<PaymentRow | null>(null);
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api(`/payments/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Payment cancelled');
      setCancelling(null);
    },
    onError: (err) => showApiError(err),
  });
  const columns = useMemo<ColumnDef<PaymentRow>[]>(
    () => [
      {
        header: 'Payment',
        accessorKey: 'paymentNo',
        meta: { sortKey: 'paymentNo' },
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-[13px] font-semibold whitespace-nowrap">{row.original.paymentNo}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(row.original.paymentDate)}</div>
          </div>
        ),
      },
      { header: direction === 'RECEIPT' ? 'Customer' : 'Supplier', id: 'party', cell: ({ row }) => <span className="font-medium">{row.original.customer?.name ?? row.original.supplier?.name}</span> },
      {
        header: 'Against',
        id: 'doc',
        cell: ({ row }) =>
          row.original.invoice ? (
            <Link href={`/billing/invoices/${row.original.invoice.id}`} className="font-mono text-[13px] text-primary hover:underline">
              {row.original.invoice.invoiceNo}
            </Link>
          ) : row.original.purchaseOrder ? (
            <Link href={`/purchase/orders/${row.original.purchaseOrder.id}`} className="font-mono text-[13px] text-primary hover:underline">
              {row.original.purchaseOrder.poNo}
            </Link>
          ) : (
            '—'
          ),
      },
      {
        header: 'Amount',
        accessorKey: 'amount',
        meta: { sortKey: 'amount', align: 'right' },
        cell: ({ row }) => (
          <span className={cn('font-semibold whitespace-nowrap', row.original.cancelledAt && 'text-muted-foreground line-through')}>
            {fmtMoney(row.original.amount, row.original.invoice?.currency ?? row.original.purchaseOrder?.currency ?? 'INR')}
          </span>
        ),
      },
      {
        header: 'Mode',
        id: 'mode',
        cell: ({ row }) => (
          <div className="text-[13px]">
            {PAYMENT_MODE_LABELS[row.original.mode]}
            {row.original.reference && <div className="text-xs text-muted-foreground">{row.original.reference}</div>}
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.cancelledAt ? (
            <Badge variant="destructive" title={row.original.cancelReason ?? undefined}>
              Cancelled
            </Badge>
          ) : can('payments.update') ? (
            <Button variant="ghost" size="icon-sm" title="Cancel (wrong entry)" aria-label={`Cancel ${row.original.paymentNo}`} onClick={() => setCancelling(row.original)}>
              <Ban />
            </Button>
          ) : null,
      },
    ],
    [can, direction],
  );
  return (
    <>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search payment, party, invoice / PO, reference…"
        empty={{ title: 'No payments yet', description: direction === 'RECEIPT' ? 'Record money received from the Customers owe us tab or an invoice.' : 'Record money paid from the We owe suppliers tab.' }}
      />
      {cancelling && (
        <ReasonDialog
          title={`Cancel ${cancelling.paymentNo}?`}
          description="For a wrong entry. It stays on record as cancelled and the balance opens again."
          confirmLabel="Cancel payment"
          saving={cancel.isPending}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}
