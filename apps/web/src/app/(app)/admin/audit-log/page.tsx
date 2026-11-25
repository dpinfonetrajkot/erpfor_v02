'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { humanize } from '@bht/shared';
import { fmtDateTime } from '@/lib/format';
import { usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { AuditLogRow } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';

const ACTION_BADGE: Record<string, 'success' | 'info' | 'destructive' | 'warning' | 'muted' | 'secondary'> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'destructive',
  LOGIN: 'muted',
  LOGOUT: 'muted',
  LOGIN_FAILED: 'warning',
  PASSWORD_CHANGE: 'secondary',
  STATUS_CHANGE: 'secondary',
};

const ENTITIES = ['user', 'role', 'company', 'customer', 'supplier', 'product', 'item', 'raw_material', 'material_grade', 'heat', 'process_stage', 'tool', 'attachment', 'document_series', 'backup', 'tally'];

export default function AuditLogPage() {
  return (
    <RequirePermission permission="audit_log.view">
      <AuditLog />
    </RequirePermission>
  );
}

function AuditLog() {
  const params = useListParams({ pageSize: 50 });
  const { data, isFetching } = usePaged<AuditLogRow>('/audit-logs', params.query);
  const [open, setOpen] = useState<AuditLogRow | null>(null);

  const columns = useMemo<ColumnDef<AuditLogRow>[]>(
    () => [
      { header: 'When', accessorKey: 'createdAt', meta: { className: 'w-44 whitespace-nowrap' }, cell: ({ getValue }) => <span className="tabular text-[13px]">{fmtDateTime(getValue<string>())}</span> },
      { header: 'Who', id: 'user', cell: ({ row }) => row.original.user?.name ?? <span className="text-muted-foreground">System</span> },
      { header: 'Action', accessorKey: 'action', cell: ({ getValue }) => <Badge variant={ACTION_BADGE[getValue<string>()] ?? 'muted'}>{humanize(getValue<string>())}</Badge> },
      { header: 'Record', id: 'entity', cell: ({ row }) => <span className="text-[13px] text-muted-foreground">{humanize(row.original.entity)}{row.original.entityId ? ` #${row.original.entityId}` : ''}</span> },
      { header: 'What happened', accessorKey: 'summary', cell: ({ getValue }) => <span className="line-clamp-1">{getValue<string>() ?? '—'}</span> },
      { header: 'IP', accessorKey: 'ip', cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue<string>() ?? ''}</span> },
    ],
    [],
  );

  return (
    <>
      <PageHeader title="Audit log" description="Every create, change, delete and sign-in, with who did it and when. Click a row for details." />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search what happened…"
        toolbar={
          <>
            <FilterSelect value={params.filters.entity} onChange={(v) => params.set({ entity: v })} options={ENTITIES.map((e) => ({ value: e, label: humanize(e) }))} placeholder="All records" />
            <FilterSelect value={params.filters.action} onChange={(v) => params.set({ action: v })} options={Object.keys(ACTION_BADGE).map((a) => ({ value: a, label: humanize(a) }))} placeholder="All actions" />
          </>
        }
        onRowClick={setOpen}
      />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open?.summary ?? humanize(open?.action ?? '')}</DialogTitle>
            <DialogDescription>
              {open?.user?.name ?? 'System'} · {fmtDateTime(open?.createdAt)} · {humanize(open?.entity ?? '')}
              {open?.entityId ? ` #${open.entityId}` : ''}
            </DialogDescription>
          </DialogHeader>
          {open?.changes ? <Changes changes={open.changes} /> : <p className="text-sm text-muted-foreground">No field details recorded.</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Updates are stored as { field: [old, new] }; anything else is shown as JSON. */
function Changes({ changes }: { changes: unknown }) {
  const raw = Object.entries(changes as Record<string, unknown>);
  const isDiff = raw.length > 0 && raw.every(([, v]) => Array.isArray(v) && v.length === 2);
  if (!isDiff) {
    return <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(changes, null, 2)}</pre>;
  }
  const entries = raw as [string, [unknown, unknown]][];
  const show = (v: unknown) => (v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Field</th>
            <th className="px-3 py-2 text-left">Before</th>
            <th className="px-3 py-2 text-left">After</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([field, [before, after]]) => (
            <tr key={field} className="border-t align-top">
              <td className="px-3 py-2 font-medium">{humanize(field.replace(/([A-Z])/g, '_$1'))}</td>
              <td className="px-3 py-2 break-all text-destructive/90 line-through decoration-destructive/40">{show(before)}</td>
              <td className="px-3 py-2 break-all text-success">{show(after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
