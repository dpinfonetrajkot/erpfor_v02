'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Plus } from 'lucide-react';
import type { z } from 'zod';
import {
  COMPANY_ASSET_STATUS_LABELS,
  COMPANY_ASSET_STATUSES,
  companyAssetSchema,
  inspectionSchema,
  SAFETY_ASSET_STATUS_LABELS,
  SAFETY_ASSET_STATUSES,
  safetyAssetSchema,
  type CompanyAssetInput,
  type InspectionInput,
  type SafetyAssetInput,
} from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { fmtDate, toInputDate } from '@/lib/format';
import { useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { CompanyAsset, SafetyAsset } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, DropdownMenuItem } from '@/components/ui/overlays';
import { Badge, Switch } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { ComboboxField, FormGrid, FormSection, FormSheet, SelectField, TextareaField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { ReportTabs } from '@/components/reports/report-kit';

const TABS = [
  { key: 'company', label: 'Company assets' },
  { key: 'safety', label: 'Safety equipment' },
] as const;
const COMPANY_BADGE = { IN_USE: 'info', IN_STORE: 'muted', UNDER_REPAIR: 'warning', SCRAPPED: 'destructive' } as const;
const SAFETY_BADGE = { OK: 'success', FAULTY: 'destructive', OUT_OF_SERVICE: 'destructive' } as const;
const daysTo = (d: string | null) => (d ? Math.round((new Date(d).getTime() - new Date(toInputDate(new Date())).getTime()) / 86_400_000) : null);

export default function AssetsPage() {
  return (
    <RequirePermission permission="assets.view">
      <Assets />
    </RequirePermission>
  );
}

function Assets() {
  const params = useListParams({ filters: { tab: 'company' } });
  const tab = params.filters.tab as 'company' | 'safety';
  return (
    <>
      <PageHeader title="Assets & safety" description="Company assets and who has them; safety equipment with its inspection dates." />
      <ReportTabs tabs={TABS} value={tab} onChange={(k) => params.set({ tab: k, page: undefined, search: undefined, status: undefined, due: undefined })} label="Assets" />
      {tab === 'company' ? <Company params={params} /> : <Safety params={params} />}
    </>
  );
}

function Company({ params }: { params: ReturnType<typeof useListParams> }) {
  const { can } = useSession();
  const { data, isFetching } = usePaged<CompanyAsset>('/company-assets', { ...params.query, tab: undefined });
  const [editing, setEditing] = useState<CompanyAsset | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CompanyAsset | null>(null);
  const del = useDelete('/company-assets', 'Asset', () => setDeleting(null));
  const columns = useMemo<ColumnDef<CompanyAsset>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code' }, cell: ({ getValue }) => <span className="font-mono text-[13px] font-semibold">{getValue<string>()}</span> },
      {
        header: 'Asset',
        accessorKey: 'name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            {row.original.category && <div className="text-xs text-muted-foreground">{row.original.category}</div>}
          </div>
        ),
      },
      {
        header: 'With',
        id: 'with',
        cell: ({ row }) => (
          <div className="text-[13px]">
            {row.original.employee ? `${row.original.employee.empCode} · ${row.original.employee.name}` : row.original.department || <span className="text-muted-foreground">—</span>}
            {row.original.assignDate && <div className="text-xs text-muted-foreground">since {fmtDate(row.original.assignDate)}</div>}
          </div>
        ),
      },
      { header: 'Warranty till', accessorKey: 'warrantyDate', meta: { sortKey: 'warrantyDate' }, cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue<string | null>())}</span> },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <Badge variant={COMPANY_BADGE[row.original.status]}>{COMPANY_ASSET_STATUS_LABELS[row.original.status]}</Badge> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => <RowActions onEdit={can('assets.update') ? () => setEditing(row.original) : undefined} onDelete={can('assets.delete') ? () => setDeleting(row.original) : undefined} />,
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
        searchPlaceholder="Search code, asset, category, person…"
        toolbar={
          <>
            <FilterSelect value={params.filters.status} onChange={(v) => params.set({ status: v })} options={COMPANY_ASSET_STATUSES.map((s) => ({ value: s, label: COMPANY_ASSET_STATUS_LABELS[s] }))} placeholder="All statuses" />
            {can('assets.create') && (
              <Button className="ml-auto" onClick={() => setEditing('new')}>
                <Plus /> New asset
              </Button>
            )}
          </>
        }
        onRowClick={can('assets.update') ? (a) => setEditing(a) : undefined}
        empty={{ title: 'No company assets', description: 'Laptops, phones, measuring instruments, vehicles … and who has them.' }}
      />
      {editing && <CompanySheet asset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete asset?" description={<>{deleting?.code} {deleting?.name} will be deleted.</>} loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </>
  );
}

