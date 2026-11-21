'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AGEING_BUCKETS } from '@bht/shared';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useApiQuery } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { AgeingReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import {
  ChartCard,
  EmptyRow,
  ExportButton,
  localToday,
  PrintButton,
  PrintHeader,
  ReportTable,
  ReportTabs,
  share,
  StatRow,
  StatTile,
  td,
  tdNum,
  th,
  theadClass,
  thNum,
  totalRow,
} from '@/components/reports/report-kit';
import { BarList, SegmentedBar } from '@/components/reports/mini-charts';
import { DocLink } from '@/components/reports/trace-bits';

const AGE_COLORS = ['var(--age-1)', 'var(--age-2)', 'var(--age-3)', 'var(--age-4)', 'var(--age-5)'];

const TABS = [
  { key: 'RECEIPT', label: 'Customers owe us' },
  { key: 'PAYMENT', label: 'We owe suppliers' },
] as const;

export default function AgeingPage() {
  return (
    <RequirePermission permission="business_reports.view">
      <Ageing />
    </RequirePermission>
  );
}

function Ageing() {
  const params = useListParams({ filters: { direction: 'RECEIPT' } });
  const direction = params.filters.direction as 'RECEIPT' | 'PAYMENT';
  const { data, isFetching } = useApiQuery<AgeingReport>('/reports/ageing', { direction });
  const [open, setOpen] = useState<number | null>(null);
  const r = data?.direction === direction ? data : undefined;
  const receipt = direction === 'RECEIPT';
  const overdue = r ? r.totals.total - r.totals.notDue : 0;

  return (
    <>
      <PrintHeader
        title={
          receipt ? 'Receivables ageing · customers owe us' : 'Payables ageing · we owe suppliers'
        }
        lines={[`As on ${fmtDate(localToday())}`, 'Days past the due date', 'Amounts in rupees']}
      />
      <PageHeader
        className="print:hidden"
        title="Receivables & payables ageing"
        description="Open balances by how many days they are past the due date. Rupees; USD invoices at their exchange rate."
        actions={
          <>
            <PrintButton />
            <ExportButton
              path="/reports/ageing/export"
              query={{ direction }}
              permission="business_reports.export"
            />
          </>
        }
      />
      <ReportTabs
        tabs={TABS}
        value={direction}
        onChange={(k) => params.set({ direction: k })}
        label="Ageing"
      />
      {!r ? (
        <Skeleton className="h-96" />
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70')}>
          <StatRow>
            <StatTile
              label={receipt ? 'To receive' : 'To pay'}
              value={fmtMoney(r.totals.total)}
              sub={`${r.totals.documents} open ${receipt ? 'invoice(s)' : 'purchase order(s)'}`}
            />
            <StatTile
              label="Overdue"
              value={fmtMoney(overdue)}
              tone={overdue > 0 ? 'bad' : undefined}
            />
            <StatTile
              label="Over 60 days late"
              value={fmtMoney(r.totals.d90 + r.totals.d90plus)}
              tone={r.totals.d90 + r.totals.d90plus > 0 ? 'bad' : undefined}
            />
            <StatTile
              label={receipt ? 'Customers' : 'Suppliers'}
              value={r.parties.length}
              sub={r.parties.filter((p) => p.maxOverdueDays > 0).length + ' with overdue amounts'}
            />
          </StatRow>

          <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
            <ChartCard
              title="Amount by age"
              description={`${fmtMoney(r.totals.total)} on ${r.totals.documents} open ${receipt ? 'invoice(s)' : 'purchase order(s)'}.`}
            >
              <SegmentedBar
                label="Amount by age"
                format={(v) => fmtMoney(v)}
                parts={AGEING_BUCKETS.map((b, i) => ({
                  key: b.key,
                  label: b.label,
                  value: r.totals[b.key],
                  color: AGE_COLORS[i],
                }))}
              />
              <div className="mt-4">
                <BarList
                  label="Amount by age"
                  format={(v) => fmtMoney(v)}
                  rows={AGEING_BUCKETS.map((b, i) => ({
                    key: b.key,
                    label: b.label,
                    value: r.totals[b.key],
                    color: AGE_COLORS[i],
                    hint: share(r.totals[b.key], r.totals.total),
                  }))}
                />
              </div>
            </ChartCard>
            <ChartCard
              title={receipt ? 'Biggest overdue customers' : 'Biggest overdue suppliers'}
              description="Amount past the due date, largest first."
            >
              {(() => {
                const late = r.parties
                  .map((p) => ({ p, overdue: p.total - p.buckets.notDue }))
                  .filter((x) => x.overdue > 0)
                  .sort((a, b) => b.overdue - a.overdue)
                  .slice(0, 7);
                return late.length ? (
                  <BarList
                    label="Overdue by party"
                    format={(v) => fmtMoney(v)}
                    color="var(--age-4)"
                    rows={late.map(({ p, overdue }) => ({
                      key: String(p.party.id),
                      label: p.party.name,
                      value: overdue,
                      hint: `oldest ${p.maxOverdueDays} days`,
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nothing is overdue. Every open {receipt ? 'invoice' : 'purchase order'} is
                    within its payment days.
                  </p>
                );
              })()}
            </ChartCard>
          </div>
          <ReportTable
            minWidth={900}
            title={receipt ? 'Open invoices by customer' : 'Open purchase orders by supplier'}
          >
            <thead className={theadClass}>
              <tr>
                <th className={th}>{receipt ? 'Customer' : 'Supplier'}</th>
                {AGEING_BUCKETS.map((b) => (
                  <th key={b.key} className={thNum}>
                    {b.label}
                  </th>
                ))}
                <th className={thNum}>Total</th>
              </tr>
            </thead>
            <tbody>
              {r.parties.length === 0 && (
                <EmptyRow cols={7}>
                  {receipt
                    ? 'Nothing to receive: every issued invoice is paid.'
                    : 'Nothing to pay: every purchase order is paid.'}
                </EmptyRow>
              )}
              {r.parties.map((p) => (
                <Fragment key={p.party.id}>
                  <tr
                    className="cursor-pointer border-b hover:bg-muted/30"
                    onClick={() => setOpen(open === p.party.id ? null : p.party.id)}
                  >
                    <td className={td}>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left font-medium"
                        aria-expanded={open === p.party.id}
                      >
                        {open === p.party.id ? (
                          <ChevronDown className="size-4 text-muted-foreground print:hidden" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground print:hidden" />
                        )}
                        {p.party.name}
                      </button>
                      <div className="pl-5.5 text-xs text-muted-foreground">
                        {p.documents.length} open
                        {p.maxOverdueDays > 0 && ` · oldest ${p.maxOverdueDays} days late`}
                      </div>
                    </td>
                    {AGEING_BUCKETS.map((b) => (
                      <td
                        key={b.key}
                        className={cn(
                          tdNum,
                          p.buckets[b.key] > 0 && b.key !== 'notDue' && 'text-destructive',
                          !p.buckets[b.key] && 'text-muted-foreground',
                        )}
                      >
                        {p.buckets[b.key] ? fmtMoney(p.buckets[b.key]) : '—'}
                      </td>
                    ))}
                    <td className={cn(tdNum, 'font-semibold')}>{fmtMoney(p.total)}</td>
                  </tr>
                  {open === p.party.id &&
                    p.documents.map((d) => (
                      <tr key={`${d.kind}-${d.id}`} className="border-b bg-muted/20 text-[13px]">
                        <td className={`${td} pl-10`}>
                          <DocLink
                            href={
                              d.kind === 'invoice'
                                ? `/billing/invoices/${d.id}`
                                : `/purchase/orders/${d.id}`
                            }
                            permission={
                              d.kind === 'invoice' ? 'invoices.view' : 'purchase_orders.view'
                            }
                          >
                            {d.number}
                          </DocLink>
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            · {fmtDate(d.date)} · due {fmtDate(d.dueDate)}
                          </span>
                        </td>
                        {AGEING_BUCKETS.map((b) => (
                          <td key={b.key} className={tdNum}>
                            {d.bucket === b.key ? (
                              <>
                                {fmtMoney(d.balanceInr)}
                                {d.currency !== 'INR' && (
                                  <div className="text-xs text-muted-foreground">
                                    {fmtMoney(d.balance, d.currency)}
                                  </div>
                                )}
                              </>
                            ) : (
                              ''
                            )}
                          </td>
                        ))}
                        <td className={tdNum}>
                          {d.overdueDays > 0 ? `${d.overdueDays} days late` : ''}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
            {r.parties.length > 0 && (
              <tfoot>
                <tr className={totalRow}>
                  <td className={td}>Total</td>
                  {AGEING_BUCKETS.map((b) => (
                    <td key={b.key} className={tdNum}>
                      {fmtMoney(r.totals[b.key])}
                    </td>
                  ))}
                  <td className={tdNum}>{fmtMoney(r.totals.total)}</td>
                </tr>
              </tfoot>
            )}
          </ReportTable>
          {!receipt && (
            <p className="text-xs text-muted-foreground">
              A purchase order is due its supplier&apos;s payment days after the PO date.
            </p>
          )}
        </div>
      )}
    </>
  );
}
