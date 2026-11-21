'use client';

import { fmtDate, fmtQty } from '@/lib/format';
import { useApiQuery, useLookups } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { ProductionReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/primitives';
import { FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { ColumnChart, InlineBar } from '@/components/reports/column-chart';
import { BarList } from '@/components/reports/mini-charts';
import {
  ChartCard,
  EmptyRow,
  ExportButton,
  FilterBar,
  longMonth,
  PeriodPicker,
  periodText,
  previousPeriod,
  PrintButton,
  PrintHeader,
  shortMonth,
  StatRow,
  StatTile,
  td,
  tdNum,
  th,
  theadClass,
  thNum,
  usePeriod,
} from '@/components/reports/report-kit';
import { DocLink, FlushTable, Section } from '@/components/reports/trace-bits';

export default function ProductionReportPage() {
  return (
    <RequirePermission permission="reports.view">
      <Production />
    </RequirePermission>
  );
}

const pct = (v: number) => `${v.toFixed(1)}%`;

function Production() {
  const params = useListParams();
  const { from, to, preset } = usePeriod(params);
  const prev = previousPeriod(from, to);
  const lookups = useLookups('products');
  const query = { from, to, productId: params.filters.productId };
  const { data, isFetching } = useApiQuery<ProductionReport>('/reports/production', query);
  const was = useApiQuery<ProductionReport>('/reports/production', {
    ...query,
    from: prev.from,
    to: prev.to,
  }).data?.summary;
  const productName = lookups.data?.products.find(
    (p) => String(p.value) === params.filters.productId,
  )?.label;
  const maxStage = Math.max(0, ...(data?.byStage.map((s) => s.rejected) ?? []));
  const maxReason = Math.max(0, ...(data?.byReason.map((s) => s.rejected) ?? []));

  return (
    <>
      <PrintHeader
        title="Production & rejections"
        lines={[
          periodText(from, to, preset),
          productName ? `Product: ${productName}` : 'All products',
          'Quantities in pieces',
        ]}
      />
      <PageHeader
        className="print:hidden"
        title="Production & rejections"
        description="Route card output, where pieces were rejected and why, and parts received from job work."
        actions={
          <>
            <PrintButton />
            <ExportButton
              path="/reports/production/export"
              query={query}
              permission="reports.export"
              label="Rejections (CSV)"
            />
          </>
        }
      />
      <FilterBar>
        <PeriodPicker params={params} />
        <FilterSelect
          value={params.filters.productId}
          onChange={(v) => params.set({ productId: v })}
          options={(lookups.data?.products ?? []).map((o) => ({ value: o.value, label: o.label }))}
          placeholder="All products"
          className="max-w-60"
        />
      </FilterBar>

      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70')}>
          <StatRow>
            <StatTile
              label="Finished OK pieces"
              value={fmtQty(data.summary.finishedOk)}
              sub={`${data.summary.cardsFinished} route card(s) finished · ${data.summary.cardsStarted} started`}
              compare={{ now: data.summary.finishedOk, before: was?.finishedOk }}
            />
            <StatTile
              label="Rejected pieces"
              value={fmtQty(data.summary.rejected)}
              tone={data.summary.rejected > 0 ? 'bad' : undefined}
              sub="at all stages in the period"
              compare={{ now: data.summary.rejected, before: was?.rejected, upIsGood: false }}
            />
            <StatTile
              label="Rejection rate"
              value={pct(data.summary.rejectionRate)}
              sub={
                was
                  ? `previous period ${pct(was.rejectionRate)}`
                  : 'rejected ÷ (finished OK + rejected)'
              }
              tone={data.summary.rejectionRate > 2 ? 'bad' : undefined}
            />
            <StatTile
              label="Job work accepted"
              value={fmtQty(data.summary.jobWorkAccepted)}
              sub="parts back from vendors"
              compare={{
                now: data.summary.jobWorkAccepted,
                before: was?.jobWorkAccepted,
                upIsGood: null,
              }}
            />
          </StatRow>

          <div className="grid gap-4 lg:grid-cols-3 print:grid-cols-3">
            {data.months.length >= 2 ? (
              <ChartCard
                className="lg:col-span-2 print:col-span-2"
                title="Output per month"
                description="Finished OK pieces and pieces rejected at any stage."
              >
                <ColumnChart
                  title="Output per month"
                  series={[
                    { label: 'Finished OK', color: 'var(--chart-1)' },
                    { label: 'Rejected', color: 'var(--chart-2)' },
                  ]}
                  data={data.months.map((m) => ({
                    label: longMonth(m.month),
                    short: shortMonth(m.month),
                    values: [m.finishedOk, m.rejected],
                  }))}
                  format={(v) => `${fmtQty(v)} pcs`}
                  tick={(v) => fmtQty(v)}
                  height={240}
                />
              </ChartCard>
            ) : (
              <ChartCard
                className="lg:col-span-2 print:col-span-2"
                title="Finished OK by part"
                description="Pieces finished in the period, largest first."
              >
                {data.byItem.some((r) => r.finishedOk > 0) ? (
                  <BarList
                    label="Finished OK by part"
                    format={(v) => `${fmtQty(v)} pcs`}
                    rows={data.byItem
                      .filter((r) => r.finishedOk > 0)
                      .sort((a, b) => b.finishedOk - a.finishedOk)
                      .slice(0, 8)
                      .map((r) => ({
                        key: String(r.item.id),
                        label: r.item.name,
                        value: r.finishedOk,
                        hint: r.rejected ? `${pct(r.rate)} rejected` : undefined,
                      }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing finished in this period.</p>
                )}
              </ChartCard>
            )}
            <ChartCard
              title="Where pieces are rejected"
              description="Rejected pieces by stage, with the rejection rate of the stage."
            >
              {data.byStage.some((st) => st.rejected > 0) ? (
                <BarList
                  label="Rejected pieces by stage"
                  format={(v) => `${fmtQty(v)} pcs`}
                  color="var(--chart-2)"
                  rows={data.byStage
                    .filter((st) => st.rejected > 0)
                    .sort((a, b) => b.rejected - a.rejected)
                    .slice(0, 7)
                    .map((st) => ({
                      key: st.stage,
                      label: st.stage,
                      value: st.rejected,
                      hint: pct(st.rate),
                    }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No rejections in this period.</p>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title="Rejections by stage"
              description="Pieces checked at each stage in the period."
              flush
            >
              <FlushTable minWidth={440}>
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Stage</th>
                    <th className={thNum}>Checked</th>
                    <th className={thNum}>Rejected</th>
                    <th className={th} />
                    <th className={thNum}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStage.length === 0 && (
                    <EmptyRow cols={5}>No stage recorded in this period.</EmptyRow>
                  )}
                  {data.byStage.map((s) => (
                    <tr key={s.stage} className="border-b last:border-0">
                      <td className={td}>{s.stage}</td>
                      <td className={tdNum}>{fmtQty(s.received)}</td>
                      <td className={tdNum}>{s.rejected ? fmtQty(s.rejected) : '—'}</td>
                      <td className="w-28 px-2">
                        {s.rejected > 0 && <InlineBar value={s.rejected} max={maxStage} />}
                      </td>
                      <td className={cn(tdNum, s.rate > 0 && 'font-medium')}>
                        {s.rejected ? pct(s.rate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </FlushTable>
            </Section>

            <Section title="Rejection reasons" description="Most pieces first." flush>
              <FlushTable minWidth={440}>
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Reason</th>
                    <th className={thNum}>Pieces</th>
                    <th className={th} />
                    <th className={th}>Route cards</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byReason.length === 0 && (
                    <EmptyRow cols={4}>No rejections in this period.</EmptyRow>
                  )}
                  {data.byReason.map((r) => (
                    <tr key={r.reason} className="border-b last:border-0">
                      <td className={td}>{r.reason}</td>
                      <td className={tdNum}>{fmtQty(r.rejected)}</td>
                      <td className="w-28 px-2">
                        <InlineBar value={r.rejected} max={maxReason} />
                      </td>
                      <td className={`${td} font-mono text-xs`} title={r.cards.join(', ')}>
                        {r.cards.slice(0, 3).join(', ')}
                        {r.cards.length > 3 && (
                          <span className="font-sans text-muted-foreground">
                            {' '}
                            +{r.cards.length - 3} more
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </FlushTable>
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="By part" flush>
              <FlushTable minWidth={440}>
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Part</th>
                    <th className={thNum}>Finished OK</th>
                    <th className={thNum}>Rejected</th>
                    <th className={thNum}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byItem.length === 0 && (
                    <EmptyRow cols={4}>Nothing finished or rejected in this period.</EmptyRow>
                  )}
                  {data.byItem.map((r) => (
                    <tr key={r.item.id} className="border-b last:border-0">
                      <td className={td}>
                        <div className="font-medium">{r.item.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.item.code}</div>
                      </td>
                      <td className={tdNum}>{fmtQty(r.finishedOk)}</td>
                      <td className={tdNum}>{r.rejected ? fmtQty(r.rejected) : '—'}</td>
                      <td className={tdNum}>{r.rejected ? pct(r.rate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </FlushTable>
            </Section>

            <Section
              title="Job work by vendor"
              description="Parts received back in the period and our inspection result."
              flush
            >
              <FlushTable minWidth={440}>
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Vendor</th>
                    <th className={thNum}>Received</th>
                    <th className={thNum}>Accepted</th>
                    <th className={thNum}>Rejected</th>
                    <th className={thNum}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobWork.length === 0 && (
                    <EmptyRow cols={5}>No job work received in this period.</EmptyRow>
                  )}
                  {data.jobWork.map((v) => (
                    <tr key={v.vendor} className="border-b last:border-0">
                      <td className={td}>{v.vendor}</td>
                      <td className={tdNum}>{fmtQty(v.received)}</td>
                      <td className={tdNum}>{fmtQty(v.accepted)}</td>
                      <td className={tdNum}>{v.rejected ? fmtQty(v.rejected) : '—'}</td>
                      <td className={tdNum}>{v.rejected ? pct(v.rate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </FlushTable>
            </Section>
          </div>

          <Section
            title="Rejection details"
            description="Every stage entry with rejected pieces."
            flush
          >
            <FlushTable minWidth={760}>
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Route card</th>
                  <th className={th}>Part</th>
                  <th className={th}>Stage</th>
                  <th className={thNum}>Rejected</th>
                  <th className={th}>Reason</th>
                  <th className={th}>By</th>
                </tr>
              </thead>
              <tbody>
                {data.rejections.length === 0 && (
                  <EmptyRow cols={7}>No rejections in this period.</EmptyRow>
                )}
                {data.rejections.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className={`${td} whitespace-nowrap`}>{fmtDate(r.date)}</td>
                    <td className={td}>
                      <DocLink
                        href={`/production/route-cards/${r.rcId}`}
                        permission="route_cards.view"
                      >
                        {r.rcNo}
                      </DocLink>
                    </td>
                    <td className={td}>{r.item.name}</td>
                    <td className={td}>{r.stage}</td>
                    <td className={tdNum}>
                      {fmtQty(r.rejected)}{' '}
                      <span className="text-xs text-muted-foreground">of {fmtQty(r.received)}</span>
                    </td>
                    <td className={td}>{r.reason ?? '—'}</td>
                    <td className={`${td} text-muted-foreground`}>{r.by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </FlushTable>
          </Section>
        </div>
      )}
    </>
  );
}