const companyDefaults: z.input<typeof companyAssetSchema> = { code: '', name: '', category: '', department: '', employeeId: '', status: 'IN_USE', assignDate: '', returnDate: '', warrantyDate: '', remarks: '' };

function CompanySheet({ asset, onClose }: { asset: CompanyAsset | null; onClose: () => void }) {
  const lookups = useLookups('employees');
  const form = useZodForm(companyAssetSchema, fromEntity(companyDefaults, asset));
  const save = useSave<CompanyAssetInput>({ path: '/company-assets', id: asset?.id, form, label: 'Asset', onSaved: onClose });
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title={asset ? `${asset.code} · ${asset.name}` : 'New asset'} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormSection title="Asset">
        <FormGrid>
          <TextField form={form} name="code" label="Asset code" required inputClassName="font-mono uppercase" placeholder="LAP-01" />
          <TextField form={form} name="name" label="Name" required placeholder="Dell laptop" />
          <TextField form={form} name="category" label="Category" placeholder="IT / Instrument / Vehicle" />
          <SelectField form={form} name="status" label="Status" options={COMPANY_ASSET_STATUSES.map((s) => ({ value: s, label: COMPANY_ASSET_STATUS_LABELS[s] }))} />
          <TextField form={form} name="warrantyDate" label="Warranty till" type="date" />
        </FormGrid>
      </FormSection>
      <FormSection title="Given to">
        <FormGrid>
          <ComboboxField form={form} name="employeeId" label="Employee" options={lookups.data?.employees} loading={lookups.isLoading} />
          <TextField form={form} name="department" label="or department" />
          <TextField form={form} name="assignDate" label="Given on" type="date" />
          <TextField form={form} name="returnDate" label="Returned on" type="date" />
        </FormGrid>
        <TextareaField form={form} name="remarks" label="Remarks" rows={2} />
      </FormSection>
    </FormSheet>
  );
}

