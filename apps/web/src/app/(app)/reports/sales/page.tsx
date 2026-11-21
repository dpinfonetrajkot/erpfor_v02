'use client';

import { INDIAN_STATES, type SalesGroup } from '@bht/shared';
import { format, parseISO } from 'date-fns';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { useApiQuery, useLookups } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { SalesReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { ColumnChart, compactInr } from '@/components/reports/column-chart';
import { BarList } from '@/components/reports/mini-charts';
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
  { key: 'register', label: 'GST sales register' },
  { key: 'customer', label: 'By customer' },
  { key: 'product', label: 'By product' },
  { key: 'month', label: 'By month' },
] as const;
const stateName = (code: string | null) =>
  code ? `${INDIAN_STATES.find((s) => s.code === code)?.name ?? code} (${code})` : 'Export';
const monthName = (m: string) => format(parseISO(`${m}-01`), 'MMM yyyy');
const inr = (v: number) => fmtMoney(v);
const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

export default function SalesReportPage() {
  return (
    <RequirePermission permission="business_reports.view">
      <Sales />
    </RequirePermission>
  );
}

function Sales() {
  const params = useListParams({ filters: { view: 'register' } });
  const view = params.filters.view as SalesGroup;
  const { from, to, preset } = usePeriod(params);
  const prev = previousPeriod(from, to);
  const lookups = useLookups('companies', 'customers');
  const filters = { companyId: params.filters.companyId, customerId: params.filters.customerId };
  const query = { from, to, view, ...filters };
  const { data, isFetching } = useApiQuery<SalesReport>('/reports/sales', query);
  // headline figures (this and the previous period) and the trend: same filters, other groupings
  const summary = useApiQuery<SalesReport>('/reports/sales', {
    from,
    to,
    view: 'customer',
    ...filters,
  }).data;
  const before = useApiQuery<SalesReport>('/reports/sales', {
    from: prev.from,
    to: prev.to,
    view: 'customer',
    ...filters,
  }).data;
  const daily = days(from, to) <= 45;
  const trend = useApiQuery<SalesReport>('/reports/sales', {
    from,
    to,
    view: daily ? 'register' : 'month',
    ...filters,
  }).data;
  const products = useApiQuery<SalesReport>(
    '/reports/sales',
    { from, to, view: 'product', ...filters },
    view === 'product',
  ).data;
  const r = data?.view === view ? data : undefined;
  const now = summary?.view === 'customer' ? summary.totals : undefined;
  const was = before?.view === 'customer' ? before.totals : undefined;

  const companyName = lookups.data?.companies.find(
    (c) => String(c.value) === params.filters.companyId,
  )?.label;
  const customerName = lookups.data?.customers.find(
    (c) => String(c.value) === params.filters.customerId,
  )?.label;

  // sales per day (short periods) or per month
  const trendData = (() => {
    if (!trend) return [];
    if (trend.view === 'month')
      return trend.rows.map((m) => ({
        label: monthName(m.month),
        short: format(parseISO(`${m.month}-01`), 'MMM'),
        values: [m.total, m.received],
      }));
    if (trend.view !== 'register') return [];
    const byDay = new Map<string, number>();
    for (const x of trend.rows)
      if (x.status !== 'CANCELLED')
        byDay.set(
          x.invoiceDate.slice(0, 10),
          (byDay.get(x.invoiceDate.slice(0, 10)) ?? 0) + x.inr.total,
        );
    const out: { label: string; short: string; values: number[] }[] = [];
    for (
      let d = from;
      d <= to;
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    ) {
      out.push({ label: fmtDate(d), short: format(parseISO(d), 'd'), values: [byDay.get(d) ?? 0] });
    }
    return out;
  })();

  return (
    <>
      <PrintHeader
        title={`Sales & GST · ${TABS.find((t) => t.key === view)?.label}`}
        lines={[
          periodText(from, to, preset),
          companyName ? `Company: ${companyName}` : 'Both companies',
          customerName && `Customer: ${customerName}`,
          'Amounts in rupees',
        ]}
      />
      <PageHeader
        className="print:hidden"
        title="Sales & GST"
        description="Issued invoices by date. Amounts in rupees; foreign-currency invoices at their own exchange rate."
        actions={
          <>
            <PrintButton />
            <ExportButton
              path="/reports/sales/export"
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
        label="Sales report"
      />
      <FilterBar>
        <PeriodPicker params={params} />
        <FilterSelect
          value={params.filters.companyId}
          onChange={(v) => params.set({ companyId: v })}
          options={(lookups.data?.companies ?? []).map((o) => ({
            value: o.value,
            label: String(o.meta?.code ?? o.label),
          }))}
          placeholder="Both companies"
        />
        <FilterSelect
          value={params.filters.customerId}
          onChange={(v) => params.set({ customerId: v })}
          options={(lookups.data?.customers ?? []).map((o) => ({ value: o.value, label: o.label }))}
          placeholder="All customers"
          className="max-w-64"
        />
      </FilterBar>

      {!r || !now ? (
        <Skeleton className="h-96" />
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70')}>
          <StatRow>
            <StatTile
              label="Invoices"
              value={now.invoices}
              compare={{ now: now.invoices, before: was?.invoices }}
            />
            <StatTile
              label="Taxable value"
              value={inr(now.taxable)}
              compare={{ now: now.taxable, before: was?.taxable }}
            />
            <StatTile
              label="GST"
              value={inr(now.gst)}
              sub={
                now.taxable
                  ? `${((now.gst / now.taxable) * 100).toFixed(1)}% of taxable value`
                  : undefined
              }
            />
            <StatTile
              label="Invoice total"
              value={inr(now.total)}
              sub={`${inr(now.paid)} received · ${inr(now.balance)} to receive`}
              compare={{ now: now.total, before: was?.total }}
            />
          </StatRow>

          <div className="grid gap-4 lg:grid-cols-3 print:grid-cols-3">
            <ChartCard
              className="lg:col-span-2 print:col-span-2"
              title={daily ? 'Sales per day' : 'Sales and money received per month'}
              description={
                daily
                  ? 'Invoice totals with GST, by invoice date.'
                  : 'Invoice totals with GST; money by payment date.'
              }
            >
              <ColumnChart
                title={daily ? 'Sales per day' : 'Sales and money received per month'}
                series={
                  daily
                    ? [{ label: 'Sales', color: 'var(--chart-1)' }]
                    : [
                        { label: 'Sales', color: 'var(--chart-1)' },
                        { label: 'Received', color: 'var(--chart-2)' },
                      ]
                }
                data={trendData}
                format={inr}
                tick={compactInr}
                height={240}
              />
            </ChartCard>
            {view === 'product' && products?.view === 'product' ? (
              <ChartCard title="Top products" description="Value before GST.">
                {products.rows.length ? (
                  <BarList
                    label="Top products"
                    format={inr}
                    rows={products.rows.slice(0, 7).map((x) => ({
                      key: x.product,
                      label: x.product,
                      value: x.value,
                      hint: share(x.value, products.totals.value),
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                )}
              </ChartCard>
            ) : (
              <ChartCard title="Top customers" description="Invoice totals with GST.">
                {summary?.view === 'customer' && summary.rows.length ? (
                  <BarList
                    label="Top customers"
                    format={inr}
                    rows={summary.rows.slice(0, 7).map((x) => ({
                      key: String(x.customer.id),
                      label: x.customer.name,
                      value: x.total,
                      hint: share(x.total, now.total),
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                )}
              </ChartCard>
            )}
          </div>

          {r.view === 'register' && (
            <ReportTable minWidth={1100} title="GST sales register">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Customer · GSTIN</th>
                  <th className={th}>Place of supply</th>
                  <th className={thNum}>Taxable</th>
                  <th className={thNum}>CGST</th>
                  <th className={thNum}>SGST</th>
                  <th className={thNum}>IGST</th>
                  <th className={thNum}>Total</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.length === 0 && <EmptyRow cols={8}>No invoices in this period.</EmptyRow>}
                {r.rows.map((x) => {
                  const cancelled = x.status === 'CANCELLED';
                  return (
                    <tr
                      key={x.id}
                      className={cn(
                        'border-b align-top last:border-0',
                        cancelled && 'text-muted-foreground',
                      )}
                    >
                      <td className={td}>
                        <DocLink href={`/billing/invoices/${x.id}`} permission="invoices.view">
                          {x.invoiceNo}
                        </DocLink>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {fmtDate(x.invoiceDate)}
                          {cancelled && <Badge variant="destructive">Cancelled</Badge>}
                        </div>
                      </td>
                      <td className={td}>
                        <div className={cn('font-medium', cancelled && 'line-through')}>
                          {x.billingName}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {x.gstin ?? (x.currency !== 'INR' ? 'Export' : 'Unregistered')}
                        </div>
                      </td>
                      <td className={`${td} text-[13px]`}>
                        {x.type === 'EXPORT_INVOICE' ? 'Export (LUT)' : stateName(x.placeOfSupply)}
                      </td>
                      <td className={tdNum}>
                        {inr(x.inr.taxable)}
                        {x.currency !== 'INR' && (
                          <div className="text-xs text-muted-foreground">
                            {fmtMoney(x.taxable, x.currency)} @ {x.exchangeRate}
                          </div>
                        )}
                      </td>
                      <td className={tdNum}>{x.cgst ? inr(x.cgst) : '—'}</td>
                      <td className={tdNum}>{x.sgst ? inr(x.sgst) : '—'}</td>
                      <td className={tdNum}>{x.igst ? inr(x.igst) : '—'}</td>
                      <td className={cn(tdNum, 'font-semibold', cancelled && 'line-through')}>
                        {inr(x.inr.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {r.rows.length > 0 && (
                <tfoot>
                  <tr className={totalRow}>
                    <td className={td} colSpan={3}>
                      Total ({r.totals.invoices} invoices
                      {r.totals.cancelled ? `; ${r.totals.cancelled} cancelled not added` : ''})
                    </td>
                    <td className={tdNum}>{inr(r.totals.taxable)}</td>
                    <td className={tdNum}>{inr(r.totals.cgst)}</td>
                    <td className={tdNum}>{inr(r.totals.sgst)}</td>
                    <td className={tdNum}>{inr(r.totals.igst)}</td>
                    <td className={tdNum}>{inr(r.totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </ReportTable>
          )}

          {r.view === 'customer' && (
            <ReportTable minWidth={880} title="Sales by customer">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Customer</th>
                  <th className={thNum}>Invoices</th>
                  <th className={thNum}>Taxable</th>
                  <th className={thNum}>GST</th>
                  <th className={thNum}>Total</th>
                  <th className={thNum}>Share</th>
                  <th className={thNum}>Received</th>
                  <th className={thNum}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.length === 0 && <EmptyRow cols={8}>No invoices in this period.</EmptyRow>}
                {r.rows.map((x) => (
                  <tr key={x.customer.id} className="border-b last:border-0">
                    <td className={`${td} font-medium`}>{x.customer.name}</td>
                    <td className={tdNum}>{x.invoices}</td>
                    <td className={tdNum}>{inr(x.taxable)}</td>
                    <td className={tdNum}>{inr(x.gst)}</td>
                    <td className={cn(tdNum, 'font-semibold')}>{inr(x.total)}</td>
                    <td className={cn(tdNum, 'text-muted-foreground')}>
                      {share(x.total, r.totals.total)}
                    </td>
                    <td className={tdNum}>{inr(x.paid)}</td>
                    <td className={cn(tdNum, x.balance > 0 && 'font-medium')}>{inr(x.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {r.rows.length > 0 && (
                <tfoot>
                  <tr className={totalRow}>
                    <td className={td}>Total ({r.rows.length} customers)</td>
                    <td className={tdNum}>{r.totals.invoices}</td>
                    <td className={tdNum}>{inr(r.totals.taxable)}</td>
                    <td className={tdNum}>{inr(r.totals.gst)}</td>
                    <td className={tdNum}>{inr(r.totals.total)}</td>
                    <td className={tdNum}>100%</td>
                    <td className={tdNum}>{inr(r.totals.paid)}</td>
                    <td className={tdNum}>{inr(r.totals.balance)}</td>
                  </tr>
                </tfoot>
              )}
            </ReportTable>
          )}

          {r.view === 'product' && (
            <>
              <ReportTable minWidth={680} title="Sales by product">
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Product</th>
                    <th className={thNum}>Quantity</th>
                    <th className={thNum}>Invoices</th>
                    <th className={thNum}>Value</th>
                    <th className={thNum}>Share</th>
                    <th className={thNum}>Average rate</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.length === 0 && <EmptyRow cols={6}>No invoices in this period.</EmptyRow>}
                  {r.rows.map((x) => (
                    <tr key={x.product} className="border-b last:border-0">
                      <td className={`${td} font-medium`}>{x.product}</td>
                      <td className={tdNum}>
                        {fmtQty(x.quantity)}{' '}
                        <span className="text-xs text-muted-foreground">
                          {x.uom === 'SET' ? 'sets' : x.uom.toLowerCase()}
                        </span>
                      </td>
                      <td className={tdNum}>{x.invoices}</td>
                      <td className={cn(tdNum, 'font-semibold')}>{inr(x.value)}</td>
                      <td className={cn(tdNum, 'text-muted-foreground')}>
                        {share(x.value, r.totals.value)}
                      </td>
                      <td className={tdNum}>{x.quantity ? inr(x.value / x.quantity) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {r.rows.length > 0 && (
                  <tfoot>
                    <tr className={totalRow}>
                      <td className={td}>Total ({r.rows.length} products)</td>
                      <td className={tdNum}>{fmtQty(r.totals.quantity)}</td>
                      <td className={tdNum} />
                      <td className={tdNum}>{inr(r.totals.value)}</td>
                      <td className={tdNum}>100%</td>
                      <td className={tdNum} />
                    </tr>
                  </tfoot>
                )}
              </ReportTable>
              <p className="text-xs text-muted-foreground">
                Value = line amount after the invoice discount, without freight and GST.
              </p>
            </>
          )}

          {r.view === 'month' && (
            <ReportTable minWidth={760} title="Sales by month">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Month</th>
                  <th className={thNum}>Invoices</th>
                  <th className={thNum}>Taxable</th>
                  <th className={thNum}>GST</th>
                  <th className={thNum}>Total</th>
                  <th className={thNum}>Money received</th>
                  <th className={thNum}>Received %</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr
                    key={x.month}
                    className={cn(
                      'border-b last:border-0',
                      !x.invoices && !x.received && 'text-muted-foreground',
                    )}
                  >
                    <td className={`${td} font-medium`}>{monthName(x.month)}</td>
                    <td className={tdNum}>{x.invoices || '—'}</td>
                    <td className={tdNum}>{inr(x.taxable)}</td>
                    <td className={tdNum}>{inr(x.gst)}</td>
                    <td className={cn(tdNum, 'font-semibold')}>{inr(x.total)}</td>
                    <td className={tdNum}>{inr(x.received)}</td>
                    <td className={cn(tdNum, 'text-muted-foreground')}>
                      {share(x.received, x.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={totalRow}>
                  <td className={td}>Total</td>
                  <td className={tdNum}>{r.totals.invoices}</td>
                  <td className={tdNum}>{inr(r.totals.taxable)}</td>
                  <td className={tdNum}>{inr(r.totals.gst)}</td>
                  <td className={tdNum}>{inr(r.totals.total)}</td>
                  <td className={tdNum}>{inr(r.totals.received)}</td>
                  <td className={tdNum}>{share(r.totals.received, r.totals.total)}</td>
                </tr>
              </tfoot>
            </ReportTable>
          )}
        </div>
      )}
    </>
  );
}
