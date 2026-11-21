'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { z } from 'zod';
import { Controller } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Layers, Plus, Sparkles } from 'lucide-react';
import {
  END_CONNECTION_LABELS,
  partTypeSchema,
  productCategorySchema,
  productSchema,
  type EndConnection,
  type PartTypeInput,
  type ProductCategoryInput,
  type ProductInput,
} from '@bht/shared';
import { api } from '@/lib/api';
import { fromEntity, useZodForm } from '@/lib/forms';
import { showApiError, useApiQuery, useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { PartType, Product, ProductCategory } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenuItem } from '@/components/ui/overlays';
import { Badge, Checkbox, Label } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { FormGrid, FormSection, FormSheet, SelectField, SwitchField, TextField, TextareaField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ACTIVE_FILTER_OPTIONS, ActiveBadge, RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

export default function ProductsPage() {
  return (
    <RequirePermission permission="products.view">
      <PageHeader title="Products & BOM" description="Sellable products (e.g. 2&quot; FIG 100), the parts that make one set, and their categories." />
      <Tabs defaultValue="products">
        <TabsList className="mb-4">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="parts">Part types</TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="parts">
          <PartTypesTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  );
}

// ------------------------------------------------------------------- products

function ProductsTab() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<Product>('/products', params.query);
  const lookups = useLookups('productCategories');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [generating, setGenerating] = useState<Product | null>(null);
  const del = useDelete('/products', 'Product', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code', className: 'w-28' }, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
      {
        header: 'Product',
        accessorKey: 'name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div className="min-w-44">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {[row.original.figure, row.original.size && `Size ${row.original.size}`, row.original.pressureRating].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        ),
      },
      { header: 'Category', id: 'category', cell: ({ row }) => row.original.category.name },
      {
        header: 'Parts per set (BOM)',
        id: 'bom',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.components.map((c) => (
              <Badge key={c.partTypeId} variant="secondary">
                {c.partType.name}
                {c.quantity !== 1 && ` ×${c.quantity}`}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        header: 'Items',
        id: 'items',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <Link href={`/masters/items?productId=${row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">
            {row.original._count.items}
          </Link>
        ),
      },
      { header: 'Status', accessorKey: 'isActive', cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} /> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('products.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('products.delete') ? () => setDeleting(row.original) : undefined}
          >
            {can('items.create') && (
              <DropdownMenuItem onSelect={() => setGenerating(row.original)}>
                <Sparkles /> Generate items
              </DropdownMenuItem>
            )}
          </RowActions>
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search product, figure, size…"
        toolbar={
          <>
            <FilterSelect
              value={params.filters.categoryId}
              onChange={(v) => params.set({ categoryId: v })}
              options={(lookups.data?.productCategories ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All categories"
            />
            <FilterSelect value={params.filters.active} onChange={(v) => params.set({ active: v })} options={ACTIVE_FILTER_OPTIONS} placeholder="All statuses" />
            {can('products.create') && (
              <Button onClick={() => setEditing('new')} className="sm:ml-auto">
                <Plus /> New product
              </Button>
            )}
          </>
        }
        onRowClick={can('products.update') ? (p) => setEditing(p) : undefined}
        empty={{ title: 'No products yet', description: 'Add a product, choose its parts, then generate its items.' }}
      />
      {editing && <ProductSheet product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {generating && <GenerateItemsDialog product={generating} onClose={() => setGenerating(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete product?"
        description={<>“{deleting?.name}” will be deleted. A product that already has items cannot be deleted — mark it inactive instead.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

const productDefaults: z.input<typeof productSchema> = {
  code: '',
  name: '',
  categoryId: '' as unknown as number,
  size: '',
  figure: '',
  pressureRating: '',
  hsnCode: '',
  description: '',
  isActive: true,
  components: [],
};

function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const lookups = useLookups('productCategories', 'partTypes');
  const form = useZodForm(productSchema, {
    ...fromEntity(productDefaults, product),
    components: product?.components.map((c) => ({ partTypeId: c.partTypeId, quantity: c.quantity })) ?? [],
  });
  const save = useSave<ProductInput>({ path: '/products', id: product?.id, form, label: 'Product', onSaved: onClose });
  const partTypes = lookups.data?.partTypes ?? [];

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={product ? `Edit ${product.name}` : 'New product'}
      description="A product is what the customer orders. Its parts (BOM) are assembled into one set."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormSection title="Product">
        <FormGrid>
          <TextField form={form} name="name" label="Product name" placeholder='2" FIG 100' required className="sm:col-span-2" />
          <SelectField
            form={form}
            name="categoryId"
            label="Category"
            required
            numeric
            placeholder="Select category"
            options={(lookups.data?.productCategories ?? []).map((o) => ({ value: o.value, label: o.label }))}
          />
          <TextField form={form} name="code" label="Code" placeholder="Auto" hint="Auto: PRD-0001…" />
          <TextField form={form} name="size" label="Size" placeholder='2"' />
          <TextField form={form} name="figure" label="Figure" placeholder="FIG 100" />
          <TextField form={form} name="pressureRating" label="Pressure rating" placeholder="1000 CWP" />
          <TextField form={form} name="hsnCode" label="HSN code" inputMode="numeric" />
        </FormGrid>
        <TextareaField form={form} name="description" label="Description" rows={2} />
      </FormSection>

      <FormSection title="Parts per set (BOM)">
        <Controller
          control={form.control}
          name="components"
          render={({ field, fieldState }) => {
            const value = (field.value ?? []) as { partTypeId: number; quantity: number }[];
            const toggle = (id: number, on: boolean) =>
              field.onChange(on ? [...value, { partTypeId: id, quantity: 1 }] : value.filter((c) => c.partTypeId !== id));
            const setQty = (id: number, qty: number) =>
              field.onChange(value.map((c) => (c.partTypeId === id ? { ...c, quantity: qty } : c)));
            return (
              <div className="space-y-2">
                <div className="divide-y rounded-lg border">
                  {partTypes.map((pt) => {
                    const current = value.find((c) => c.partTypeId === pt.value);
                    return (
                      <div key={pt.value} className="flex items-center gap-3 px-3 py-2.5">
                        <Checkbox id={`pt-${pt.value}`} checked={!!current} onCheckedChange={(c) => toggle(pt.value, c === true)} />
                        <Label htmlFor={`pt-${pt.value}`} className="flex-1 font-normal">
                          {pt.label}
                          {pt.meta?.hasEndConnection ? (
                            <span className="text-xs text-muted-foreground">BW / THD</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">no end connection</span>
                          )}
                        </Label>
                        {current && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Qty</span>
                            <Input
                              type="number"
                              min={1}
                              value={current.quantity}
                              onChange={(e) => setQty(pt.value, Number(e.target.value) || 1)}
                              className="h-8 w-16"
                              aria-label={`${pt.label} quantity per set`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {fieldState.error && <p className="text-xs text-destructive">{fieldState.error.message ?? 'Choose the parts'}</p>}
                <p className="text-xs text-muted-foreground">
                  Missing a part? Add it on the <strong>Part types</strong> tab.
                </p>
              </div>
            );
          }}
        />
      </FormSection>

      <SwitchField form={form} name="isActive" label="Active" hint="Inactive products cannot be chosen on new sales orders." />
    </FormSheet>
  );
}

function GenerateItemsDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [ends, setEnds] = useState<EndConnection[]>(['BW', 'THD']);
  const hasEnds = product.components.some((c) => c.partType.hasEndConnection);
  const generate = useMutation({
    mutationFn: () => api<{ created: string[] }>(`/products/${product.id}/generate-items`, { method: 'POST', body: { endConnections: ends } }),
    onSuccess: (r) => {
      toast.success(r.created.length ? `Created ${r.created.length} item(s)` : 'All items already exist', {
        description: r.created.slice(0, 6).join(', ') + (r.created.length > 6 ? '…' : ''),
      });
      onClose();
    },
    onError: (err) => showApiError(err),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate items for {product.name}</DialogTitle>
          <DialogDescription>
            Creates one stock item per part{hasEnds ? ' and end connection' : ''}. Items that already exist are skipped.
          </DialogDescription>
        </DialogHeader>
        {hasEnds && (
          <div className="space-y-2">
            <Label>End connections to make</Label>
            {(['BW', 'THD'] as const).map((e) => (
              <label key={e} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={ends.includes(e)} onCheckedChange={(c) => setEnds(c === true ? [...ends, e] : ends.filter((x) => x !== e))} />
                {END_CONNECTION_LABELS[e]}
              </label>
            ))}
          </div>
        )}
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Layers className="mr-1 inline size-3.5" />
          Parts: {product.components.map((c) => c.partType.name).join(', ')}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => generate.mutate()} loading={generate.isPending} disabled={hasEnds && ends.length === 0}>
            <Sparkles /> Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------- categories

function CategoriesTab() {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<ProductCategory[]>('/product-categories');
  const [editing, setEditing] = useState<ProductCategory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProductCategory | null>(null);
  const del = useDelete('/product-categories', 'Category', () => setDeleting(null));

  const columns = useMemo<ColumnDef<ProductCategory>[]>(
    () => [
      { header: 'Category', accessorKey: 'name', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { header: 'Description', accessorKey: 'description', cell: ({ getValue }) => getValue<string>() ?? '—' },
      { header: 'Products', id: 'count', meta: { align: 'right' }, cell: ({ row }) => row.original._count.products },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('products.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('products.delete') ? () => setDeleting(row.original) : undefined}
          />
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        {can('products.create') && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> New category
          </Button>
        )}
      </div>
      <DataTable columns={columns} data={data} loading={isLoading} empty={{ title: 'No categories yet' }} />
      {editing && <CategoryDialog category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete category?"
        description={`“${deleting?.name}” will be deleted. Categories that have products cannot be deleted.`}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

function CategoryDialog({ category, onClose }: { category: ProductCategory | null; onClose: () => void }) {
  const form = useZodForm(productCategorySchema, fromEntity({ name: '', description: '' }, category));
  const save = useSave<ProductCategoryInput>({ path: '/product-categories', id: category?.id, form, label: 'Category', onSaved: onClose });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={category ? 'Edit category' : 'New category'} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <TextField form={form} name="name" label="Name" placeholder="HAMMER UNION" required />
      <TextField form={form} name="description" label="Description" />
    </FormDialog>
  );
}

// ----------------------------------------------------------------- part types

function PartTypesTab() {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<PartType[]>('/part-types');
  const [editing, setEditing] = useState<PartType | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PartType | null>(null);
  const del = useDelete('/part-types', 'Part type', () => setDeleting(null));

  const columns = useMemo<ColumnDef<PartType>[]>(
    () => [
      { header: 'Part', accessorKey: 'name', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      {
        header: 'End connection',
        accessorKey: 'hasEndConnection',
        cell: ({ getValue }) => (getValue<boolean>() ? <Badge variant="info">BW / THD</Badge> : <Badge variant="muted">None</Badge>),
      },
      { header: 'Order', accessorKey: 'sortOrder', meta: { align: 'right' } },
      { header: 'Items', id: 'count', meta: { align: 'right' }, cell: ({ row }) => row.original._count.items },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('products.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('products.delete') ? () => setDeleting(row.original) : undefined}
          />
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        {can('products.create') && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> New part type
          </Button>
        )}
      </div>
      <DataTable columns={columns} data={data} loading={isLoading} empty={{ title: 'No part types yet' }} />
      {editing && <PartTypeDialog partType={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete part type?"
        description={`“${deleting?.name}” will be deleted. Part types used by items cannot be deleted.`}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

function PartTypeDialog({ partType, onClose }: { partType: PartType | null; onClose: () => void }) {
  const form = useZodForm(partTypeSchema, fromEntity({ name: '', hasEndConnection: true, sortOrder: 0 }, partType));
  const save = useSave<PartTypeInput>({ path: '/part-types', id: partType?.id, form, label: 'Part type', onSaved: onClose });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={partType ? 'Edit part type' : 'New part type'} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <TextField form={form} name="name" label="Name" placeholder="MALE" required />
      <TextField form={form} name="sortOrder" label="Display order" type="number" />
      <SwitchField form={form} name="hasEndConnection" label="Has end connection (BW / THD)" hint="On for MALE / FEMALE, off for the NUT." />
    </FormDialog>
  );
}

