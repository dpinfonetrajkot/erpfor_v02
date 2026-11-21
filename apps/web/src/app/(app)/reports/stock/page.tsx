'use client';

import { STOCK_LOCATION_LABELS, STOCK_LOCATIONS, type StockLocation } from '@bht/shared';
import { fmtDate, fmtQty } from '@/lib/format';
import { useApiQuery, useLookups } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { StockMovementReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton, Switch } from '@/components/ui/primitives';
import { FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { BarList } from '@/components/reports/mini-charts';
import {
  ChartCard,
  EmptyRow,
  ExportButton,
  FilterBar,
  PeriodPicker,
  periodText,
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

const KINDS = [
  { key: 'RAW_MATERIAL', label: 'Raw material (kg)' },
  { key: 'FINISHED_GOOD', label: 'Finished parts (pcs)' },
] as const;
type Kind = (typeof KINDS)[number]['key'];

export default function StockReportPage() {
  return (
    <RequirePermission permission="reports.view">
      <StockReport />
    </RequirePermission>
  );
}

function StockReport() {
  const params = useListParams({ filters: { kind: 'RAW_MATERIAL' } });
  const kind = params.filters.kind as Kind;
  const rm = kind === 'RAW_MATERIAL';
  const { from, to, preset } = usePeriod(params);
  const store: StockLocation = rm ? 'RM_STORE' : 'FG_STORE';
  const location = params.filters.location ?? store;
  const byHeat = params.filters.byHeat === 'true';
  const lookups = useLookups('materialGrades', 'products');
  const query = {
    from,
    to,
    kind,
    location: location === 'ALL' ? undefined : location,
    gradeId: rm ? params.filters.gradeId : undefined,
    productId: rm ? undefined : params.filters.productId,
    byHeat: byHeat ? 'true' : undefined,
  };
  const { data, isFetching } = useApiQuery<StockMovementReport>('/reports/stock-movement', query);
  const unit = rm ? 'kg' : 'pcs';
  const q = (v: number) => `${fmtQty(v)} ${unit}`;
  const gradeName = lookups.data?.materialGrades.find(
    (g) => String(g.value) === params.filters.gradeId,
  )?.label;
  const productName = lookups.data?.products.find(
    (g) => String(g.value) === params.filters.productId,
  )?.label;
  const placeName =
    location === 'ALL' ? 'All locations' : STOCK_LOCATION_LABELS[location as StockLocation];

  // charts work per material / part (heats added up)
  const perItem = new Map<number, { name: string; closing: number; in: number; out: number }>();
  for (const r of data?.rows ?? []) {
    const x = perItem.get(r.id) ?? { name: r.name, closing: 0, in: 0, out: 0 };
    x.closing += r.closing;
    x.in += r.in;
    x.out += r.out;
    perItem.set(r.id, x);
  }
  const items = [...perItem.entries()].map(([id, x]) => ({ id, ...x }));
  const biggest = items
    .filter((x) => x.closing > 0)
    .sort((a, b) => b.closing - a.closing)
    .slice(0, 8);
  const moved = items
    .filter((x) => x.in + x.out > 0)
    .sort((a, b) => b.in + b.out - (a.in + a.out))
    .slice(0, 8);
  const t = data?.totals;

  return (
    <>
      <PrintHeader
        title={`Stock movement · ${rm ? 'raw material' : 'finished parts'}`}
        lines={[
          periodText(from, to, preset),
          placeName,
          rm
            ? gradeName
              ? `Grade: ${gradeName}`
              : 'All grades'
            : productName
              ? `Product: ${productName}`
              : 'All products',
          byHeat && 'Each heat shown',
          `Quantities in ${unit}`,
        ]}
      />
      <PageHeader
        className="print:hidden"
        title="Stock movement"
        description="Opening stock, what came in, what went out and the closing stock for any period."
        actions={
          <>
            <PrintButton />
            <ExportButton
              path="/reports/stock-movement/export"
              query={query}
              permission="reports.export"
            />
          </>
        }
      />
      <ReportTabs
        tabs={KINDS}
        value={kind}
        onChange={(k) =>
          params.set({ kind: k, location: undefined, gradeId: undefined, productId: undefined })
        }
        label="Stock"
      />
      <FilterBar>
        <PeriodPicker params={params} />
      </FilterBar>
      <FilterBar>
        <FilterSelect
          value={location}
          onChange={(v) => params.set({ location: v ?? 'ALL' })}
          options={[
            { value: 'ALL', label: 'All locations' },
            ...STOCK_LOCATIONS.map((l) => ({ value: l, label: STOCK_LOCATION_LABELS[l] })),
          ]}
          placeholder="Location"
        />
        {rm ? (
          <FilterSelect
            value={params.filters.gradeId}
            onChange={(v) => params.set({ gradeId: v })}
            options={(lookups.data?.materialGrades ?? []).map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            placeholder="All grades"
          />
        ) : (
          <FilterSelect
            value={params.filters.productId}
            onChange={(v) => params.set({ productId: v })}
            options={(lookups.data?.products ?? []).map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            placeholder="All products"
            className="max-w-60"
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={byHeat}
            onCheckedChange={(c) => params.set({ byHeat: c ? 'true' : undefined })}
            aria-label="Show each heat"
          />
          Show each heat
        </label>
      </FilterBar>

      {!data || !t ? (
        <Skeleton className="h-64" />
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70')}>
          <StatRow>
            <StatTile label="Opening stock" value={q(t.opening)} sub={`on ${fmtDate(from)}`} />
            <StatTile
              label="Came in"
              value={`+${q(t.in)}`}
              sub={`${items.filter((x) => x.in > 0).length} ${rm ? 'materials' : 'parts'} received`}
            />
            <StatTile
              label="Went out"
              value={`−${q(t.out)}`}
              sub={`${items.filter((x) => x.out > 0).length} ${rm ? 'materials' : 'parts'} issued / sent`}
            />
            <StatTile
              label="Closing stock"
              value={q(t.closing)}
              sub={
                t.opening > 0
                  ? `${t.closing >= t.opening ? '+' : '−'}${share(Math.abs(t.closing - t.opening), t.opening)} on the opening`
                  : `on ${fmtDate(to)}`
              }
            />
          </StatRow>

          {items.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
              <ChartCard
                title="Biggest stock at the end"
                description={`Closing stock · ${placeName}.`}
              >
                {biggest.length ? (
                  <BarList
                    label="Closing stock"
                    format={q}
                    rows={biggest.map((x) => ({
                      key: String(x.id),
                      label: x.name,
                      value: x.closing,
                      hint: share(x.closing, t.closing),
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nothing in stock at the end of the period.
                  </p>
                )}
              </ChartCard>
              <ChartCard
                title="Most moved"
                description="In / out in the period; the bar is the total moved."
              >
                {moved.length ? (
                  <BarList
                    label="Most moved"
                    format={q}
                    rows={moved.map((x) => ({
                      key: String(x.id),
                      label: x.name,
                      value: x.in + x.out,
                      valueText: `+${fmtQty(x.in)} / −${fmtQty(x.out)} ${unit}`,
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No movement in this period.</p>
                )}
              </ChartCard>
            </div>
          )}

          <ReportTable title={`Stock movement (${unit})`}>
            <thead className={theadClass}>
              <tr>
                <th className={th}>{rm ? 'Raw material' : 'Part'}</th>
                {byHeat && <th className={th}>Heat</th>}
                <th className={thNum}>Opening</th>
                <th className={thNum}>In</th>
                <th className={thNum}>Out</th>
                <th className={thNum}>Closing</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <EmptyRow cols={6}>No stock and no movement in this period.</EmptyRow>
              )}
              {data.rows.map((r) => (
                <tr key={`${r.id}-${r.heat?.id ?? 0}`} className="border-b last:border-0">
                  <td className={td}>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                  </td>
                  {byHeat && (
                    <td className={td}>
                      <span className="font-mono text-[13px] font-semibold">
                        {r.heat?.heatNo ?? '—'}
                      </span>
                      {r.heat?.millHeatNo && (
                        <div className="text-xs text-muted-foreground">
                          mill {r.heat.millHeatNo}
                        </div>
                      )}
                    </td>
                  )}
                  <td className={tdNum}>{fmtQty(r.opening)}</td>
                  <td className={cn(tdNum, r.in > 0 && 'text-success')}>
                    {r.in ? `+${fmtQty(r.in)}` : '—'}
                  </td>
                  <td className={tdNum}>{r.out ? `−${fmtQty(r.out)}` : '—'}</td>
                  <td className={cn(tdNum, 'font-semibold', r.closing < 0 && 'text-destructive')}>
                    {fmtQty(r.closing)}
                  </td>
                </tr>
              ))}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className={totalRow}>
                  <td className={td} colSpan={byHeat ? 2 : 1}>
                    Total ({unit})
                  </td>
                  <td className={tdNum}>{fmtQty(t.opening)}</td>
                  <td className={tdNum}>+{fmtQty(t.in)}</td>
                  <td className={tdNum}>−{fmtQty(t.out)}</td>
                  <td className={tdNum}>{fmtQty(t.closing)}</td>
                </tr>
              </tfoot>
            )}
          </ReportTable>
          <p className="text-xs text-muted-foreground">
            {location === 'ALL'
              ? 'All locations together: moves between locations (e.g. store → job work) count as both in and out.'
              : `Only the ${placeName}.`}{' '}
            Dates are movement dates.
          </p>
        </div>
      )}
    </>
  );
}
