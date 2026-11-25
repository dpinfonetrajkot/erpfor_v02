'use client';

import { useMemo, useState } from 'react';
import type { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { SUPPLIER_TYPE_LABELS, SUPPLIER_TYPES, supplierSchema, type SupplierInput } from '@bht/shared';
import { usePaged, useDelete, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fromEntity, useZodForm } from '@/lib/forms';
import type { Supplier } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { FormGrid, FormSection, FormSheet, SelectField, TextField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { ImportButton } from '@/components/app/import-button';
import { PartyFields } from '@/components/app/party-fields';
import { ACTIVE_FILTER_OPTIONS, ActiveBadge, RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const TYPE_OPTIONS = SUPPLIER_TYPES.map((t) => ({ value: t, label: SUPPLIER_TYPE_LABELS[t] }));
const TYPE_BADGE = { MATERIAL: 'info', JOB_WORK: 'default', SERVICE: 'secondary', OTHER: 'muted' } as const;

export default function SuppliersPage() {
  return (
    <RequirePermission permission="suppliers.view">
      <Suppliers />
    </RequirePermission>
  );
}

function Suppliers() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<Supplier>('/suppliers', params.query);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const del = useDelete('/suppliers', 'Supplier', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code', className: 'w-28' }, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
      {
        header: 'Supplier / vendor',
        accessorKey: 'name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div className="min-w-48">
            <div className="font-medium">{row.original.name}</div>
            {row.original.contactPerson && <div className="text-xs text-muted-foreground">{row.original.contactPerson}</div>}
          </div>
        ),
      },
      {
        header: 'Type',
        accessorKey: 'type',
        meta: { sortKey: 'type' },
        cell: ({ getValue }) => {
          const t = getValue<Supplier['type']>();
          return <Badge variant={TYPE_BADGE[t]}>{SUPPLIER_TYPE_LABELS[t]}</Badge>;
        },
      },
      {
        header: 'Contact',
        id: 'contact',
        cell: ({ row }) => (
          <div className="text-[13px]">
            <div>{row.original.phone ?? '—'}</div>
            <div className="text-xs text-muted-foreground">{row.original.email}</div>
          </div>
        ),
      },
      { header: 'GSTIN', accessorKey: 'gstin', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>() ?? '—'}</span> },
      { header: 'City', accessorKey: 'city', meta: { sortKey: 'city' }, cell: ({ getValue }) => getValue<string>() ?? '—' },
      { header: 'Status', accessorKey: 'isActive', cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} /> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('suppliers.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('suppliers.delete') ? () => setDeleting(row.original) : undefined}
          />
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader
        title="Suppliers & vendors"
        description="Raw material suppliers, job-work vendors and service providers."
        actions={
          <>
            <ImportButton type="suppliers" />
            {can('suppliers.create') && (
              <Button onClick={() => setEditing('new')}>
                <Plus /> New supplier
              </Button>
            )}
          </>
        }
      />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search name, code, GSTIN, phone…"
        toolbar={
          <>
            <FilterSelect value={params.filters.type} onChange={(v) => params.set({ type: v })} options={TYPE_OPTIONS} placeholder="All types" />
            <FilterSelect value={params.filters.active} onChange={(v) => params.set({ active: v })} options={ACTIVE_FILTER_OPTIONS} placeholder="All statuses" />
          </>
        }
        onRowClick={can('suppliers.update') ? (s) => setEditing(s) : undefined}
        empty={{
          title: 'No suppliers yet',
          description: 'Add suppliers before making purchase orders or job-work orders.',
          action: can('suppliers.create') && <Button onClick={() => setEditing('new')}><Plus /> New supplier</Button>,
        }}
      />
      {editing && <SupplierSheet supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete supplier?"
        description={<>“{deleting?.name}” will be deleted. Suppliers used on POs or heats cannot be deleted — mark them inactive instead.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

const defaults: z.input<typeof supplierSchema> = {
  code: '',
  name: '',
  type: 'MATERIAL',
  contactPerson: '',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  address: '',
  city: '',
  stateCode: '',
  pincode: '',
  country: 'India',
  paymentTermsDays: '',
  bankName: '',
  bankAccountNo: '',
  bankIfsc: '',
  notes: '',
  isActive: true,
};

function SupplierSheet({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const form = useZodForm(supplierSchema, fromEntity(defaults, supplier));
  const save = useSave<SupplierInput>({ path: '/suppliers', id: supplier?.id, form, label: 'Supplier', onSaved: onClose });

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={supplier ? `Edit ${supplier.name}` : 'New supplier / vendor'}
      description={supplier ? `Code ${supplier.code}` : 'Leave the code empty to number it automatically.'}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <PartyFields
        form={form}
        codeHint="Auto: SUP-0001, SUP-0002…"
        duplicateCheck={{ path: '/suppliers', currentId: supplier?.id, label: 'supplier' }}
        extraTop={<SelectField form={form} name="type" label="Type" options={TYPE_OPTIONS} required />}
        extraBottom={
          <FormSection title="Bank (for payments)">
            <FormGrid>
              <TextField form={form} name="bankName" label="Bank name" />
              <TextField form={form} name="bankIfsc" label="IFSC" inputClassName="uppercase" />
              <TextField form={form} name="bankAccountNo" label="Account number" className="sm:col-span-2" />
            </FormGrid>
          </FormSection>
        }
      />
    </FormSheet>
  );
}
