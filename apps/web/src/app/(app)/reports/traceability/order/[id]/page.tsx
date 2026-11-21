'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, CircleDashed, FileDown, XCircle } from 'lucide-react';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { useApiQuery } from '@/hooks/use-api';
import type { OrderTrace } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import {
  AssemblyStatusBadge,
  InvoiceStatusBadge,
  JwoStatusBadge,
  QcStatusBadge,
  RcStatusBadge,
  SoStatusBadge,
} from '@/components/app/status';
import {
  PrintButton,
  PrintHeader,
  td,
  tdNum,
  th,
  theadClass,
  thNum,
} from '@/components/reports/report-kit';
import { DocLink, FileLink, FlushTable, Section } from '@/components/reports/trace-bits';

export default function OrderTracePage() {
  return (
    <RequirePermission permission="traceability.view">
      <OrderTraceView />
    </RequirePermission>
  );
}

function OrderTraceView() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: t, isError } = useApiQuery<OrderTrace>(`/traceability/orders/${id}`);
  if (isError)
    return <p className="py-20 text-center text-sm text-muted-foreground">Order not found.</p>;
  if (!t) return <Skeleton className="h-96" />;
  const o = t.order;

  return (
    <>
      <PrintHeader
        title={`Order traceability · ${o.soNo}`}
        lines={[
          o.customer.name,
          o.customerPoNo && `Customer PO ${o.customerPoNo}`,
          `Order date ${fmtDate(o.soDate)}`,
        ]}
      />
      <PageHeader
        className="print:hidden"
        title={`Traceability ${o.soNo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SoStatusBadge status={o.status} />
            <span>
              {o.customer.name}
              {o.customerPoNo && ` · PO ${o.customerPoNo}`} · {fmtDate(o.soDate)}
            </span>
          </span>
        }
        actions={
          <>
            <PrintButton />
            {can('traceability.export') && (
              <Button asChild>
                <a href={`/api/traceability/orders/${o.id}/pdf`} target="_blank" rel="noreferrer">
                  <FileDown /> Traceability PDF
                </a>
              </Button>
            )}
            {can('sales_orders.view') && (
              <Button variant="ghost" asChild>
                <Link href={`/sales/orders/${o.id}`}>
                  <ArrowLeft /> {o.soNo}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        <Section title="Products" flush>
          <FlushTable>
            <thead className={theadClass}>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Specification</th>
                <th className={thNum}>Ordered</th>
                <th className={thNum}>Packed</th>
                <th className={thNum}>Dispatched</th>
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className={`${td} font-medium`}>{l.product}</td>
                  <td className={`${td} text-[13px]`}>{l.spec || '—'}</td>
                  <td className={tdNum}>{fmtQty(l.quantity)}</td>
                  <td className={tdNum}>{fmtQty(l.packed)}</td>
                  <td
                    className={cn(
                      tdNum,
                      l.dispatched >= l.quantity && 'font-semibold text-success',
                    )}
                  >
                    {fmtQty(l.dispatched)}
                  </td>
                </tr>
              ))}
            </tbody>
          </FlushTable>
        </Section>

        <Section
          title="Heats in this supply"
          description="Every heat whose parts went into the packed sets, with its mill heat, gate entry, incoming QC and MTC."
          flush
        >
          {t.heats.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing packed yet.</p>
          ) : (
            <FlushTable minWidth={820}>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Heat</th>
                  <th className={th}>Material</th>
                  <th className={th}>Supplier · gate entry</th>
                  <th className={th}>QC</th>
                  <th className={th}>Parts supplied</th>
                  <th className={th}>MTC / documents</th>
                </tr>
              </thead>
              <tbody>
                {t.heats.map((h) => (
                  <tr key={h.id} className="border-b align-top last:border-0">
                    <td className={td}>
                      <DocLink
                        href={`/reports/traceability/heat/${h.id}`}
                        permission="traceability.view"
                      >
                        {h.heatNo}
                      </DocLink>
                      {h.millHeatNo && (
                        <div className="text-xs text-muted-foreground">mill {h.millHeatNo}</div>
                      )}
                    </td>
                    <td className={td}>
                      {h.grade} {h.size}
                    </td>
                    <td className={td}>
                      <div className="text-[13px]">{h.supplier ?? '—'}</div>
                      {h.grn ? (
                        <div className="text-xs">
                          <DocLink
                            href={`/store/gate-entry/${h.grn.id}`}
                            permission="goods_receipts.view"
                            className="text-xs"
                          >
                            {h.grn.grnNo}
                          </DocLink>{' '}
                          <span className="text-muted-foreground">{fmtDate(h.grn.grnDate)}</span>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Opening stock</div>
                      )}
                    </td>
                    <td className={td}>
                      {h.qcStatus ? <QcStatusBadge status={h.qcStatus} /> : '—'}
                    </td>
                    <td className={`${td} text-[13px]`}>
                      {h.parts.map((p) => (
                        <div key={p.item.id}>
                          {fmtQty(p.quantity)} × {p.item.name}
                        </div>
                      ))}
                    </td>
                    <td className={td}>
                      {h.documents.length === 0 ? (
                        <span className="text-xs text-muted-foreground">None uploaded</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {h.documents.map((d) => (
                            <FileLink key={d.id} id={d.id} name={d.name} />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          )}
        </Section>

        {t.packing.map((p) => (
          <Section
            key={p.id}
            title={`Packing ${p.assemblyNo}`}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <AssemblyStatusBadge status={p.status} /> {fmtDate(p.assemblyDate)} ·{' '}
                {p.sets.map((s) => `${fmtQty(s.quantity)} × ${s.product}`).join(', ')}
                {p.invoices.length > 0 &&
                  ` · invoice ${p.invoices.map((i) => i.invoiceNo).join(', ')}`}
              </span>
            }
            className={cn(p.status === 'CANCELLED' && 'opacity-60')}
            flush
          >
            <FlushTable>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Part</th>
                  <th className={thNum}>Qty</th>
                  <th className={th}>Heat no.</th>
                  <th className={th}>Mill heat</th>
                  <th className={th}>Made on</th>
                </tr>
              </thead>
              <tbody>
                {p.parts.map((part, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className={td}>
                      <div className="font-medium">{part.item.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {part.item.code}
                      </div>
                    </td>
                    <td className={tdNum}>{fmtQty(part.quantity)}</td>
                    <td className={`${td} font-mono text-[13px] font-semibold`}>
                      {part.heatNo ?? '—'}
                    </td>
                    <td className={`${td} text-[13px]`}>{part.millHeatNo ?? '—'}</td>
                    <td className={`${td} text-[13px]`}>{part.madeOn.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          </Section>
        ))}
        {t.packing.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No sets packed for this order yet.
          </p>
        )}

        {t.routeCards.map((rc) => (
          <Section
            key={rc.id}
            title={`Route card ${rc.rcNo}`}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <RcStatusBadge status={rc.status} />
                {rc.item.name} · {fmtQty(rc.plannedQty)}
                {rc.extraQty > 0 && ` + ${fmtQty(rc.extraQty)}`} planned · {fmtQty(rc.completedQty)}{' '}
                OK
                {rc.rejectedQty > 0 && ` · ${fmtQty(rc.rejectedQty)} rejected`}
                {rc.heats.length > 0 &&
                  ` · heat ${rc.heats.map((h) => `${h.heatNo} (${fmtQty(h.kg)} kg)`).join(', ')}`}
              </span>
            }
          >
            <ol className="space-y-1.5">
              {rc.stages.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  {s.status === 'DONE' ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : s.status === 'SKIPPED' ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span
                      className={cn('font-medium', s.status !== 'DONE' && 'text-muted-foreground')}
                    >
                      {s.name}
                    </span>
                    {s.okQty != null && s.status === 'DONE' && (
                      <span className="text-muted-foreground"> · {fmtQty(s.okQty)} OK</span>
                    )}
                    {!!s.rejectedQty && (
                      <span className="text-destructive">
                        {' '}
                        · {fmtQty(s.rejectedQty)} rejected{s.reason && ` (${s.reason})`}
                      </span>
                    )}
                    {s.remarks && <span className="text-muted-foreground"> · {s.remarks}</span>}
                    {s.completedAt && (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        — {s.by} {fmtDate(s.completedAt)}
                      </span>
                    )}
                    {s.reports.length > 0 && (
                      <div className="flex flex-wrap gap-x-3">
                        {s.reports.map((f) => (
                          <FileLink key={f.id} id={f.id} name={f.name} />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        ))}

        {t.jobWork.map((j) => (
          <Section
            key={j.id}
            title={`Job work ${j.jwoNo}`}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <JwoStatusBadge status={j.status} /> {j.supplier} · {fmtDate(j.jwoDate)}
                {j.materials.length > 0 &&
                  ` · bar sent: ${j.materials.map((m) => `${m.heatNo} (${fmtQty(m.kg)} kg)`).join(', ')}`}
              </span>
            }
            flush
          >
            {j.received.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing received back yet.</p>
            ) : (
              <FlushTable>
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Receipt</th>
                    <th className={th}>Part</th>
                    <th className={th}>Heat</th>
                    <th className={thNum}>Received</th>
                    <th className={thNum}>Accepted</th>
                    <th className={thNum}>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {j.received.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className={td}>
                        <span className="font-mono text-[13px] font-semibold">{r.receiptNo}</span>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(r.receiptDate)}
                        </div>
                      </td>
                      <td className={td}>{r.item.name}</td>
                      <td className={`${td} font-mono text-[13px]`}>{r.heatNo ?? '—'}</td>
                      <td className={tdNum}>{fmtQty(r.receivedQty)}</td>
                      <td className={tdNum}>{fmtQty(r.acceptedQty)}</td>
                      <td className={tdNum}>
                        {r.rejectedQty ? (
                          <span className="text-destructive">{fmtQty(r.rejectedQty)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </FlushTable>
            )}
            {j.reports.length > 0 && (
              <div className="flex flex-wrap gap-x-4 border-t px-5 py-3">
                {j.reports.map((f) => (
                  <FileLink key={f.id} id={f.id} name={f.name} note="QC report" />
                ))}
              </div>
            )}
          </Section>
        ))}

        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Invoices">
            {t.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoice yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {t.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <DocLink href={`/billing/invoices/${i.id}`} permission="invoices.view">
                      {i.invoiceNo}
                    </DocLink>
                    <InvoiceStatusBadge status={i.status} />
                    <span className="text-muted-foreground">{fmtDate(i.invoiceDate)}</span>
                    {can('invoices.view') && (
                      <span className="tabular ml-auto font-medium">
                        {fmtMoney(i.grandTotal, i.currency)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Dispatches">
            {t.dispatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not dispatched yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {t.dispatches.map((d) => (
                  <li
                    key={d.id}
                    className={cn(d.cancelled && 'text-muted-foreground line-through')}
                  >
                    <span className="font-mono text-[13px] font-semibold">{d.dispatchNo}</span> ·{' '}
                    {fmtDate(d.dispatchDate)}
                    {d.invoiceNo && ` · ${d.invoiceNo}`}
                    <div className="text-xs text-muted-foreground">
                      {[d.transporter, d.lrNo && `LR ${d.lrNo}`, d.vehicleNo]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                    {d.cancelled && <Badge variant="destructive">Cancelled</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
