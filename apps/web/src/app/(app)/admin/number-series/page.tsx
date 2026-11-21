'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { humanize, RESET_PERIODS, documentSeriesSchema, type DocumentSeriesInput } from '@bht/shared';
import { fromEntity, useZodForm } from '@/lib/forms';
import { useApiQuery, useSave } from '@/hooks/use-api';
import type { DocumentSeriesRow } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { SelectField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const RESET_LABELS: Record<string, string> = {
  NEVER: 'Never (keeps counting)',
  FINANCIAL_YEAR: 'Every financial year (1 April)',
  MONTHLY: 'Every month',
};

export default function NumberSeriesPage() {
  return (
    <RequirePermission permission="settings.view">
      <NumberSeries />
    </RequirePermission>
  );
}

function NumberSeries() {
  const { can } = useSession();
  const { data, isLoading } = useApiQuery<DocumentSeriesRow[]>('/settings/document-series');
  const [editing, setEditing] = useState<DocumentSeriesRow | null>(null);

  const columns = useMemo<ColumnDef<DocumentSeriesRow>[]>(
    () => [
      { header: 'Document', accessorKey: 'name', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { header: 'Format', accessorKey: 'template', cell: ({ getValue }) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{getValue<string>()}</code> },
      { header: 'Restarts', accessorKey: 'resetPeriod', cell: ({ getValue }) => humanize(getValue<string>()) },
      { header: 'Next number', accessorKey: 'nextNumber', cell: ({ getValue }) => <span className="font-mono text-[13px] font-semibold text-primary">{getValue<string>()}</span> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => <RowActions onEdit={can('settings.update') ? () => setEditing(row.original) : undefined} />,
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader title="Number series" description="How document numbers look. Numbers are given automatically and never repeat." />
      <Card className="mb-4">
        <CardContent className="grid gap-x-8 gap-y-1 py-4 text-sm sm:grid-cols-2">
          <div><code className="text-xs">{'{FY}'}</code> <span className="text-muted-foreground">financial year, e.g. 26-27</span></div>
          <div><code className="text-xs">{'{SEQ:4}'}</code> <span className="text-muted-foreground">running number with 4 digits: 0001</span></div>
          <div><code className="text-xs">{'{YYYY} {YY} {MM} {DD}'}</code> <span className="text-muted-foreground">date parts</span></div>
          <div><code className="text-xs">{'{GRADE}'}</code> <span className="text-muted-foreground">heat letter of the grade (heat numbers)</span></div>
          <div><code className="text-xs">{'{CO}'}</code> <span className="text-muted-foreground">company code; each company gets its own running number (invoices)</span></div>
        </CardContent>
      </Card>
      <DataTable columns={columns} data={data} loading={isLoading} onRowClick={can('settings.update') ? setEditing : undefined} />
      {editing && <SeriesDialog series={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SeriesDialog({ series, onClose }: { series: DocumentSeriesRow; onClose: () => void }) {
  const form = useZodForm(documentSeriesSchema, fromEntity({ template: '', resetPeriod: 'FINANCIAL_YEAR' }, series));
  const save = useSave<DocumentSeriesInput>({ path: '/settings/document-series', id: series.code, form, label: series.name, onSaved: onClose });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${series.name} numbers`}
      description={`Next number now: ${series.nextNumber}`}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <TextField form={form} name="template" label="Format" inputClassName="font-mono" required />
      <SelectField form={form} name="resetPeriod" label="Restart numbering" options={RESET_PERIODS.map((r) => ({ value: r, label: RESET_LABELS[r] }))} />
    </FormDialog>
  );
}
