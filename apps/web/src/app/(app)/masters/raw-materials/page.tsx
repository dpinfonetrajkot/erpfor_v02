'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { z } from 'zod';
import { AlertTriangle, Plus } from 'lucide-react';
import { humanize, MATERIAL_SHAPES, materialGradeSchema, rawMaterialSchema, UNITS, type MaterialGradeInput, type RawMaterialInput } from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { fmtQty } from '@/lib/format';
import { useApiQuery, useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { MaterialGrade, RawMaterial } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { FormGrid, FormSheet, SelectField, SwitchField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ACTIVE_FILTER_OPTIONS, ActiveBadge, RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

export default function RawMaterialsPage() {
  return (
    <RequirePermission permission="raw_materials.view">
      <PageHeader title="Raw materials" description="Bar stock by grade and size. Stock is shown for the RM store across all heats." />
      <Tabs defaultValue="materials">
        <TabsList className="mb-4">
          <TabsTrigger value="materials">Raw materials</TabsTrigger>
          <TabsTrigger value="grades">Material grades</TabsTrigger>
        </TabsList>
        <TabsContent value="materials">
          <MaterialsTab />
        </TabsContent>
        <TabsContent value="grades">
          <GradesTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  );
}

function MaterialsTab() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<RawMaterial>('/raw-materials', params.query);
  const lookups = useLookups('materialGrades');
  const [editing, setEditing] = useState<RawMaterial | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RawMaterial | null>(null);
  const del = useDelete('/raw-materials', 'Raw material', () => setDeleting(null));

  const columns = useMemo<ColumnDef<RawMaterial>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code', className: 'w-28' }, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
      { header: 'Grade', id: 'grade', cell: ({ row }) => <span className="font-medium">{row.original.grade.name}</span> },
      { header: 'Size', accessorKey: 'size', meta: { sortKey: 'size' } },
      { header: 'Shape', accessorKey: 'shape', meta: { sortKey: 'shape' }, cell: ({ getValue }) => humanize(getValue<string>()) },
      {
        header: 'Heats',
        id: 'heats',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <Link href={`/masters/heats?rawMaterialId=${row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">
            {row.original._count.heats}
          </Link>
        ),
      },
      {
        header: 'Stock',
        accessorKey: 'stockQty',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            {row.original.belowReorder && (
              <Badge variant="warning" title={`Reorder level ${fmtQty(row.original.reorderLevel)}`}>
                <AlertTriangle aria-hidden /> Low
              </Badge>
            )}
            <span className="font-medium">{fmtQty(row.original.stockQty)}</span>
            <span className="text-xs text-muted-foreground">{row.original.uom.toLowerCase()}</span>
          </div>
        ),
      },
      { header: 'Reorder at', accessorKey: 'reorderLevel', meta: { align: 'right' }, cell: ({ getValue }) => fmtQty(getValue<number | null>()) },
      { header: 'Status', accessorKey: 'isActive', cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} /> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('raw_materials.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('raw_materials.delete') ? () => setDeleting(row.original) : undefined}
          />
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
        searchPlaceholder="Search grade, size, code…"
        toolbar={
          <>
            <FilterSelect
              value={params.filters.gradeId}
              onChange={(v) => params.set({ gradeId: v })}
              options={(lookups.data?.materialGrades ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All grades"
            />
            <FilterSelect value={params.filters.active} onChange={(v) => params.set({ active: v })} options={ACTIVE_FILTER_OPTIONS} placeholder="All statuses" />
            {can('raw_materials.create') && (
              <Button onClick={() => setEditing('new')} className="sm:ml-auto">
                <Plus /> New raw material
              </Button>
            )}
          </>
        }
        onRowClick={can('raw_materials.update') ? (r) => setEditing(r) : undefined}
        empty={{ title: 'No raw materials yet', description: 'Add each grade + bar size you buy, e.g. A105 · 60 MM ROUND.' }}
      />
      {editing && <RawMaterialSheet material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete raw material?"
        description={<>“{deleting?.grade.name} · {deleting?.size}” will be deleted. Materials with heats or stock cannot be deleted.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

const materialDefaults: z.input<typeof rawMaterialSchema> = {
  code: '',
  gradeId: '' as unknown as number,
  shape: 'ROUND',
  size: '',
  sizeMm: '',
  densityKgM3: '',
  uom: 'KG',
  reorderLevel: '',
  isActive: true,
};

function RawMaterialSheet({ material, onClose }: { material: RawMaterial | null; onClose: () => void }) {
  const lookups = useLookups('materialGrades');
  const form = useZodForm(rawMaterialSchema, fromEntity(materialDefaults, material));
  const save = useSave<RawMaterialInput>({ path: '/raw-materials', id: material?.id, form, label: 'Raw material', onSaved: onClose });
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={material ? `Edit ${material.grade.name} · ${material.size}` : 'New raw material'}
      description="One record per grade + size. Each delivery of it gets its own heat number."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormGrid>
        <SelectField
          form={form}
          name="gradeId"
          label="Grade"
          required
          numeric
          placeholder="Select grade"
          options={(lookups.data?.materialGrades ?? []).map((o) => ({ value: o.value, label: o.label }))}
        />
        <SelectField form={form} name="shape" label="Shape" options={MATERIAL_SHAPES.map((s) => ({ value: s, label: humanize(s) }))} />
        <TextField form={form} name="size" label="Size (as written on bills)" placeholder="60 MM ROUND" required className="sm:col-span-2" />
        <TextField form={form} name="sizeMm" label="Size in mm" type="number" step="0.01" min={0} hint="Diameter / side, for weight calculation" />
        <TextField form={form} name="densityKgM3" label="Density (kg/m³)" type="number" step="0.01" min={0} placeholder="7850" />
        <SelectField form={form} name="uom" label="Unit" options={UNITS.map((u) => ({ value: u, label: u }))} />
        <TextField form={form} name="reorderLevel" label="Reorder level" type="number" step="0.001" min={0} hint="Dashboard warns below this stock" />
        <TextField form={form} name="code" label="Code" placeholder="Auto" hint="Auto: RM-0001…" />
      </FormGrid>
      <SwitchField form={form} name="isActive" label="Active" />
    </FormSheet>
  );
}

function GradesTab() {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<MaterialGrade[]>('/material-grades');
  const [editing, setEditing] = useState<MaterialGrade | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MaterialGrade | null>(null);
  const del = useDelete('/material-grades', 'Grade', () => setDeleting(null));

  const columns = useMemo<ColumnDef<MaterialGrade>[]>(
    () => [
      { header: 'Grade', accessorKey: 'name', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { header: 'Standard', accessorKey: 'standard', cell: ({ getValue }) => getValue<string>() ?? '—' },
      {
        header: 'Heat letter',
        accessorKey: 'heatCode',
        cell: ({ getValue }) => (getValue<string>() ? <Badge variant="outline" className="font-mono">{getValue<string>()}</Badge> : <span className="text-muted-foreground">—</span>),
      },
      { header: 'Sizes', id: 'count', meta: { align: 'right' }, cell: ({ row }) => row.original._count.rawMaterials },
      { header: 'Status', accessorKey: 'isActive', cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} /> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('raw_materials.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('raw_materials.delete') ? () => setDeleting(row.original) : undefined}
          />
        ),
      },
    ],
    [can],
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        {can('raw_materials.create') && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> New grade
          </Button>
        )}
      </div>
      <DataTable columns={columns} data={data} loading={isLoading} empty={{ title: 'No grades yet' }} />
      {editing && <GradeDialog grade={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete grade?"
        description={`“${deleting?.name}” will be deleted. Grades used by raw materials cannot be deleted.`}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

function GradeDialog({ grade, onClose }: { grade: MaterialGrade | null; onClose: () => void }) {
  const form = useZodForm(materialGradeSchema, fromEntity({ name: '', heatCode: '', standard: '', description: '', isActive: true }, grade));
  const save = useSave<MaterialGradeInput>({ path: '/material-grades', id: grade?.id, form, label: 'Grade', onSaved: onClose });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={grade ? `Edit ${grade.name}` : 'New grade'} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormGrid>
        <TextField form={form} name="name" label="Grade" placeholder="A105" required />
        <TextField form={form} name="heatCode" label="Heat letter" placeholder="A" inputClassName="uppercase" maxLength={5} hint="Starts the heat numbers: A102601" />
      </FormGrid>
      <TextField form={form} name="standard" label="Standard" placeholder="ASTM A105" />
      <TextField form={form} name="description" label="Description" />
      <SwitchField form={form} name="isActive" label="Active" />
    </FormDialog>
  );
}
