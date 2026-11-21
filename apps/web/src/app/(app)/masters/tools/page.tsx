'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { z } from 'zod';
import { Plus } from 'lucide-react';
import { humanize, TOOL_STATUSES, TOOL_TYPES, toolSchema, type ToolInput } from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { fmtDate, fmtQty } from '@/lib/format';
import { useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Tool } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { ComboboxField, FormGrid, FormSheet, SelectField, TextField, TextareaField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const STATUS_BADGE = { ACTIVE: 'success', INACTIVE: 'muted', UNDER_MAINTENANCE: 'warning', SCRAPPED: 'destructive' } as const;

export default function ToolsPage() {
  return (
    <RequirePermission permission="tools.view">
      <Tools />
    </RequirePermission>
  );
}

function Tools() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<Tool>('/tools', params.query);
  const [editing, setEditing] = useState<Tool | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Tool | null>(null);
  const del = useDelete('/tools', 'Tool', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Tool>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code', className: 'w-28' }, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
      { header: 'Name', accessorKey: 'name', meta: { sortKey: 'name' }, cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { header: 'Type', accessorKey: 'type', meta: { sortKey: 'type' }, cell: ({ getValue }) => humanize(getValue<string>()) },
      { header: 'Used for', id: 'item', cell: ({ row }) => row.original.item?.name ?? <span className="text-muted-foreground">—</span> },
      { header: 'Location', accessorKey: 'location', cell: ({ getValue }) => getValue<string>() ?? '—' },
      { header: 'Life (shots)', accessorKey: 'lifeShots', meta: { align: 'right' }, cell: ({ getValue }) => fmtQty(getValue<number | null>()) },
      { header: 'Purchased', accessorKey: 'purchaseDate', meta: { sortKey: 'purchaseDate' }, cell: ({ getValue }) => fmtDate(getValue<string | null>()) },
      {
        header: 'Status',
        accessorKey: 'status',
        meta: { sortKey: 'status' },
        cell: ({ getValue }) => <Badge variant={STATUS_BADGE[getValue<Tool['status']>()]}>{humanize(getValue<string>())}</Badge>,
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('tools.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('tools.delete') ? () => setDeleting(row.original) : undefined}
          />
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader
        title="Tools & dies"
        description="Forging dies, fixtures and gauges."
        actions={
          can('tools.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New tool
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
        searchPlaceholder="Search code, name, location…"
        onRowClick={can('tools.update') ? (t) => setEditing(t) : undefined}
        empty={{ title: 'No tools yet' }}
      />
      {editing && <ToolSheet tool={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete tool?"
        description={`“${deleting?.name}” will be deleted.`}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

const defaults: z.input<typeof toolSchema> = {
  code: '',
  name: '',
  type: 'DIE',
  itemId: '',
  location: '',
  purchaseDate: '',
  lifeShots: '',
  status: 'ACTIVE',
  description: '',
};

function ToolSheet({ tool, onClose }: { tool: Tool | null; onClose: () => void }) {
  const lookups = useLookups('items');
  const form = useZodForm(toolSchema, fromEntity(defaults, tool));
  const save = useSave<ToolInput>({ path: '/tools', id: tool?.id, form, label: 'Tool', onSaved: onClose });
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title={tool ? `Edit ${tool.name}` : 'New tool / die'} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormGrid>
        <TextField form={form} name="name" label="Name" required className="sm:col-span-2" />
        <SelectField form={form} name="type" label="Type" options={TOOL_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
        <TextField form={form} name="code" label="Code" placeholder="Auto" hint="Auto: TL-0001…" />
        <TextField form={form} name="location" label="Storage location" />
        <TextField form={form} name="purchaseDate" label="Purchase date" type="date" />
        <TextField form={form} name="lifeShots" label="Expected life (shots)" type="number" min={0} />
        <SelectField form={form} name="status" label="Status" options={TOOL_STATUSES.map((t) => ({ value: t, label: humanize(t) }))} />
      </FormGrid>
      <ComboboxField form={form} name="itemId" label="Used for item" options={lookups.data?.items} />
      <TextareaField form={form} name="description" label="Description" rows={2} />
    </FormSheet>
  );
}
