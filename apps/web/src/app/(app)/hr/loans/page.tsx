'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Banknote, Pencil, Plus } from 'lucide-react';
import type { z } from 'zod';
import {
  LOAN_STATUS_LABELS,
  LOAN_STATUSES,
  LOAN_TYPE_LABELS,
  LOAN_TYPES,
  loanRepaymentSchema,
  loanSchema,
  loanUpdateSchema,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  type LoanInput,
  type LoanRepaymentInput,
  type LoanUpdateInput,
} from '@bht/shared';
import { fmtDate, fmtMoney, toInputDate } from '@/lib/format';
import { useZodForm } from '@/lib/forms';
import { useApiQuery, useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Loan, LoanDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, DropdownMenuItem, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { ComboboxField, FormGrid, SelectField, TextareaField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { StatTile } from '@/components/reports/report-kit';

const STATUS_BADGE = { ACTIVE: 'info', PAUSED: 'warning', CLOSED: 'muted' } as const;
const MODES = PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABELS[m] }));

export default function LoansPage() {
  return (
    <RequirePermission permission="loans.view">
      <Loans />
    </RequirePermission>
  );
}

function Loans() {
  const { can } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<Loan>('/loans', params.query);
  const extra = data as unknown as { outstanding?: number; openLoans?: number } | undefined;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [repaying, setRepaying] = useState<Loan | null>(null);
  const [viewing, setViewing] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState<Loan | null>(null);
  const del = useDelete('/loans', 'Loan', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Loan>[]>(
    () => [
      {
        header: 'Employee',
        id: 'employee',
        cell: ({ row }) => (
          <div>
            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{row.original.employee.empCode}</span>
            <span className="font-medium">{row.original.employee.name}</span>
            <div className="text-xs text-muted-foreground">
              {LOAN_TYPE_LABELS[row.original.type]} · given {fmtDate(row.original.createdAt)}
              {row.original.reason && ` · ${row.original.reason}`}
            </div>
          </div>
        ),
      },
      { header: 'Amount', accessorKey: 'amount', meta: { sortKey: 'amount', align: 'right' }, cell: ({ row }) => <span className="whitespace-nowrap">{fmtMoney(row.original.amount)}</span> },
      {
        header: 'EMI',
        accessorKey: 'emiAmount',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="text-right whitespace-nowrap">
            {fmtMoney(row.original.emiAmount)}
            <div className="text-xs text-muted-foreground">from {row.original.startMonth}</div>
          </div>
        ),
      },
      { header: 'Still to repay', accessorKey: 'balance', meta: { sortKey: 'balance', align: 'right' }, cell: ({ row }) => <span className="font-semibold whitespace-nowrap">{fmtMoney(row.original.balance)}</span> },
      { header: 'Status', accessorKey: 'status', meta: { sortKey: 'status' }, cell: ({ row }) => <Badge variant={STATUS_BADGE[row.original.status]}>{LOAN_STATUS_LABELS[row.original.status]}</Badge> },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) =>
          row.original.status !== 'CLOSED' || can('loans.delete') ? (
            <RowActions onDelete={can('loans.delete') ? () => setDeleting(row.original) : undefined}>
              {row.original.status !== 'CLOSED' && can('loans.update') && (
                <>
                  <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                    <Pencil /> Change EMI / pause
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRepaying(row.original)}>
                    <Banknote /> Paid back in cash / bank
                  </DropdownMenuItem>
                </>
              )}
            </RowActions>
          ) : null,
      },
    ],
    [can],
  );

  return (
    <>
      <PageHeader
        title="Loans & advances"
        description="Money given to employees. The monthly EMI is taken in payroll from the start month; paused loans are skipped."
        actions={
          can('loans.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Give loan / advance
            </Button>
          )
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-md">
        <StatTile label="Still to repay" value={extra?.outstanding == null ? '—' : fmtMoney(extra.outstanding)} />
        <StatTile label="Open loans" value={extra?.openLoans ?? '—'} />
      </div>
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search employee or reason…"
        toolbar={<FilterSelect value={params.filters.status} onChange={(v) => params.set({ status: v })} options={LOAN_STATUSES.map((s) => ({ value: s, label: LOAN_STATUS_LABELS[s] }))} placeholder="All loans" />}
        onRowClick={(l) => setViewing(l)}
        empty={{ title: 'No loans', description: 'Record an advance or loan with “Give loan / advance”.' }}
      />
      {creating && <LoanDialog onClose={() => setCreating(false)} />}
      {editing && <EditDialog loan={editing} onClose={() => setEditing(null)} />}
      {repaying && <RepayDialog loan={repaying} onClose={() => setRepaying(null)} />}
      {viewing && <Ledger id={viewing.id} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete loan?"
        description="Only a loan with no repayment yet can be deleted (entered by mistake)."
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

function LoanDialog({ onClose }: { onClose: () => void }) {
  const lookups = useLookups('employees');
  const defaults: z.input<typeof loanSchema> = {
    employeeId: '' as unknown as number,
    type: 'ADVANCE',
    amount: '' as unknown as number,
    emiAmount: '' as unknown as number,
    startMonth: toInputDate(new Date()).slice(0, 7),
    disbursementMode: 'CASH',
    disbursementRef: '',
    reason: '',
  };
  const form = useZodForm(loanSchema, defaults);
  const save = useSave<LoanInput>({ path: '/loans', form, label: 'Loan', successMessage: 'Loan recorded', onSaved: onClose });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Give loan / advance" onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <ComboboxField form={form} name="employeeId" label="Employee" required options={lookups.data?.employees} loading={lookups.isLoading} />
      <FormGrid>
        <SelectField form={form} name="type" label="Type" options={LOAN_TYPES.map((t) => ({ value: t, label: LOAN_TYPE_LABELS[t] }))} />
        <TextField form={form} name="amount" label="Amount (₹)" type="number" min={1} step="0.01" required />
        <TextField form={form} name="emiAmount" label="EMI per month (₹)" type="number" min={1} step="0.01" required />
        <TextField form={form} name="startMonth" label="First EMI in salary of" type="month" required />
        <SelectField form={form} name="disbursementMode" label="Given by" options={MODES} />
        <TextField form={form} name="disbursementRef" label="UTR / cheque no." />
      </FormGrid>
      <TextareaField form={form} name="reason" label="Reason" rows={2} />
    </FormDialog>
  );
}

function EditDialog({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const form = useZodForm(loanUpdateSchema, { emiAmount: String(loan.emiAmount) as unknown as number, status: loan.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE', reason: loan.reason ?? '' });
  const save = useSave<LoanUpdateInput>({ path: '/loans', id: loan.id, form, label: 'Loan', onSaved: onClose });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={`Loan of ${loan.employee.name}`} description={`Still to repay ${fmtMoney(loan.balance)}.`} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormGrid>
        <TextField form={form} name="emiAmount" label="EMI per month (₹)" type="number" min={1} step="0.01" required />
        <SelectField
          form={form}
          name="status"
          label="EMI"
          options={[
            { value: 'ACTIVE', label: LOAN_STATUS_LABELS.ACTIVE },
            { value: 'PAUSED', label: LOAN_STATUS_LABELS.PAUSED },
          ]}
        />
      </FormGrid>
      <TextareaField form={form} name="reason" label="Note" rows={2} />
    </FormDialog>
  );
}

function RepayDialog({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const form = useZodForm(loanRepaymentSchema, { date: toInputDate(new Date()), amount: String(loan.balance) as unknown as number, mode: 'CASH', remarks: '' });
  const save = useSave<LoanRepaymentInput>({ path: `/loans/${loan.id}/repayments`, form, label: 'Repayment', successMessage: 'Repayment recorded', onSaved: onClose });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Paid back by ${loan.employee.name}`}
      description={`Money paid outside the salary. Still to repay ${fmtMoney(loan.balance)}.`}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormGrid>
        <TextField form={form} name="date" label="Date" type="date" required />
        <TextField form={form} name="amount" label="Amount (₹)" type="number" min={1} step="0.01" required />
        <SelectField form={form} name="mode" label="Paid by" options={MODES} />
        <TextField form={form} name="remarks" label="Note" />
      </FormGrid>
    </FormDialog>
  );
}

function Ledger({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useApiQuery<LoanDetail>(`/loans/${id}`);
  let left = data?.amount ?? 0;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{data ? `${data.employee.empCode} · ${data.employee.name}` : 'Loan'}</SheetTitle>
          <SheetDescription>{data && `${LOAN_TYPE_LABELS[data.type]} of ${fmtMoney(data.amount)}, EMI ${fmtMoney(data.emiAmount)} from ${data.startMonth}`}</SheetDescription>
        </SheetHeader>
        {!data ? (
          <Skeleton className="m-4 h-40" />
        ) : (
          <div className="px-4 pb-4">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">How</th>
                  <th className="py-2 text-right">Paid</th>
                  <th className="py-2 text-right">Left</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2">{fmtDate(data.createdAt)}</td>
                  <td className="py-2">Given ({PAYMENT_MODE_LABELS[data.disbursementMode]})</td>
                  <td />
                  <td className="tabular py-2 text-right">{fmtMoney(data.amount)}</td>
                </tr>
                {data.repayments.map((r) => {
                  left = Math.round((left - r.amount) * 100) / 100;
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2">{fmtDate(r.date)}</td>
                      <td className="py-2">
                        {r.payslip ? `Salary ${r.payslip.payrollRun.month}` : r.mode ? PAYMENT_MODE_LABELS[r.mode] : '—'}
                        {r.remarks && !r.payslip && <div className="text-xs text-muted-foreground">{r.remarks}</div>}
                      </td>
                      <td className="tabular py-2 text-right">{fmtMoney(r.amount)}</td>
                      <td className="tabular py-2 text-right font-medium">{fmtMoney(left)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-sm">
              Status: <Badge variant={STATUS_BADGE[data.status]}>{LOAN_STATUS_LABELS[data.status]}</Badge>
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
