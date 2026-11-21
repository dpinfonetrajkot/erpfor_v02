'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileDown } from 'lucide-react';
import { STOCK_LOCATION_LABELS, STOCK_REF_TYPE_LABELS } from '@bht/shared';
import { fmtDate, fmtQty } from '@/lib/format';
import { useApiQuery } from '@/hooks/use-api';
import type { HeatTrace } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import {
  AssemblyStatusBadge,
  JwoStatusBadge,
  QcStatusBadge,
  RcStatusBadge,
} from '@/components/app/status';
import {
  PrintButton,
  PrintHeader,
  StatTile,
  td,
  tdNum,
  th,
  theadClass,
  thNum,
} from '@/components/reports/report-kit';
import { DocLink, FileLink, FlushTable, Section } from '@/components/reports/trace-bits';

export default function HeatTracePage() {
  return (
    <RequirePermission permission="traceability.view">
      <HeatTraceView />
    </RequirePermission>
  );
}

function HeatTraceView() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: t, isError } = useApiQuery<HeatTrace>(`/traceability/heats/${id}`);
  if (isError)
    return <p className="py-20 text-center text-sm text-muted-foreground">Heat not found.</p>;
  if (!t) return <Skeleton className="h-96" />;
  const { heat: h, summary: s } = t;

  return (
    <>
      <PrintHeader
        title={`Heat traceability · ${h.heatNo}`}
        lines={[
          `${h.material.grade} ${h.material.size}`,
          h.millHeatNo && `Mill heat ${h.millHeatNo}`,
          h.supplier && `Supplier ${h.supplier}`,
          h.receivedDate && `Received ${fmtDate(h.receivedDate)}`,
        ]}
      />
      <PageHeader
        className="print:hidden"
        title={`Heat ${h.heatNo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {h.status !== 'ACTIVE' && (
              <Badge variant="muted">{h.status === 'CONSUMED' ? 'Used up' : 'Blocked'}</Badge>
            )}
            <span>
              {h.material.grade} {h.material.size}
              {h.millHeatNo && ` · mill heat ${h.millHeatNo}`}
              {h.supplier && ` · ${h.supplier}`}
              {h.receivedDate && ` · received ${fmtDate(h.receivedDate)}`}
            </span>
          </span>
        }
        actions={
          <>
            <PrintButton />
            {can('traceability.export') && (
              <Button asChild>
                <a href={`/api/traceability/heats/${h.id}/pdf`} target="_blank" rel="noreferrer">
                  <FileDown /> PDF report
                </a>
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href={`/reports/traceability?search=${encodeURIComponent(h.heatNo)}`}>
                <ArrowLeft /> Search
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Bar received"
          value={`${fmtQty(s.receivedKg)} kg`}
          sub={`${fmtQty(s.inStoreKg)} kg still in the RM store`}
        />
        <StatTile
          label="Used"
          value={`${fmtQty(s.toProductionKg + s.toJobWorkKg)} kg`}
          sub={`route cards ${fmtQty(s.toProductionKg)} · job work ${fmtQty(s.toJobWorkKg)}`}
        />
        <StatTile
          label="Finished parts"
          value={fmtQty(s.partsMade)}
          sub={`${fmtQty(s.partsPacked)} packed · ${fmtQty(s.partsInStore)} in FG store`}
        />
        <StatTile
          label="Customers"
          value={s.customers.length}
          sub={s.customers.join(', ') || 'none yet'}
        />
      </div>

      <div className="space-y-4">
        <Section title="Received" description="Gate entry and incoming QC of this heat." flush>
          {t.receipts.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              No gate entry: this heat was entered as opening stock.
            </p>
          ) : (
            <FlushTable>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Gate entry</th>
                  <th className={th}>Purchase order</th>
                  <th className={th}>Supplier invoice</th>
                  <th className={thNum}>Received kg</th>
                  <th className={thNum}>Accepted</th>
                  <th className={thNum}>Rejected</th>
                  <th className={th}>QC</th>
                </tr>
              </thead>
              <tbody>
                {t.receipts.map((r) => (
                  <tr key={r.grnId} className="border-b last:border-0">
                    <td className={td}>
                      <DocLink
                        href={`/store/gate-entry/${r.grnId}`}
                        permission="goods_receipts.view"
                      >
                        {r.grnNo}
                      </DocLink>
                      <div className="text-xs text-muted-foreground">{fmtDate(r.grnDate)}</div>
                    </td>
                    <td className={td}>
                      {r.po ? (
                        <DocLink
                          href={`/purchase/orders/${r.po.id}`}
                          permission="purchase_orders.view"
                        >
                          {r.po.poNo}
                        </DocLink>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={td}>{r.supplierInvoice ?? '—'}</td>
                    <td className={tdNum}>{fmtQty(r.receivedQty)}</td>
                    <td className={tdNum}>{fmtQty(r.acceptedQty)}</td>
                    <td className={tdNum}>{r.rejectedQty ? fmtQty(r.rejectedQty) : '—'}</td>
                    <td className={td}>
                      <QcStatusBadge status={r.qcStatus} />
                      {r.qcRemarks && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{r.qcRemarks}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          )}
          {t.documents.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-5 py-3">
              {t.documents.map((d) => (
                <FileLink key={d.id} id={d.id} name={d.name} note={d.on} />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Route cards"
          description="Bar of this heat issued to production (net of returns)."
          flush
        >
          {t.routeCards.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              No bar of this heat has gone to a route card.
            </p>
          ) : (
            <FlushTable minWidth={760}>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Route card</th>
                  <th className={th}>Part</th>
                  <th className={thNum}>Kg</th>
                  <th className={thNum}>Planned</th>
                  <th className={thNum}>OK</th>
                  <th className={thNum}>Rejected</th>
                  <th className={th}>For</th>
                </tr>
              </thead>
              <tbody>
                {t.routeCards.map((rc) => (
                  <tr key={rc.id} className="border-b align-top last:border-0">
                    <td className={td}>
                      <DocLink
                        href={`/production/route-cards/${rc.id}`}
                        permission="route_cards.view"
                      >
                        {rc.rcNo}
                      </DocLink>
                      <div className="mt-1">
                        <RcStatusBadge status={rc.status} />
                      </div>
                    </td>
                    <td className={td}>
                      <div className="font-medium">{rc.item.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{rc.item.code}</div>
                      {rc.reports.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {rc.reports.map((f) => (
                            <FileLink key={f.id} id={f.id} name={f.name} note={f.stage} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={tdNum}>{fmtQty(rc.kg)}</td>
                    <td className={tdNum}>
                      {fmtQty(rc.plannedQty)}
                      {rc.extraQty > 0 && (
                        <span className="text-muted-foreground"> +{fmtQty(rc.extraQty)}</span>
                      )}
                    </td>
                    <td className={tdNum}>{fmtQty(rc.completedQty)}</td>
                    <td className={tdNum}>
                      {rc.rejectedQty ? (
                        <span className="text-destructive">{fmtQty(rc.rejectedQty)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={td}>
                      {rc.order ? (
                        <>
                          <DocLink
                            href={`/reports/traceability/order/${rc.order.id}`}
                            permission="traceability.view"
                          >
                            {rc.order.soNo}
                          </DocLink>
                          <div className="text-xs text-muted-foreground">
                            {rc.order.customer.name}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Stock</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          )}
        </Section>

        {t.jobWork.length > 0 && (
          <Section
            title="Job work"
            description="Bar sent to vendors and the parts they returned under this heat."
            flush
          >
            <FlushTable>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Job work order</th>
                  <th className={th}>Vendor</th>
                  <th className={thNum}>Kg sent</th>
                  <th className={th}>Parts back</th>
                </tr>
              </thead>
              <tbody>
                {t.jobWork.map((j) => (
                  <tr key={j.id} className="border-b align-top last:border-0">
                    <td className={td}>
                      <DocLink href={`/job-work/orders/${j.id}`} permission="job_work_orders.view">
                        {j.jwoNo}
                      </DocLink>
                      <div className="mt-1">
                        <JwoStatusBadge status={j.status} />
                      </div>
                    </td>
                    <td className={td}>{j.supplier}</td>
                    <td className={tdNum}>{fmtQty(j.kg)}</td>
                    <td className={td}>
                      {j.received.length === 0
                        ? '—'
                        : j.received.map((r, i) => (
                            <div key={i} className="text-[13px]">
                              {r.item.name}:{' '}
                              <span className="font-medium">{fmtQty(r.acceptedQty)} accepted</span>
                              {r.rejectedQty > 0 && (
                                <span className="text-destructive">
                                  {' '}
                                  · {fmtQty(r.rejectedQty)} rejected
                                </span>
                              )}
                              <span className="text-muted-foreground"> · {r.receiptNo}</span>
                            </div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          </Section>
        )}

        <Section
          title="Finished parts of this heat"
          description="Made on route cards or by job work, then packed or still in the FG store."
          flush
        >
          {t.parts.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              No finished parts of this heat yet.
            </p>
          ) : (
            <FlushTable>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Part</th>
                  <th className={th}>Made on</th>
                  <th className={thNum}>Made</th>
                  <th className={thNum}>Packed</th>
                  <th className={thNum}>In FG store</th>
                </tr>
              </thead>
              <tbody>
                {t.parts.map((p) => (
                  <tr key={p.item.id} className="border-b last:border-0">
                    <td className={td}>
                      <div className="font-medium">{p.item.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.item.code}</div>
                    </td>
                    <td className={`${td} text-[13px]`}>{p.madeOn.join(', ') || '—'}</td>
                    <td className={tdNum}>{fmtQty(p.made)}</td>
                    <td className={tdNum}>{fmtQty(p.packed)}</td>
                    <td className={tdNum}>{fmtQty(p.inStore)}</td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          )}
        </Section>

        <Section
          title="Delivered to"
          description="Packings with parts of this heat, with their invoice and dispatch."
          flush
        >
          {t.deliveries.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              No parts of this heat have been packed yet.
            </p>
          ) : (
            <FlushTable minWidth={760}>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Order</th>
                  <th className={th}>Packing</th>
                  <th className={th}>Parts</th>
                  <th className={th}>Invoice · dispatch</th>
                </tr>
              </thead>
              <tbody>
                {t.deliveries.map((d) => (
                  <tr key={d.assembly.id} className="border-b align-top last:border-0">
                    <td className={`${td} font-medium`}>{d.customer.name}</td>
                    <td className={td}>
                      <DocLink
                        href={`/reports/traceability/order/${d.order.id}`}
                        permission="traceability.view"
                      >
                        {d.order.soNo}
                      </DocLink>
                      {d.order.customerPoNo && (
                        <div className="text-xs text-muted-foreground">
                          PO {d.order.customerPoNo}
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <DocLink
                        href={`/dispatch/packing/${d.assembly.id}`}
                        permission="assemblies.view"
                      >
                        {d.assembly.assemblyNo}
                      </DocLink>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {fmtDate(d.assembly.assemblyDate)}{' '}
                        <AssemblyStatusBadge status={d.assembly.status} />
                      </div>
                    </td>
                    <td className={`${td} text-[13px]`}>
                      {d.parts.map((p, i) => (
                        <div key={i}>
                          {fmtQty(p.quantity)} × {p.item.name}
                        </div>
                      ))}
                    </td>
                    <td className={td}>
                      {d.invoices.map((i) => (
                        <div key={i.id}>
                          <DocLink href={`/billing/invoices/${i.id}`} permission="invoices.view">
                            {i.invoiceNo}
                          </DocLink>
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            {fmtDate(i.invoiceDate)}
                          </span>
                        </div>
                      ))}
                      {d.dispatches.map((x) => (
                        <div key={x.id} className="text-[13px]">
                          <span className="font-mono font-semibold">{x.dispatchNo}</span>
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            {fmtDate(x.dispatchDate)}
                            {x.vehicleNo && ` · ${x.vehicleNo}`}
                          </span>
                        </div>
                      ))}
                      {d.invoices.length === 0 && (
                        <span className="text-muted-foreground">Not invoiced yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          )}
        </Section>

        {t.movements.length > 0 && (
          <Section
            title="Raw material movements"
            description="Every kg of this heat in and out, oldest first."
            flush
          >
            <FlushTable>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Movement</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Location</th>
                  <th className={thNum}>In kg</th>
                  <th className={thNum}>Out kg</th>
                </tr>
              </thead>
              <tbody>
                {t.movements.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className={`${td} whitespace-nowrap`}>{fmtDate(m.date)}</td>
                    <td className={td}>
                      {STOCK_REF_TYPE_LABELS[m.type as keyof typeof STOCK_REF_TYPE_LABELS] ??
                        m.type}
                      {m.remarks && (
                        <div className="text-xs text-muted-foreground">{m.remarks}</div>
                      )}
                    </td>
                    <td className={`${td} font-mono text-[13px]`}>{m.refNo ?? '—'}</td>
                    <td className={td}>{STOCK_LOCATION_LABELS[m.location]}</td>
                    <td className={`${tdNum} text-success`}>{m.in ? fmtQty(m.in) : ''}</td>
                    <td className={tdNum}>{m.out ? fmtQty(m.out) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          </Section>
        )}
      </div>
    </>
  );
}
