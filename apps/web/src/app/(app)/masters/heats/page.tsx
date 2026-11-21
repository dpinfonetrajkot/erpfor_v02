'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import type { z } from 'zod';
import { FileSearch, Plus } from 'lucide-react';
import { HEAT_STATUSES, heatSchema, humanize, type HeatInput } from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { fmtDate, fmtQty } from '@/lib/format';
import { useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Heat } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, DropdownMenuItem } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { Attachments } from '@/components/app/attachments';
import { ComboboxField, FormGrid, FormSection, FormSheet, SelectField, TextField, TextareaField } from '@/components/app/form';
import { PageHeader } from '@/components/app/page-header';
import { RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const STATUS_BADGE = { ACTIVE: 'success', BLOCKED: 'destructive', CONSUMED: 'muted' } as const;
const STATUS_OPTIONS = HEAT_STATUSES.map((s) => ({ value: s, label: humanize(s) }));

export default function HeatsPage() {
  return (
    <RequirePermission permission="heats.view">
      <Heats />
    </RequirePermission>
  );
}

function Heats() {
  const { can } = useSession();
  const router = useRouter();
  const params = useListParams();
  const { data, isFetching } = usePaged<Heat>('/heats', params.query);
  const lookups = useLookups('rawMaterials');
  const [editing, setEditing] = useState<Heat | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Heat | null>(null);
  const del = useDelete('/heats', 'Heat', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Heat>[]>(
    () => [
      {
        header: 'Heat no.',
        accessorKey: 'heatNo',
        meta: { sortKey: 'heatNo' },
        cell: ({ getValue }) => <span className="font-mono text-[13px] font-semibold">{getValue<string>()}</span>,
      },
      { header: 'Mill heat no.', accessorKey: 'millHeatNo', meta: { sortKey: 'millHeatNo' }, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>() ?? '—'}</span> },
      {
        header: 'Material',
        id: 'material',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.original.rawMaterial.grade.name} · {row.original.rawMaterial.size}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.rawMaterial.code}</div>
          </div>
        ),
      },
      { header: 'Supplier', id: 'supplier', cell: ({ row }) => row.original.supplier?.name ?? <span className="text-muted-foreground">—</span> },
      { header: 'Received', accessorKey: 'receivedDate', meta: { sortKey: 'receivedDate' }, cell: ({ getValue }) => fmtDate(getValue<string | null>()) },
      {
        header: 'In store',
        accessorKey: 'stockQty',
        meta: { align: 'right' },
        cell: ({ getValue }) => (
          <span className={getValue<number>() > 0 ? 'font-medium' : 'text-muted-foreground'}>
            {fmtQty(getValue<number>())} <span className="text-xs text-muted-foreground">kg</span>
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        meta: { sortKey: 'status' },
        cell: ({ getValue }) => <Badge variant={STATUS_BADGE[getValue<Heat['status']>()]}>{humanize(getValue<string>())}</Badge>,
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('heats.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('heats.delete') ? () => setDeleting(row.original) : undefined}
          >
            {can('traceability.view') && (
              <DropdownMenuItem onSelect={() => router.push(`/reports/traceability/heat/${row.original.id}`)}>
                <FileSearch /> Trace this heat
              </DropdownMenuItem>
            )}
          </RowActions>
        ),
      },
    ],
    [can, router],
  );

  return (
    <>
      <PageHeader
        title="Heat numbers"
        description={`Every lot of raw material gets its own heat number. It follows the material through production to dispatch.`}
        actions={
          can('heats.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New heat
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
        searchPlaceholder="Search heat no., mill heat no., grade…"
        toolbar={
          <>
            <FilterSelect
              value={params.filters.rawMaterialId}
              onChange={(v) => params.set({ rawMaterialId: v })}
              options={(lookups.data?.rawMaterials ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All materials"
              className="max-w-60"
            />
            <FilterSelect value={params.filters.status} onChange={(v) => params.set({ status: v })} options={STATUS_OPTIONS} placeholder="All statuses" />
          </>
        }
        onRowClick={can('heats.update') ? (h) => setEditing(h) : undefined}
        empty={{
          title: 'No heats yet',
          description: 'Heats are created at gate entry (from phase 2). For now, add existing lots with their opening stock here.',
        }}
      />
      {editing && <HeatSheet heat={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete heat?"
        description={<>Heat {deleting?.heatNo} will be deleted. A heat with stock movements cannot be deleted — mark it consumed or blocked instead.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

const defaults: z.input<typeof heatSchema> = {
  heatNo: '',
  millHeatNo: '',
  rawMaterialId: '' as unknown as number,
  supplierId: '',
  receivedDate: '',
  status: 'ACTIVE',
  remarks: '',
  openingQty: '',
};

function HeatSheet({ heat, onClose }: { heat: Heat | null; onClose: () => void }) {
  const { can } = useSession();
  const lookups = useLookups('rawMaterials', 'suppliers');
  const form = useZodForm(heatSchema, fromEntity(defaults, heat));
  const save = useSave<HeatInput>({ path: '/heats', id: heat?.id, form, label: 'Heat', onSaved: onClose });

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={heat ? `Heat ${heat.heatNo}` : 'New heat'}
      description={heat ? `${heat.rawMaterial.grade.name} · ${heat.rawMaterial.size}` : 'Leave the heat number empty to number it automatically (grade letter + month + year + running no.).'}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormSection title="Heat">
        <ComboboxField form={form} name="rawMaterialId" label="Raw material (grade · size)" required options={lookups.data?.rawMaterials} loading={lookups.isLoading} />
        <FormGrid>
          <TextField form={form} name="heatNo" label="Heat no." placeholder="Auto, e.g. A102601" inputClassName="font-mono uppercase" />
          <TextField form={form} name="millHeatNo" label="Mill heat no." placeholder="As on MTC" inputClassName="font-mono" />
          <ComboboxField
            form={form}
            name="supplierId"
            label="Supplier"
            options={lookups.data?.suppliers.filter((s) => s.meta?.type === 'MATERIAL' || s.meta?.type === 'OTHER')}
          />
          <TextField form={form} name="receivedDate" label="Received on" type="date" />
          <SelectField form={form} name="status" label="Status" options={STATUS_OPTIONS} />
          {!heat && (
            <TextField form={form} name="openingQty" label="Opening stock (kg)" type="number" step="0.001" min={0} hint="Quantity already in the store" />
          )}
        </FormGrid>
        <TextareaField form={form} name="remarks" label="Remarks" rows={2} />
      </FormSection>

      {heat ? (
        <FormSection title="Mill test certificate">
          <Attachments entity="heat" entityId={heat.id} category="MTC" canEdit={can('heats.update')} title="MTC & test reports" />
        </FormSection>
      ) : (
        <p className="text-xs text-muted-foreground">After saving, open the heat again to upload its MTC.</p>
      )}
    </FormSheet>
  );
}
