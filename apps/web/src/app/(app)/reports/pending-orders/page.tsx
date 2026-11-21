'use client';

import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { useApiQuery, useLookups } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { PendingOrdersReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge, Skeleton, Switch } from '@/components/ui/primitives';
import { FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { BarList } from '@/components/reports/mini-charts';
import {
  ChartCard,
  EmptyRow,
  ExportButton,
  FilterBar,
  localToday,
  PrintButton,
  PrintHeader,
  ReportTable,
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
import { DocLink } from '@/components/reports/trace-bits';

const MADE = {
  PENDING: 'Not decided',
  INHOUSE: 'In-house',
  OUTSOURCE: 'Outsource',
  FROM_STOCK: 'From stock',
} as const;
const inr = (v: number) => fmtMoney(v);

export default function PendingOrdersPage() {
  return (
    <RequirePermission permission="reports.view">
      <PendingOrders />
    </RequirePermission>
  );
}

/** Adds up `value` per key, biggest first. */
function group<T>(rows: T[], key: (r: T) => string, value: (r: T) => number) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
  return [...m.entries()].map(([k, v]) => ({ key: k, value: v })).sort((a, b) => b.value - a.value);
}

function PendingOrders() {
  const params = useListParams();
  const lookups = useLookups('customers', 'products');
  const query = {
    customerId: params.filters.customerId,
    productId: params.filters.productId,
    overdue: params.filters.overdue,
  };
  const { data, isFetching } = useApiQuery<PendingOrdersReport>('/reports/pending-orders', query);
  const customerName = lookups.data?.customers.find(
    (c) => String(c.value) === params.filters.customerId,
  )?.label;
  const productName = lookups.data?.products.find(
    (c) => String(c.value) === params.filters.productId,
  )?.label;

  // when the pending value is due
  const today = localToday();
  const daysTo = (d: string | null) =>
    d ? Math.round((Date.parse(d.slice(0, 10)) - Date.parse(today)) / 86_400_000) : null;
  const due = data
    ? [
        {
          key: 'late',
          label: 'Late',
          color: 'var(--destructive)',
          test: (n: number | null) => n !== null && n < 0,
        },
        {
          key: 'week',
          label: 'Due in 7 days',
          color: 'var(--age-4)',
          test: (n: number | null) => n !== null && n >= 0 && n <= 7,
        },
        {
          key: 'month',
          label: 'Due in 8–30 days',
          color: 'var(--age-3)',
          test: (n: number | null) => n !== null && n > 7 && n <= 30,
        },
        {
          key: 'later',
          label: 'Due later',
          color: 'var(--age-2)',
          test: (n: number | null) => n !== null && n > 30,
        },
        {
          key: 'none',
          label: 'No due date',
          color: 'var(--muted-foreground)',
          test: (n: number | null) => n === null,
        },
      ].map((b) => {
        const rows = data.rows.filter((r) => b.test(daysTo(r.dueDate)));
        return {
          key: b.key,
          label: b.label,
          color: b.color,
          value: rows.reduce((s, r) => s + r.valueInr, 0),
          hint: `${rows.length} line${rows.length === 1 ? '' : 's'}`,
        };
      })
    : [];

  return (
    <>
      <PrintHeader
        title="Pending orders"
        lines={[
          `As on ${fmtDate(today)}`,
          customerName ? `Customer: ${customerName}` : 'All customers',
          productName && `Product: ${productName}`,
          params.filters.overdue === 'true' && 'Only late lines',
          'Values in rupees, before GST',
        ]}
      />
      <PageHeader
        className="print:hidden"
        title="Pending orders"
        description="Approved sales orders with sets still to dispatch, oldest due date first."
        actions={
          <>
            <PrintButton />
            <ExportButton
              path="/reports/pending-orders/export"
              query={query}
              permission="reports.export"
            />
          </>
        }
      />
      <FilterBar>
        <FilterSelect
          value={params.filters.customerId}
          onChange={(v) => params.set({ customerId: v })}
          options={(lookups.data?.customers ?? []).map((o) => ({ value: o.value, label: o.label }))}
          placeholder="All customers"
          className="max-w-64"
        />
        <FilterSelect
          value={params.filters.productId}
          onChange={(v) => params.set({ productId: v })}
          options={(lookups.data?.products ?? []).map((o) => ({ value: o.value, label: o.label }))}
          placeholder="All products"
          className="max-w-60"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={params.filters.overdue === 'true'}
            onCheckedChange={(c) => params.set({ overdue: c ? 'true' : undefined })}
            aria-label="Only late"
          />
          Only late
        </label>
      </FilterBar>

      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70')}>
          <StatRow>
            <StatTile
              label="Orders"
              value={data.summary.orders}
              sub={`${data.summary.lines} product line(s)`}
            />
            <StatTile label="Sets to dispatch" value={fmtQty(data.summary.pendingSets)} />
            <StatTile
              label="Value to dispatch"
              value={inr(data.summary.valueInr)}
              sub="in rupees, before GST"
            />
            <StatTile
              label="Late"
              value={data.summary.overdueLines}
              tone={data.summary.overdueLines > 0 ? 'bad' : undefined}
              sub={`${inr(data.summary.overdueValueInr)} past the due date (${share(data.summary.overdueValueInr, data.summary.valueInr)})`}
            />
          </StatRow>

          {data.rows.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-3 print:grid-cols-3">
              <ChartCard title="When it is due" description="Pending value by due date.">
                <BarList label="Pending value by due date" format={inr} rows={due} />
              </ChartCard>
              <ChartCard title="By customer" description="Pending value, largest first.">
                <BarList
                  label="Pending value by customer"
                  format={inr}
                  rows={group(
                    data.rows,
                    (r) => r.customer.name,
                    (r) => r.valueInr,
                  )
                    .slice(0, 6)
                    .map((g) => ({
                      key: g.key,
                      label: g.key,
                      value: g.value,
                      hint: share(g.value, data.summary.valueInr),
                    }))}
                />
              </ChartCard>
              <ChartCard title="By product" description="Sets still to dispatch.">
                <BarList
                  label="Pending sets by product"
                  format={(v) => `${fmtQty(v)} sets`}
                  rows={group(
                    data.rows,
                    (r) => r.product,
                    (r) => r.pending,
                  )
                    .slice(0, 6)
                    .map((g) => ({ key: g.key, label: g.key, value: g.value }))}
                />
              </ChartCard>
            </div>
          )}

          <ReportTable minWidth={1000} title="Order lines to dispatch">
            <thead className={theadClass}>
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Customer</th>
                <th className={th}>Product</th>
                <th className={thNum}>Ordered</th>
                <th className={thNum}>Packed</th>
                <th className={thNum}>Dispatched</th>
                <th className={thNum}>Pending</th>
                <th className={th}>Due</th>
                <th className={thNum}>Pending value</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <EmptyRow cols={9}>Nothing pending. Every approved order is dispatched.</EmptyRow>
              )}
              {data.rows.map((r) => (
                <tr key={r.lineId} className="border-b align-top last:border-0">
                  <td className={td}>
                    <DocLink href={`/sales/orders/${r.order.id}`} permission="sales_orders.view">
                      {r.order.soNo}
                    </DocLink>
                    <div className="text-xs text-muted-foreground">{fmtDate(r.order.soDate)}</div>
                  </td>
                  <td className={td}>
                    <div className="font-medium">{r.customer.name}</div>
                    {r.order.customerPoNo && (
                      <div className="text-xs text-muted-foreground">PO {r.order.customerPoNo}</div>
                    )}
                  </td>
                  <td className={td}>
                    <div>{r.product}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {r.spec && <span>{r.spec}</span>}
                      <Badge variant={r.decision === 'OUTSOURCE' ? 'secondary' : 'muted'}>
                        {MADE[r.decision]}
                      </Badge>
                    </div>
                  </td>
                  <td className={tdNum}>{fmtQty(r.ordered)}</td>
                  <td className={tdNum}>{fmtQty(r.packed)}</td>
                  <td className={tdNum}>{fmtQty(r.dispatched)}</td>
                  <td className={cn(tdNum, 'font-semibold')}>{fmtQty(r.pending)}</td>
                  <td
                    className={cn(
                      td,
                      'whitespace-nowrap',
                      r.overdueDays > 0 && 'font-medium text-destructive',
                    )}
                  >
                    {fmtDate(r.dueDate)}
                    {r.overdueDays > 0 && <div className="text-xs">{r.overdueDays} days late</div>}
                  </td>
                  <td className={tdNum}>
                    {fmtMoney(r.value, r.currency)}
                    {r.currency !== 'INR' && (
                      <div className="text-xs text-muted-foreground">{inr(r.valueInr)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className={totalRow}>
                  <td className={td} colSpan={3}>
                    Total ({data.summary.orders} orders, {data.summary.lines} lines)
                  </td>
                  <td className={tdNum}>{fmtQty(data.rows.reduce((s, r) => s + r.ordered, 0))}</td>
                  <td className={tdNum}>{fmtQty(data.rows.reduce((s, r) => s + r.packed, 0))}</td>
                  <td className={tdNum}>
                    {fmtQty(data.rows.reduce((s, r) => s + r.dispatched, 0))}
                  </td>
                  <td className={tdNum}>{fmtQty(data.summary.pendingSets)}</td>
                  <td className={td} />
                  <td className={tdNum}>{inr(data.summary.valueInr)}</td>
                </tr>
              </tfoot>
            )}
          </ReportTable>
        </div>
      )}
    </>
  );
}