function Safety({ params }: { params: ReturnType<typeof useListParams> }) {
  const { can } = useSession();
  const { data, isFetching } = usePaged<SafetyAsset>('/safety-assets', { ...params.query, tab: undefined });
  const [editing, setEditing] = useState<SafetyAsset | 'new' | null>(null);
  const [inspecting, setInspecting] = useState<SafetyAsset | null>(null);
  const [deleting, setDeleting] = useState<SafetyAsset | null>(null);
  const del = useDelete('/safety-assets', 'Safety item', () => setDeleting(null));
  const columns = useMemo<ColumnDef<SafetyAsset>[]>(
    () => [
      { header: 'Code', accessorKey: 'code', meta: { sortKey: 'code' }, cell: ({ getValue }) => <span className="font-mono text-[13px] font-semibold">{getValue<string>()}</span> },
      {
        header: 'Item',
        accessorKey: 'name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{[row.original.typeCapacity, row.original.locationZone].filter(Boolean).join(' · ') || '—'}</div>
          </div>
        ),
      },
      { header: 'Last inspection', accessorKey: 'lastInspectionDate', meta: { sortKey: 'lastInspectionDate' }, cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue<string | null>())}</span> },
      {
        header: 'Next due',
        accessorKey: 'nextDueDate',
        meta: { sortKey: 'nextDueDate' },
        cell: ({ row }) => {
          const d = daysTo(row.original.nextDueDate);
          return (
            <div className={cn('whitespace-nowrap', d != null && d < 0 && 'font-medium text-destructive', d != null && d >= 0 && d <= 15 && 'font-medium text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning')}>
              {fmtDate(row.original.nextDueDate)}
              {d != null && <div className="text-xs">{d < 0 ? `${-d} days late` : d === 0 ? 'today' : `in ${d} days`}</div>}
            </div>
          );
        },
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <Badge variant={SAFETY_BADGE[row.original.status]}>{SAFETY_ASSET_STATUS_LABELS[row.original.status]}</Badge> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions onEdit={can('assets.update') ? () => setEditing(row.original) : undefined} onDelete={can('assets.delete') ? () => setDeleting(row.original) : undefined}>
            {can('assets.update') && (
              <DropdownMenuItem onSelect={() => setInspecting(row.original)}>
                <ClipboardCheck /> Record inspection
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
        searchPlaceholder="Search code, item, location, agency…"
        toolbar={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={params.filters.due === 'true'} onCheckedChange={(c) => params.set({ due: c ? 'true' : undefined })} aria-label="Due or not OK only" />
              Due in 15 days or not OK
            </label>
            {can('assets.create') && (
              <Button className="ml-auto" onClick={() => setEditing('new')}>
                <Plus /> New safety item
              </Button>
            )}
          </>
        }
        onRowClick={can('assets.update') ? (a) => setInspecting(a) : undefined}
        empty={{ title: 'No safety equipment', description: 'Fire extinguishers, hydrants, first-aid boxes, cranes and slings … with their inspection dates.' }}
      />
      {editing && <SafetySheet asset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {inspecting && <InspectionDialog asset={inspecting} onClose={() => setInspecting(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete safety item?" description={<>{deleting?.code} {deleting?.name} will be deleted.</>} loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </>
  );
}

const safetyDefaults: z.input<typeof safetyAssetSchema> = {
  code: '',
  name: '',
  locationZone: '',
  typeCapacity: '',
  installationDate: '',
  lastInspectionDate: '',
  nextDueDate: '',
  lastServiceDate: '',
  inspectionIntervalDays: '' as unknown as number,
  vendorAgency: '',
  status: 'OK',
  remarks: '',
};

function SafetySheet({ asset, onClose }: { asset: SafetyAsset | null; onClose: () => void }) {
  const form = useZodForm(safetyAssetSchema, fromEntity(safetyDefaults, asset));
  const save = useSave<SafetyAssetInput>({ path: '/safety-assets', id: asset?.id, form, label: 'Safety item', onSaved: onClose });
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title={asset ? `${asset.code} · ${asset.name}` : 'New safety item'} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormSection title="Item">
        <FormGrid>
          <TextField form={form} name="code" label="Code" required inputClassName="font-mono uppercase" placeholder="FE-01" />
          <TextField form={form} name="name" label="Name" required placeholder="Fire extinguisher" />
          <TextField form={form} name="typeCapacity" label="Type / capacity" placeholder="ABC 6 kg" />
          <TextField form={form} name="locationZone" label="Location" placeholder="Forging shop" />
          <SelectField form={form} name="status" label="Status" options={SAFETY_ASSET_STATUSES.map((s) => ({ value: s, label: SAFETY_ASSET_STATUS_LABELS[s] }))} />
          <TextField form={form} name="vendorAgency" label="Service agency" />
        </FormGrid>
      </FormSection>
      <FormSection title="Dates">
        <FormGrid>
          <TextField form={form} name="installationDate" label="Installed on" type="date" />
          <TextField form={form} name="lastServiceDate" label="Last refill / service" type="date" />
          <TextField form={form} name="lastInspectionDate" label="Last inspection" type="date" />
          <TextField form={form} name="nextDueDate" label="Next inspection due" type="date" />
          <TextField form={form} name="inspectionIntervalDays" label="Inspect every (days)" type="number" min={1} hint="Sets the next due date when an inspection is recorded" />
        </FormGrid>
        <TextareaField form={form} name="remarks" label="Remarks" rows={2} />
      </FormSection>
    </FormSheet>
  );
}

function InspectionDialog({ asset, onClose }: { asset: SafetyAsset; onClose: () => void }) {
  const form = useZodForm(inspectionSchema, { date: toInputDate(new Date()), nextDueDate: '', status: 'OK', remarks: '' });
  const save = useSave<InspectionInput>({ path: `/safety-assets/${asset.id}/inspection`, form, label: 'Inspection', successMessage: `Inspection of ${asset.code} recorded`, onSaved: onClose });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Inspection: ${asset.code} ${asset.name}`}
      description={asset.inspectionIntervalDays ? `Next due is set ${asset.inspectionIntervalDays} days later unless you give a date.` : 'Give the next due date.'}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormGrid>
        <TextField form={form} name="date" label="Inspected on" type="date" required />
        <SelectField form={form} name="status" label="Result" options={SAFETY_ASSET_STATUSES.map((s) => ({ value: s, label: SAFETY_ASSET_STATUS_LABELS[s] }))} />
        <TextField form={form} name="nextDueDate" label="Next due" type="date" />
      </FormGrid>
      <TextareaField form={form} name="remarks" label="Remarks" rows={2} />
    </FormDialog>
  );
}
