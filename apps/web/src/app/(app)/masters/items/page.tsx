'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { z } from 'zod';
import { Plus } from 'lucide-react';
import { END_CONNECTION_LABELS, END_CONNECTIONS, itemSchema, UNITS, type ItemInput } from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { fmtMoney, fmtQty } from '@/lib/format';
import { useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Item } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { ComboboxField, FormGrid, FormSection, FormSheet, SelectField, SwitchField, TextField, TextareaField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { ACTIVE_FILTER_OPTIONS, ActiveBadge, RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

export default function ItemsPage() {
  return (
    <RequirePermission permission="items.view">
      <Items />
    </RequirePermission>
  );
}

function Items() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<Item>('/items', params.query);
  const lookups = useLookups('products', 'partTypes');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const del = useDelete('/items', 'Item', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Item>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code', className: 'w-28' }, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
      {
        header: 'Item',
        accessorKey: 'name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div className="min-w-52">
            <div className="font-medium">{row.original.name}</div>
            {row.original.drawingNo && <div className="text-xs text-muted-foreground">Drg. {row.original.drawingNo}</div>}
          </div>
        ),
      },
      { header: 'Part', id: 'part', cell: ({ row }) => <Badge variant="secondary">{row.original.partType.name}</Badge> },
      {
        header: 'End',
        accessorKey: 'endConnection',
        meta: { sortKey: 'endConnection' },
        cell: ({ getValue }) => (getValue<string>() === 'NONE' ? <span className="text-muted-foreground">—</span> : getValue<string>()),
      },
      {
        header: 'Material',
        id: 'material',
        cell: ({ row }) =>
          row.original.rawMaterial
            ? `${row.original.rawMaterial.grade.name} · ${row.original.rawMaterial.size}`
            : (row.original.materialGrade?.name ?? <span className="text-muted-foreground">—</span>),
      },
      {
        header: 'FG stock',
        accessorKey: 'stockQty',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <span className={row.original.stockQty > 0 ? 'font-medium' : 'text-muted-foreground'}>
            {fmtQty(row.original.stockQty)} <span className="text-xs text-muted-foreground">{row.original.uom.toLowerCase()}</span>
          </span>
        ),
      },
      { header: 'Min. price', accessorKey: 'minPrice', meta: { align: 'right' }, cell: ({ getValue }) => fmtMoney(getValue<number | null>()) },
      { header: 'Status', accessorKey: 'isActive', cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} /> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('items.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('items.delete') ? () => setDeleting(row.original) : undefined}
          />
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader
        title="Items (finished parts)"
        description="Stock items such as 2&quot; FIG 100 MALE BW. Tip: create them in one click with “Generate items” on a product."
        actions={
          can('items.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New item
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search item, code, drawing no…"
        toolbar={
          <>
            <FilterSelect
              value={params.filters.productId}
              onChange={(v) => params.set({ productId: v })}
              options={(lookups.data?.products ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All products"
              className="max-w-56"
            />
            <FilterSelect
              value={params.filters.partTypeId}
              onChange={(v) => params.set({ partTypeId: v })}
              options={(lookups.data?.partTypes ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All parts"
            />
            <FilterSelect value={params.filters.active} onChange={(v) => params.set({ active: v })} options={ACTIVE_FILTER_OPTIONS} placeholder="All statuses" />
          </>
        }
        onRowClick={can('items.update') ? (i) => setEditing(i) : undefined}
        empty={{ title: 'No items yet', description: 'Open Products & BOM and use “Generate items” on a product.' }}
      />
      {editing && <ItemSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete item?"
        description={<>“{deleting?.name}” will be deleted. Items with stock or history cannot be deleted — mark them inactive instead.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

const defaults: z.input<typeof itemSchema> = {
  code: '',
  productId: '' as unknown as number,
  partTypeId: '' as unknown as number,
  endConnection: 'NONE',
  materialGradeId: '',
  rawMaterialId: '',
  drawingNo: '',
  finishedWeightKg: '',
  inputWeightKg: '',
  uom: 'PCS',
  minPrice: '',
  hsnCode: '',
  description: '',
  isActive: true,
};

function ItemSheet({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const lookups = useLookups('products', 'partTypes', 'materialGrades', 'rawMaterials');
  const form = useZodForm(itemSchema, fromEntity(defaults, item));
  const save = useSave<ItemInput>({ path: '/items', id: item?.id, form, label: 'Item', onSaved: onClose });
  const partTypeId = Number(form.watch('partTypeId'));
  const partType = lookups.data?.partTypes.find((p) => p.value === partTypeId);
  const hasEnd = partType ? partType.meta?.hasEndConnection !== false : true;

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? `Edit ${item.name}` : 'New item'}
      description="The item name is built from product + part + end connection."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormSection title="What it is">
        <ComboboxField form={form} name="productId" label="Product" required options={lookups.data?.products} loading={lookups.isLoading} />
        <FormGrid>
          <SelectField
            form={form}
            name="partTypeId"
            label="Part"
            required
            numeric
            placeholder="Select part"
            options={(lookups.data?.partTypes ?? []).map((o) => ({ value: o.value, label: o.label }))}
          />
          {hasEnd ? (
            <SelectField form={form} name="endConnection" label="End connection" options={END_CONNECTIONS.map((e) => ({ value: e, label: END_CONNECTION_LABELS[e] }))} />
          ) : (
            <div className="text-xs text-muted-foreground sm:pt-7">This part has no end connection.</div>
          )}
          <TextField form={form} name="code" label="Item code" placeholder="Auto" hint="Auto: ITEM-0001…" />
          <TextField form={form} name="drawingNo" label="Drawing no." />
        </FormGrid>
      </FormSection>

      <FormSection title="Material & weight">
        <ComboboxField form={form} name="rawMaterialId" label="Default raw material" options={lookups.data?.rawMaterials} hint="Bar normally used to forge this part." />
        <FormGrid>
          <SelectField
            form={form}
            name="materialGradeId"
            label="Material grade"
            numeric
            placeholder="—"
            options={(lookups.data?.materialGrades ?? []).map((o) => ({ value: o.value, label: o.label }))}
          />
          <SelectField form={form} name="uom" label="Unit" options={UNITS.map((u) => ({ value: u, label: u }))} />
          <TextField form={form} name="inputWeightKg" label="Cut (input) weight, kg" type="number" step="0.001" min={0} />
          <TextField form={form} name="finishedWeightKg" label="Finished weight, kg" type="number" step="0.001" min={0} />
        </FormGrid>
      </FormSection>

      <FormSection title="Sales">
        <FormGrid>
          <TextField form={form} name="minPrice" label="Minimum price (₹)" type="number" step="0.01" min={0} />
          <TextField form={form} name="hsnCode" label="HSN code" inputMode="numeric" />
        </FormGrid>
        <TextareaField form={form} name="description" label="Description" rows={2} />
        <SwitchField form={form} name="isActive" label="Active" />
      </FormSection>
    </FormSheet>
  );
}
