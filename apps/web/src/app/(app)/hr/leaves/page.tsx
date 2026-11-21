'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Ban, Check, Plus, SlidersHorizontal, X } from 'lucide-react';
import type { z } from 'zod';
import {
  LEAVE_STATUS_LABELS,
  LEAVE_STATUSES,
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  leaveBalanceSchema,
  leaveDays,
  leaveSchema,
  type LeaveBalanceInput,
  type LeaveInput,
} from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtDate, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { LeaveBalanceRow, LeaveRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { ComboboxField, FormGrid, SelectField, SwitchField, TextareaField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ReasonDialog } from '@/components/app/reason-dialog';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { EmptyRow, ReportTable, ReportTabs, td, tdNum, th, theadClass, thNum } from '@/components/reports/report-kit';

const TABS = [
  { key: 'requests', label: 'Leave' },
  { key: 'balances', label: 'Balances' },
] as const;
const STATUS_BADGE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'destructive', CANCELLED: 'muted' } as const;

export default function LeavesPage() {
  return (
    <RequirePermission permission="leaves.view">
      <Leaves />
    </RequirePermission>
  );
}

function Leaves() {
  const { can } = useSession();
  const params = useListParams({ filters: { tab: 'requests' } });
  const tab = params.filters.tab as 'requests' | 'balances';
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Leaves"
        description="CL, SL and EL are paid and come from the yearly balance; LWP is unpaid. Sundays are not counted as leave days."
        actions={
          can('leaves.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Record leave
            </Button>
          )
        }
      />
      <ReportTabs tabs={TABS} value={tab} onChange={(k) => params.set({ tab: k, page: undefined, status: undefined })} label="Leaves" />
      {tab === 'requests' ? <Requests params={params} /> : <Balances />}
      {creating && <LeaveDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function Requests({ params }: { params: ReturnType<typeof useListParams> }) {
  const { can } = useSession();
  const { data, isFetching } = usePaged<LeaveRequest>('/leaves', { ...params.query, tab: undefined });
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const decide = useMutation({
    mutationFn: ({ id, decision, remark }: { id: number; decision: 'APPROVED' | 'REJECTED'; remark?: string }) => api(`/leaves/${id}/decide`, { method: 'POST', body: { decision, remark } }),
    onSuccess: (_, v) => {
      toast.success(v.decision === 'APPROVED' ? 'Leave approved' : 'Leave rejected');
      setRejecting(null);
    },
    onError: (err) => showApiError(err),
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api(`/leaves/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Leave cancelled');
      setCancelling(null);
    },
    onError: (err) => showApiError(err),
  });
  const columns = useMemo<ColumnDef<LeaveRequest>[]>(
    () => [
      {
        header: 'Employee',
        id: 'employee',
        cell: ({ row }) => (
          <div>
            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{row.original.employee.empCode}</span>
            <span className="font-medium">{row.original.employee.name}</span>
          </div>
        ),
      },
      { header: 'Leave', accessorKey: 'type', cell: ({ row }) => <Badge variant={row.original.type === 'LWP' ? 'muted' : 'secondary'}>{LEAVE_TYPE_LABELS[row.original.type]}</Badge> },
      {
        header: 'Dates',
        accessorKey: 'fromDate',
        meta: { sortKey: 'fromDate' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            {fmtDate(row.original.fromDate)}
            {row.original.toDate !== row.original.fromDate && ` – ${fmtDate(row.original.toDate)}`}
            <div className="text-xs text-muted-foreground">
              {row.original.days} day(s){row.original.isHalfDay && ' · half day'}
            </div>
          </div>
        ),
      },
      {
        header: 'Reason',
        accessorKey: 'reason',
        cell: ({ row }) => (
          <div className="max-w-72 text-[13px]">
            {row.original.reason}
            {row.original.adminRemark && <div className="text-xs text-muted-foreground">HR: {row.original.adminRemark}</div>}
          </div>
        ),
      },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <Badge variant={STATUS_BADGE[row.original.status]}>{LEAVE_STATUS_LABELS[row.original.status]}</Badge> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const l = row.original;
          return (
            <div className="flex justify-end gap-1">
              {l.status === 'PENDING' && can('leaves.approve') && (
                <>
                  <Button size="sm" onClick={() => decide.mutate({ id: l.id, decision: 'APPROVED' })} aria-label={`Approve leave of ${l.employee.name}`}>
                    <Check /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(l)} aria-label={`Reject leave of ${l.employee.name}`}>
                    <X /> Reject
                  </Button>
                </>
              )}
              {(l.status === 'PENDING' || l.status === 'APPROVED') && (can('leaves.update') || can('leaves.approve')) && (
                <Button size="icon-sm" variant="ghost" title="Cancel this leave" aria-label={`Cancel leave of ${l.employee.name}`} onClick={() => setCancelling(l)}>
                  <Ban />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [can, decide],
  );
  return (
    <>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search employee or reason…"
        toolbar={
          <>
            <FilterSelect value={params.filters.status} onChange={(v) => params.set({ status: v })} options={LEAVE_STATUSES.map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] }))} placeholder="All statuses" />
            <FilterSelect value={params.filters.type} onChange={(v) => params.set({ type: v })} options={LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))} placeholder="All types" />
          </>
        }
        empty={{ title: 'No leave recorded', description: 'Record leave for an employee with “Record leave”.' }}
      />
      {rejecting && (
        <ReasonDialog
          title={`Reject leave of ${rejecting.employee.name}?`}
          description="The reason is kept with the request."
          confirmLabel="Reject"
          saving={decide.isPending}
          onConfirm={(remark) => decide.mutate({ id: rejecting.id, decision: 'REJECTED', remark })}
          onClose={() => setRejecting(null)}
        />
      )}
      {cancelling && (
        <ReasonDialog
          title={`Cancel leave of ${cancelling.employee.name}?`}
          description="For leave not taken after all. It stays on record as cancelled."
          confirmLabel="Cancel leave"
          saving={cancel.isPending}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}

function LeaveDialog({ onClose }: { onClose: () => void }) {
  const { can } = useSession();
  const lookups = useLookups('employees');
  const today = toInputDate(new Date());
  const defaults: z.input<typeof leaveSchema> = { employeeId: '' as unknown as number, type: 'CL', fromDate: today, toDate: today, isHalfDay: false, reason: '', approveNow: can('leaves.approve') };
  const form = useZodForm(leaveSchema, defaults);
  const [from, to, half] = useWatch({ control: form.control, name: ['fromDate', 'toDate', 'isHalfDay'] });
  const days = from && to && to >= from ? leaveDays(from, to, half) : 0;
  const save = useSave<LeaveInput>({ path: '/leaves', form, label: 'Leave', successMessage: 'Leave recorded', onSaved: onClose });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Record leave" description="Entered by HR for the employee." onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <ComboboxField form={form} name="employeeId" label="Employee" required options={lookups.data?.employees} loading={lookups.isLoading} />
      <FormGrid>
        <SelectField form={form} name="type" label="Leave" options={LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))} />
        <div className="flex items-end pb-2 text-sm">
          <span className={cn('font-semibold', !days && 'text-destructive')}>{days} day(s)</span>
          <span className="ml-1 text-muted-foreground">without Sundays</span>
        </div>
        <TextField form={form} name="fromDate" label="From" type="date" required />
        <TextField form={form} name="toDate" label="To" type="date" required />
      </FormGrid>
      <SwitchField form={form} name="isHalfDay" label="Half day" />
      <TextareaField form={form} name="reason" label="Reason" rows={2} required />
      {can('leaves.approve') && <SwitchField form={form} name="approveNow" label="Approve now" hint="Off = waits for approval" />}
    </FormDialog>
  );
}

function Balances() {
  const { can } = useSession();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isFetching } = useApiQuery<LeaveBalanceRow[]>('/leaves/balances', { year });
  const [setting, setSetting] = useState<{ employee?: LeaveBalanceRow['employee']; row?: LeaveBalanceRow } | null>(null);
  const cell = (k: LeaveBalanceRow['CL']) => (
    <td className={tdNum}>
      <span className={cn('font-semibold', k.left < 0 && 'text-destructive')}>{k.left}</span>
      <span className="text-xs text-muted-foreground"> / {k.allowed}</span>
      {k.waiting > 0 && <div className="text-xs text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning">{k.waiting} waiting</div>}
    </td>
  );
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <FilterSelect value={String(year)} onChange={(v) => v && setYear(Number(v))} options={[year - 1, year, year + 1].sort().map((y) => ({ value: String(y), label: String(y) }))} placeholder="Year" />
        {can('leaves.approve') && (
          <Button variant="outline" onClick={() => setSetting({})}>
            <SlidersHorizontal /> Set allowance for everyone
          </Button>
        )}
      </div>
      {!data ? (
        <Skeleton className="h-80" />
      ) : (
        <ReportTable minWidth={720} className={cn(isFetching && 'opacity-70')}>
          <thead className={theadClass}>
            <tr>
              <th className={th}>Employee</th>
              <th className={thNum}>CL left</th>
              <th className={thNum}>SL left</th>
              <th className={thNum}>EL left</th>
              <th className={thNum}>LWP taken</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && <EmptyRow cols={6}>No working employees.</EmptyRow>}
            {data.map((r) => (
              <tr key={r.employee.id} className="border-b last:border-0">
                <td className={td}>
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.employee.empCode}</span>
                  <span className="font-medium">{r.employee.name}</span>
                </td>
                {cell(r.CL)}
                {cell(r.SL)}
                {cell(r.EL)}
                <td className={tdNum}>{r.LWP.used || '—'}</td>
                <td className="px-3 py-1.5 text-right">
                  {can('leaves.approve') && (
                    <Button size="sm" variant="ghost" onClick={() => setSetting({ employee: r.employee, row: r })}>
                      Change
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ReportTable>
      )}
      {setting && <AllowanceDialog year={year} target={setting} onClose={() => setSetting(null)} />}
    </>
  );
}

function AllowanceDialog({ year, target, onClose }: { year: number; target: { employee?: LeaveBalanceRow['employee']; row?: LeaveBalanceRow }; onClose: () => void }) {
  const form = useZodForm(leaveBalanceSchema, {
    year,
    casual: String(target.row?.CL.allowed ?? 7) as unknown as number,
    sick: String(target.row?.SL.allowed ?? 7) as unknown as number,
    earned: String(target.row?.EL.allowed ?? 15) as unknown as number,
    employeeIds: target.employee ? [target.employee.id] : [],
  });
  const save = useMutation({
    mutationFn: (v: LeaveBalanceInput) => api('/leaves/balances', { method: 'PUT', body: v }),
    onSuccess: () => {
      toast.success('Leave allowance saved');
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={target.employee ? `Leave allowance ${year}: ${target.employee.name}` : `Leave allowance ${year} for every working employee`}
      description="Days allowed in the year. Leave already taken stays."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormGrid>
        <TextField form={form} name="casual" label="Casual leave (CL)" type="number" min={0} step="0.5" />
        <TextField form={form} name="sick" label="Sick leave (SL)" type="number" min={0} step="0.5" />
        <TextField form={form} name="earned" label="Earned leave (EL)" type="number" min={0} step="0.5" />
      </FormGrid>
    </FormDialog>
  );
}
