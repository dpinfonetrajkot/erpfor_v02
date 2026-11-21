'use client';

import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from '@/lib/format';
import type { SalesOrder } from '@/lib/types';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Attachments } from '@/components/app/attachments';
import { useSession } from '@/components/app/session';
import { ApprovalPanel } from './approval-panel';
import { StockCheckPanel } from './stock-check-panel';
import { SoDispatchPanel } from '@/components/billing/so-dispatch-panel';

const DECISION = {
  PENDING: { label: 'Not decided', variant: 'muted' },
  INHOUSE: { label: 'In-house', variant: 'info' },
  OUTSOURCE: { label: 'Outsource', variant: 'secondary' },
  FROM_STOCK: { label: 'From stock', variant: 'success' },
} as const;

/** Read-only sales order with its approvals, stock check and drawings. */
export function SoView({ so }: { so: SalesOrder }) {
  const { can } = useSession();
  const cur = so.currency;
  const planning = ['APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'].includes(so.status);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-medium">{so.customer.name}</div>
            <div className="text-muted-foreground">
              {so.customerPoNo ? `PO ${so.customerPoNo}` : 'No PO no.'}
              {so.customerPoDate && ` · ${fmtDate(so.customerPoDate)}`}
            </div>
            {(so.customer.contactPerson || so.customer.phone || so.customer.email) && (
              <div className="text-muted-foreground">{[so.customer.contactPerson, so.customer.phone, so.customer.email].filter(Boolean).join(' · ')}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              Due <span className="font-medium">{fmtDate(so.expectedDelivery)}</span>
            </div>
            <div className="text-muted-foreground">Sales person: {so.salesPerson?.name ?? '—'}</div>
            <div className="text-muted-foreground">
              Value {fmtMoney(so.totalAmount, cur)}
              {cur !== 'INR' && ` (1 ${cur} = ₹${so.exchangeRate})`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>Created {fmtDateTime(so.createdAt)}</div>
            <div>Sent for approval {so.submittedAt ? fmtDateTime(so.submittedAt) : '—'}</div>
            <div>Approved {so.approvedAt ? fmtDateTime(so.approvedAt) : '—'}</div>
          </CardContent>
        </Card>
      </div>

      {(so.additionalRequirement || so.notes) && (
        <div className="grid gap-4 md:grid-cols-2">
          {so.additionalRequirement && (
            <Card>
              <CardHeader>
                <CardTitle>Customer requirements</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-line">{so.additionalRequirement}</CardContent>
            </Card>
          )}
          {so.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-line">{so.notes}</CardContent>
            </Card>
          )}
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Products</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">Specification</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Made</th>
                </tr>
              </thead>
              <tbody>
                {so.lines.map((l) => (
                  <tr key={l.id} className="border-b align-top last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{l.product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.product.components.map((c) => c.partType.name).join(' + ')}
                        {l.remarks && ` · ${l.remarks}`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[13px]">
                      {[l.endConnection !== 'NONE' && l.endConnection, l.service === 'SOUR' ? 'SOUR (NACE)' : 'STD', l.schedule && `Sch. ${l.schedule}`, l.materialGrade?.name]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtQty(l.quantity)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtMoney(l.rate, cur)}</td>
                    <td className="tabular px-3 py-2.5 text-right font-medium">{fmtMoney(l.amount, cur)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={DECISION[l.decision].variant}>{DECISION[l.decision].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tabular flex justify-end border-t px-5 py-3 text-sm font-semibold">Order value {fmtMoney(so.totalAmount, cur)}</div>
        </CardContent>
      </Card>

      {so.status !== 'CANCELLED' && (
        <section aria-label="Approvals" className="space-y-2">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">Approvals</h2>
          <ApprovalPanel so={so} />
        </section>
      )}

      {planning && (can('stock_check.view') || can('sales_orders.view')) && <StockCheckPanel so={so} />}

      {(planning || so.status === 'DISPATCHED') && ['assemblies.view', 'invoices.view', 'dispatches.view'].some(can) && <SoDispatchPanel so={so} />}

      <Card>
        <CardContent className="pt-5">
          <Attachments entity="sales_order" entityId={so.id} canEdit={can('sales_orders.update')} title="Drawings & customer PO copy" />
        </CardContent>
      </Card>
    </div>
  );
}
