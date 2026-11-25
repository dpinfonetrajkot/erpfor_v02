'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { ArrowDownLeft, ArrowUpRight, Download, SlidersHorizontal } from 'lucide-react';
import {
  humanize,
  STOCK_LOCATION_LABELS,
  STOCK_LOCATIONS,
  STOCK_REF_TYPE_LABELS,
  STOCK_REF_TYPES,
  stockAdjustmentSchema,
  type Paginated,
  type StockAdjustmentInput,
  type StockLocation,
  type StockRefType,
} from '@bht/shared';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtQty } from '@/lib/format';
import { useApiQuery, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Heat, LedgerRow, StockBalanceRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { ComboboxField, FormGrid, SelectField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ImportButton } from '@/components/app/import-button';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const LOCATION_OPTIONS = STOCK_LOCATIONS.map((l) => ({ value: l, label: STOCK_LOCATION_LABELS[l] }));
const refLabel = (r: string) => STOCK_REF_TYPE_LABELS[r as StockRefType] ?? humanize(r);

export default function StockPage() {
  return (
    <RequirePermission permission="stock.view">
      <Stock />
    </RequirePermission>
  );
}

function Stock() {
  const { can } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = sp.get('tab') ?? 'rm';
  const [adjusting, setAdjusting] = useState(false);

  return (
    <>
      <PageHeader
        title="Stock & ledger"
        description="What is in the store, by heat number, and every movement in and out."
        actions={
          <>
            <ImportButton type={['rm_stock', 'fg_stock']} label="Opening stock from Excel" />
            {can('stock.create') && (
              <Button variant="outline" onClick={() => setAdjusting(true)}>
                <SlidersHorizontal /> Adjust stock
              </Button>
            )}
          </>
        }
      />
      {/* Each tab keeps its own filters in the URL; switching tab starts clean. */}
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="mb-4">
          <TabsTrigger value="rm">Raw material</TabsTrigger>
          <TabsTrigger value="fg">Finished goods</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>
        <TabsContent value="rm">{tab === 'rm' && <RawMaterialStock />}</TabsContent>
        <TabsContent value="fg">{tab === 'fg' && <FinishedStock />}</TabsContent>
        <TabsContent value="ledger">{tab === 'ledger' && <Ledger />}</TabsContent>
      </Tabs>
      {adjusting && <AdjustDialog onClose={() => setAdjusting(false)} />}
    </>
  );
}

function RawMaterialStock() {
  const params = useListParams({ pageSize: 50 });
  const lookups = useLookups('materialGrades', 'rawMaterials');
  const { data, isFetching } = usePaged<StockBalanceRow>('/stock/raw-materials', params.query);
  const total = (data as (Paginated<StockBalanceRow> & { totalQuantity?: number }) | undefined)?.totalQuantity;

  const columns = useMemo<ColumnDef<StockBalanceRow>[]>(
    () => [
      {
        header: 'Material',
        id: 'material',
        meta: { sortKey: 'rawMaterial.code' },
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.original.rawMaterial?.grade.name} · {row.original.rawMaterial?.size}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.rawMaterial?.code}</div>
          </div>
        ),
      },
      {
        header: 'Heat no.',
        id: 'heat',
        meta: { sortKey: 'heat.heatNo' },
        cell: ({ row }) =>
          row.original.heat ? (
            <div>
              <Link href={`/masters/heats?search=${encodeURIComponent(row.original.heat.heatNo)}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-primary hover:underline">
                {row.original.heat.heatNo}
              </Link>
              <div className="font-mono text-xs text-muted-foreground">Mill {row.original.heat.millHeatNo ?? '—'}</div>
            </div>
          ) : (
            <span className="text-muted-foreground">No heat</span>
          ),
      },
      { header: 'Supplier', id: 'supplier', cell: ({ row }) => row.original.heat?.supplier?.name ?? <span className="text-muted-foreground">—</span> },
      { header: 'Received', id: 'received', meta: { sortKey: 'heat.receivedDate' }, cell: ({ row }) => fmtDate(row.original.heat?.receivedDate) },
      { header: 'Location', accessorKey: 'location', cell: ({ getValue }) => <Badge variant="outline">{STOCK_LOCATION_LABELS[getValue<StockLocation>()]}</Badge> },
      {
        header: 'Quantity',
        accessorKey: 'quantity',
        meta: { sortKey: 'quantity', align: 'right' },
        cell: ({ row }) => (
          <span className="font-semibold">
            {fmtQty(row.original.quantity)} <span className="text-xs font-normal text-muted-foreground">{row.original.rawMaterial?.uom.toLowerCase()}</span>
          </span>
        ),
      },
      {
        id: 'ledger',
        header: '',
        cell: ({ row }) =>
          row.original.heat ? (
            <Link
              href={`/store/stock?tab=ledger&heatId=${row.original.heat.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium text-primary hover:underline"
            >
              Movements
            </Link>
          ) : null,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={data?.data}
      total={data?.total}
      loading={isFetching}
      params={params}
      searchPlaceholder="Search heat no., mill heat, size…"
      toolbar={
        <>
          <FilterSelect value={params.filters.gradeId} onChange={(v) => params.set({ gradeId: v })} options={(lookups.data?.materialGrades ?? []).map((o) => ({ value: o.value, label: o.label }))} placeholder="All grades" />
          <FilterSelect value={params.filters.location} onChange={(v) => params.set({ location: v })} options={LOCATION_OPTIONS} placeholder="All locations" />
          {total !== undefined && (
            <span className="tabular rounded-md bg-muted px-3 py-1.5 text-[13px]">
              Total <span className="font-semibold">{fmtQty(total)} kg</span>
            </span>
          )}
        </>
      }
      empty={{ title: 'No raw material in stock', description: 'Stock comes in through gate entry + QC, or as opening stock on a heat.' }}
    />
  );
}

function FinishedStock() {
  const params = useListParams({ pageSize: 50 });
  const lookups = useLookups('products');
  const { data, isFetching } = usePaged<StockBalanceRow>('/stock/finished-goods', params.query);
  const total = (data as (Paginated<StockBalanceRow> & { totalQuantity?: number }) | undefined)?.totalQuantity;

  const columns = useMemo<ColumnDef<StockBalanceRow>[]>(
    () => [
      {
        header: 'Item',
        id: 'item',
        meta: { sortKey: 'item.name' },
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.item?.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.item?.code}</div>
          </div>
        ),
      },
      { header: 'Heat', id: 'heat', cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.heat?.heatNo ?? '—'}</span> },
      { header: 'Location', accessorKey: 'location', cell: ({ getValue }) => <Badge variant="outline">{STOCK_LOCATION_LABELS[getValue<StockLocation>()]}</Badge> },
      {
        header: 'Quantity',
        accessorKey: 'quantity',
        meta: { sortKey: 'quantity', align: 'right' },
        cell: ({ row }) => (
          <span className="font-semibold">
            {fmtQty(row.original.quantity)} <span className="text-xs font-normal text-muted-foreground">{row.original.item?.uom.toLowerCase()}</span>
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={data?.data}
      total={data?.total}
      loading={isFetching}
      params={params}
      searchPlaceholder="Search item, code, heat…"
      toolbar={
        <>
          <FilterSelect value={params.filters.productId} onChange={(v) => params.set({ productId: v })} options={(lookups.data?.products ?? []).map((o) => ({ value: o.value, label: o.label }))} placeholder="All products" className="max-w-60" />
          {total !== undefined && (
            <span className="tabular rounded-md bg-muted px-3 py-1.5 text-[13px]">
              Total <span className="font-semibold">{fmtQty(total)} pcs</span>
            </span>
          )}
        </>
      }
      empty={{ title: 'No finished goods in stock' }}
    />
  );
}

function Ledger() {
  const { can } = useSession();
  const params = useListParams({ pageSize: 50 });
  const { data, isFetching } = usePaged<LedgerRow>('/stock/ledger', params.query);
  const exportQuery = new URLSearchParams(
    Object.entries(params.filters).filter(([k, v]) => k !== 'tab' && v) as [string, string][],
  );
  if (params.search) exportQuery.set('search', params.search);

  const columns = useMemo<ColumnDef<LedgerRow>[]>(
    () => [
      { header: 'Date', accessorKey: 'date', cell: ({ getValue }) => <span className="tabular whitespace-nowrap">{fmtDate(getValue<string>())}</span> },
      {
        header: 'Movement',
        id: 'ref',
        cell: ({ row }) => (
          <div>
            <Badge variant={row.original.refType === 'ADJUSTMENT' ? 'warning' : 'secondary'}>{refLabel(row.original.refType)}</Badge>
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">{row.original.refNo}</div>
          </div>
        ),
      },
      {
        header: 'Material / item',
        id: 'subject',
        cell: ({ row }) =>
          row.original.rawMaterial ? (
            <div>
              <div className="font-medium">
                {row.original.rawMaterial.grade.name} · {row.original.rawMaterial.size}
              </div>
              <div className="font-mono text-xs text-muted-foreground">{row.original.rawMaterial.code}</div>
            </div>
          ) : (
            <div>
              <div className="font-medium">{row.original.item?.name}</div>
              <div className="font-mono text-xs text-muted-foreground">{row.original.item?.code}</div>
            </div>
          ),
      },
      { header: 'Heat', id: 'heat', cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.heat?.heatNo ?? '—'}</span> },
      { header: 'Location', accessorKey: 'location', cell: ({ getValue }) => STOCK_LOCATION_LABELS[getValue<StockLocation>()] },
      {
        header: 'In',
        accessorKey: 'qtyIn',
        meta: { align: 'right' },
        cell: ({ getValue }) =>
          getValue<number>() ? (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <ArrowDownLeft className="size-3.5" aria-hidden /> {fmtQty(getValue<number>())}
            </span>
          ) : null,
      },
      {
        header: 'Out',
        accessorKey: 'qtyOut',
        meta: { align: 'right' },
        cell: ({ getValue }) =>
          getValue<number>() ? (
            <span className="inline-flex items-center gap-1 font-medium text-destructive">
              <ArrowUpRight className="size-3.5" aria-hidden /> {fmtQty(getValue<number>())}
            </span>
          ) : null,
      },
      { header: 'Remarks', accessorKey: 'remarks', cell: ({ getValue }) => <span className="line-clamp-2 text-[13px] text-muted-foreground">{getValue<string>() ?? ''}</span> },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={data?.data}
      total={data?.total}
      loading={isFetching}
      params={params}
      searchPlaceholder="Search ref no., heat, remarks…"
      toolbar={
        <>
          <FilterSelect value={params.filters.kind} onChange={(v) => params.set({ kind: v })} options={[{ value: 'RAW_MATERIAL', label: 'Raw material' }, { value: 'FINISHED_GOOD', label: 'Finished goods' }]} placeholder="RM + FG" />
          <FilterSelect value={params.filters.refType} onChange={(v) => params.set({ refType: v })} options={STOCK_REF_TYPES.map((r) => ({ value: r, label: refLabel(r) }))} placeholder="All movements" />
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            From
            <Input type="date" value={params.filters.from ?? ''} onChange={(e) => params.set({ from: e.target.value || undefined })} className="h-9 w-[150px]" />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            To
            <Input type="date" value={params.filters.to ?? ''} onChange={(e) => params.set({ to: e.target.value || undefined })} className="h-9 w-[150px]" />
          </label>
          {params.filters.heatId && (
            <Button variant="ghost" size="sm" onClick={() => params.set({ heatId: undefined })}>
              Showing one heat · show all
            </Button>
          )}
          {can('stock.export') && (
            <Button variant="outline" asChild>
              <a href={`/api/stock/ledger/export?${exportQuery.toString()}`}>
                <Download /> Excel (CSV)
              </a>
            </Button>
          )}
        </>
      }
      empty={{ title: 'No stock movements yet' }}
    />
  );
}

function AdjustDialog({ onClose }: { onClose: () => void }) {
  const lookups = useLookups('rawMaterials', 'items');
  const defaults: z.input<typeof stockAdjustmentSchema> = {
    kind: 'RAW_MATERIAL',
    rawMaterialId: '',
    itemId: '',
    heatId: '',
    location: 'RM_STORE',
    quantity: '',
    reason: '',
  };
  const form = useZodForm(stockAdjustmentSchema, defaults);
  const kind = useWatch({ control: form.control, name: 'kind' });
  const rawMaterialId = Number(useWatch({ control: form.control, name: 'rawMaterialId' })) || 0;
  const heats = useApiQuery<Paginated<Heat>>('/heats', { rawMaterialId, pageSize: 500, sortBy: 'heatNo', sortDir: 'desc' }, kind === 'RAW_MATERIAL' && rawMaterialId > 0);
  const save = useSave<StockAdjustmentInput>({ path: '/stock/adjustments', form, label: 'Stock', successMessage: 'Stock adjusted', onSaved: onClose });

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Adjust stock"
      description="For count differences, damage or a wrong entry. The reason is kept in the ledger and audit log."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel="Save adjustment"
    >
      <FormGrid>
        <SelectField
          form={form}
          name="kind"
          label="Stock"
          options={[
            { value: 'RAW_MATERIAL', label: 'Raw material' },
            { value: 'FINISHED_GOOD', label: 'Finished goods' },
          ]}
        />
        <SelectField form={form} name="location" label="Location" options={LOCATION_OPTIONS} />
      </FormGrid>
      {kind === 'RAW_MATERIAL' ? (
        <>
          <ComboboxField form={form} name="rawMaterialId" label="Raw material" required options={lookups.data?.rawMaterials} />
          <SelectField
            form={form}
            name="heatId"
            label="Heat"
            required
            numeric
            placeholder={rawMaterialId ? 'Choose heat' : 'Choose the material first'}
            options={(heats.data?.data ?? []).map((h) => ({ value: h.id, label: `${h.heatNo}${h.millHeatNo ? ` (mill ${h.millHeatNo})` : ''} - ${fmtQty(h.stockQty)} kg` }))}
          />
        </>
      ) : (
        <ComboboxField form={form} name="itemId" label="Item" required options={lookups.data?.items} />
      )}
      <TextField form={form} name="quantity" label="Change" type="number" step="0.001" required hint="Positive adds stock, negative (e.g. -25) removes it" />
      <TextField form={form} name="reason" label="Reason" required placeholder="Physical count on 22-10-2026" />
    </FormDialog>
  );
}
