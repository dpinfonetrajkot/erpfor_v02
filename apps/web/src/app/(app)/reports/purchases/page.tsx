'use client';

import { format, parseISO } from 'date-fns';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useApiQuery, useLookups } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { PurchaseReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { PaymentStatusBadge } from '@/components/app/status';
import { ColumnChart, compactInr } from '@/components/reports/column-chart';
import { BarList, SegmentedBar } from '@/components/reports/mini-charts';
import {
  ChartCard,
  EmptyRow,
  ExportButton,
  FilterBar,
  PeriodPicker,
  periodText,
  previousPeriod,
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
  usePeriod,
} from '@/components/reports/report-kit';
import { DocLink } from '@/components/reports/trace-bits';

const TABS = [
  { key: 'register', label: 'Purchase register' },
  { key: 'supplier', label: 'By supplier' },
] as const;
const TYPES = { MATERIAL: 'Material', JOB_WORK: 'Job work' } as const;
const inr = (v: number) => fmtMoney(v);

export default function PurchaseReportPage() {
  return (
    <RequirePermission permission="business_reports.view">
      <Purchases />
    </RequirePermission>
  );
}

function Purchases() {
  const params = useListParams({ filters: { view: 'register' } });
  const view = params.filters.view as 'register' | 'supplier';
  const { from, to, preset } = usePeriod(params);
  const prev = previousPeriod(from, to);
  const lookups = useLookups('suppliers');
  const filters = { supplierId: params.filters.supplierId, type: params.filters.type };
  const query = { from, to, view, ...filters };
  const { data, isFetching } = useApiQuery<PurchaseReport>('/reports/purchases', query);
  // the register feeds the trend and the material / job work split; the supplier view the top list
  const register = useApiQuery<PurchaseReport>('/reports/purchases', {
    from,
    to,
    view: 'register',
    ...filters,
  }).data;
  const bySupplier = useApiQuery<PurchaseReport>('/reports/purchases', {
    from,
    to,
    view: 'supplier',
    ...filters,
  }).data;
  const before = useApiQuery<PurchaseReport>('/reports/purchases', {
    from: prev.from,
    to: prev.to,
    view: 'supplier',
    ...filters,
  }).data;
  const r = data?.view === view ? data : undefined;
  const rows = register?.view === 'register' ? register.rows : [];
  const t = r?.totals;
  const was = before?.totals;

  const daily = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 <= 45;
  const buckets = new Map<string, number>();
  for (const x of rows) {
    const key = daily ? x.poDate.slice(0, 10) : x.poDate.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + x.total);
  }
  const trend: { label: string; short: string; values: number[] }[] = [];
  if (daily) {
    for (
      let d = from;
      d <= to;
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    ) {
      trend.push({
        label: fmtDate(d),
        short: format(parseISO(d), 'd'),
        values: [buckets.get(d) ?? 0],
      });
    }
  } else {
    for (
      let m = from.slice(0, 7);
      m <= to.slice(0, 7);
      m = format(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)), 'yyyy-MM')
    ) {
      trend.push({
        label: format(parseISO(`${m}-01`), 'MMMM yyyy'),
        short: format(parseISO(`${m}-01`), 'MMM'),
        values: [buckets.get(m) ?? 0],
      });
    }
  }
  const material = rows.filter((x) => x.type === 'MATERIAL').reduce((s, x) => s + x.total, 0);
  const jobWork = rows.filter((x) => x.type === 'JOB_WORK').reduce((s, x) => s + x.total, 0);
  const supplierName = lookups.data?.suppliers.find(
    (s) => String(s.value) === params.filters.supplierId,
  )?.label;

  return (
    <>
      <PrintHeader
        title={`Purchases · ${TABS.find((x) => x.key === view)?.label}`}
        lines={[
          periodText(from, to, preset),
          supplierName && `Supplier: ${supplierName}`,
          params.filters.type
            ? TYPES[params.filters.type as keyof typeof TYPES]
            : 'Material + job work',
          'Amounts in rupees',
        ]}
      />
      <PageHeader
        className="print:hidden"
        title="Purchases"
        description="Approved purchase orders (material and job work) by PO date, with what is paid."
        actions={
          <>
            <PrintButton />
            <ExportButton
              path="/reports/purchases/export"
              query={query}
              permission="business_reports.export"
            />
          </>
        }
      />
      <ReportTabs
        tabs={TABS}
        value={view}
        onChange={(k) => params.set({ view: k })}
        label="Purchase report"
      />
      <FilterBar>
        <PeriodPicker params={params} />
        <FilterSelect
          value={params.filters.supplierId}
          onChange={(v) => params.set({ supplierId: v })}
          options={(lookups.data?.suppliers ?? []).map((o) => ({ value: o.value, label: o.label }))}
          placeholder="All suppliers"
          className="max-w-64"
        />
        <FilterSelect
          value={params.filters.type}
          onChange={(v) => params.set({ type: v })}
          options={[
            { value: 'MATERIAL', label: 'Material' },
            { value: 'JOB_WORK', label: 'Job work' },
          ]}
          placeholder="Material + job work"
        />
      </FilterBar>

      {!r || !t ? (
        <Skeleton className="h-96" />
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70')}>
          <StatRow>
            <StatTile
              label="Purchase orders"
              value={t.orders}
              compare={{ now: t.orders, before: was?.orders, upIsGood: null }}
            />
            <StatTile
              label="Taxable value"
              value={inr(t.taxable)}
              sub={`GST ${inr(t.tax)}`}
              compare={{ now: t.taxable, before: was?.taxable, upIsGood: null }}
            />
            <StatTile
              label="Total with GST"
              value={inr(t.total)}
              sub={`Material ${inr(material)} · job work ${inr(jobWork)}`}
            />
            <StatTile
              label="Still to pay"
              value={inr(t.balance)}
              sub={`${inr(t.paid)} paid (${share(t.paid, t.total)})`}
              tone={t.balance > 0 ? undefined : 'good'}
            />
          </StatRow>

          <div className="grid gap-4 lg:grid-cols-3 print:grid-cols-3">
            <ChartCard
              className="lg:col-span-2 print:col-span-2"
              title={daily ? 'Purchases per day' : 'Purchases per month'}
              description="Purchase order totals with GST, by PO date."
            >
              <ColumnChart
                title="Purchases"
                series={[{ label: 'Purchases', color: 'var(--chart-1)' }]}
                data={trend}
                format={inr}
                tick={compactInr}
                height={240}
              />
            </ChartCard>
            <ChartCard title="Top suppliers" description="Purchase order totals with GST.">
              {bySupplier?.view === 'supplier' && bySupplier.rows.length ? (
                <>
                  <BarList
                    label="Top suppliers"
                    format={inr}
                    rows={bySupplier.rows.slice(0, 6).map((x) => ({
                      key: String(x.supplier.id),
                      label: x.supplier.name,
                      value: x.total,
                      hint: share(x.total, bySupplier.totals.total),
                    }))}
                  />
                  {material > 0 && jobWork > 0 && (
                    <div className="mt-4 border-t pt-3">
                      <SegmentedBar
                        label="Material and job work"
                        format={inr}
                        parts={[
                          { key: 'm', label: 'Material', value: material, color: 'var(--chart-1)' },
                          { key: 'j', label: 'Job work', value: jobWork, color: 'var(--chart-2)' },
                        ]}
                      />
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2.5 rounded-[2px] bg-chart-1" /> Material{' '}
                          {share(material, material + jobWork)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2.5 rounded-[2px] bg-chart-2" /> Job work{' '}
                          {share(jobWork, material + jobWork)}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No purchase orders in this period.</p>
              )}
            </ChartCard>
          </div>

          {r.view === 'register' ? (
            <ReportTable minWidth={1000} title="Purchase register">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Purchase order</th>
                  <th className={th}>Supplier</th>
                  <th className={thNum}>Received</th>
                  <th className={thNum}>Taxable</th>
                  <th className={thNum}>GST</th>
                  <th className={thNum}>Total</th>
                  <th className={thNum}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.length === 0 && (
                  <EmptyRow cols={7}>No purchase orders in this period.</EmptyRow>
                )}
                {r.rows.map((x) => (
                  <tr key={x.id} className="border-b align-top last:border-0">
                    <td className={td}>
                      <DocLink href={`/purchase/orders/${x.id}`} permission="purchase_orders.view">
                        {x.poNo}
                      </DocLink>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {fmtDate(x.poDate)} · {x.company}
                        {x.type === 'JOB_WORK' && <Badge variant="secondary">Job work</Badge>}
                      </div>
                    </td>
                    <td className={td}>
                      <div className="font-medium">{x.supplier.name}</div>
                      {x.gstin && (
                        <div className="font-mono text-xs text-muted-foreground">{x.gstin}</div>
                      )}
                    </td>
                    <td className={tdNum}>{x.receivedPercent}%</td>
                    <td className={tdNum}>{fmtMoney(x.taxable, x.currency)}</td>
                    <td className={tdNum}>{fmtMoney(x.tax, x.currency)}</td>
                    <td className={cn(tdNum, 'font-semibold')}>{fmtMoney(x.total, x.currency)}</td>
                    <td className={tdNum}>
                      {fmtMoney(x.balance, x.currency)}
                      <div className="mt-0.5">
                        <PaymentStatusBadge status={x.paymentStatus} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {r.rows.length > 0 && (
                <tfoot>
                  <tr className={totalRow}>
                    <td className={td} colSpan={3}>
                      Total ({r.totals.orders} orders)
                    </td>
                    <td className={tdNum}>{inr(r.totals.taxable)}</td>
                    <td className={tdNum}>{inr(r.totals.tax)}</td>
                    <td className={tdNum}>{inr(r.totals.total)}</td>
                    <td className={tdNum}>{inr(r.totals.balance)}</td>
                  </tr>
                </tfoot>
              )}
            </ReportTable>
          ) : (
            <ReportTable minWidth={820} title="Purchases by supplier">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Supplier</th>
                  <th className={thNum}>Orders</th>
                  <th className={thNum}>Taxable</th>
                  <th className={thNum}>GST</th>
                  <th className={thNum}>Total</th>
                  <th className={thNum}>Share</th>
                  <th className={thNum}>Paid</th>
                  <th className={thNum}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.length === 0 && (
                  <EmptyRow cols={8}>No purchase orders in this period.</EmptyRow>
                )}
                {r.rows.map((x) => (
                  <tr key={x.supplier.id} className="border-b last:border-0">
                    <td className={`${td} font-medium`}>{x.supplier.name}</td>
                    <td className={tdNum}>{x.orders}</td>
                    <td className={tdNum}>{inr(x.taxable)}</td>
                    <td className={tdNum}>{inr(x.tax)}</td>
                    <td className={cn(tdNum, 'font-semibold')}>{inr(x.total)}</td>
                    <td className={cn(tdNum, 'text-muted-foreground')}>
                      {share(x.total, r.totals.total)}
                    </td>
                    <td className={tdNum}>{inr(x.paid)}</td>
                    <td className={tdNum}>{inr(x.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {r.rows.length > 0 && (
                <tfoot>
                  <tr className={totalRow}>
                    <td className={td}>Total ({r.rows.length} suppliers)</td>
                    <td className={tdNum}>{r.totals.orders}</td>
                    <td className={tdNum}>{inr(r.totals.taxable)}</td>
                    <td className={tdNum}>{inr(r.totals.tax)}</td>
                    <td className={tdNum}>{inr(r.totals.total)}</td>
                    <td className={tdNum}>100%</td>
                    <td className={tdNum}>{inr(r.totals.paid)}</td>
                    <td className={tdNum}>{inr(r.totals.balance)}</td>
                  </tr>
                </tfoot>
              )}
            </ReportTable>
          )}
        </div>
      )}
    </>
  );
}
