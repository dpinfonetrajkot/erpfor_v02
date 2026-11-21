'use client';

import { useMemo, useState } from 'react';
import type { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { CURRENCIES, customerSchema, type CustomerInput } from '@bht/shared';
import { usePaged, useDelete, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import { fromEntity, useZodForm } from '@/lib/forms';
import type { Customer } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { FormSection, FormSheet, SelectField, TextareaField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { PartyFields } from '@/components/app/party-fields';
import { ACTIVE_FILTER_OPTIONS, ActiveBadge, RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

export default function CustomersPage() {
  return (
    <RequirePermission permission="customers.view">
      <Customers />
    </RequirePermission>
  );
}

function Customers() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<Customer>('/customers', params.query);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const del = useDelete('/customers', 'Customer', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Customer>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code', className: 'w-28' }, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
      {
        header: 'Customer',
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
      {
        header: 'City',
        accessorKey: 'city',
        meta: { sortKey: 'city' },
        cell: ({ row }) => [row.original.city, row.original.country !== 'India' ? row.original.country : null].filter(Boolean).join(', ') || '—',
      },
      { header: 'Currency', accessorKey: 'currency' },
      { header: 'Status', accessorKey: 'isActive', cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} /> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('customers.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('customers.delete') ? () => setDeleting(row.original) : undefined}
          />
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Companies that send you purchase orders."
        actions={
          can('customers.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New customer
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
        searchPlaceholder="Search name, code, GSTIN, phone…"
        toolbar={<FilterSelect value={params.filters.active} onChange={(v) => params.set({ active: v })} options={ACTIVE_FILTER_OPTIONS} placeholder="All statuses" />}
        onRowClick={can('customers.update') ? (c) => setEditing(c) : undefined}
        empty={{
          title: 'No customers yet',
          description: 'Add your first customer to start taking sales orders.',
          action: can('customers.create') && <Button onClick={() => setEditing('new')}><Plus /> New customer</Button>,
        }}
      />
      {editing && <CustomerSheet customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete customer?"
        description={<>“{deleting?.name}” will be deleted. Customers that already have orders cannot be deleted — mark them inactive instead.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

const defaults: z.input<typeof customerSchema> = {
  code: '',
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  address: '',
  shippingAddress: '',
  city: '',
  stateCode: '',
  pincode: '',
  country: 'India',
  currency: 'INR',
  paymentTermsDays: '',
  notes: '',
  isActive: true,
};

function CustomerSheet({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const form = useZodForm(customerSchema, fromEntity(defaults, customer));
  const save = useSave<CustomerInput>({ path: '/customers', id: customer?.id, form, label: 'Customer', onSaved: onClose });

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={customer ? `Edit ${customer.name}` : 'New customer'}
      description={customer ? `Code ${customer.code}` : 'Leave the code empty to number it automatically.'}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <PartyFields
        form={form}
        codeHint="Auto: CUS-0001, CUS-0002…"
        extraTop={<SelectField form={form} name="currency" label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
        extraBottom={
          <FormSection title="Shipping">
            <TextareaField form={form} name="shippingAddress" label="Shipping address" hint="Leave empty when it is the same as the address above." rows={2} />
          </FormSection>
        }
      />
    </FormSheet>
  );
}
