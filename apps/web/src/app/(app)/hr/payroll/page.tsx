'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Banknote, CheckCircle2, Download, FileText, Lock, Pencil, RefreshCw, Settings2, Trash2, Undo2, Wallet } from 'lucide-react';
import { fmtHours, PAYROLL_STATUS_LABELS, payrollAdjustSchema, payrollPaidSchema, payrollSettingsSchema, type PayrollAdjustInput, type PayrollPaidInput, type PayrollSettingsInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { fmtDate, fmtMoney, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Payslip, PayrollMonth, PayrollRunRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { FormGrid, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { EmptyRow, ReportTable, StatTile, td, tdNum, th, theadClass, thNum, totalRow } from '@/components/reports/report-kit';

const STATUS_BADGE = { DRAFT: 'warning', FINALIZED: 'info', PAID: 'success' } as const;
const lastMonth = () => {
  const d = new Date();
  return toInputDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)).slice(0, 7);
};
const monthName = (m: string) => format(parseISO(`${m}-01`), 'MMMM yyyy');

export default function PayrollPage() {
  return (
    <RequirePermission permission="payroll.view">
      <Payroll />
    </RequirePermission>
  );
}

function Payroll() {
  const { can } = useSession();
  const params = useListParams();
  const month = params.filters.month || lastMonth();
  const { data, isFetching } = useApiQuery<PayrollMonth>(`/payroll/${month}`);
  const runs = useApiQuery<PayrollRunRow[]>('/payroll');
  const [confirm, setConfirm] = useState<'finalize' | 'revoke' | 'delete' | null>(null);
  const [paying, setPaying] = useState(false);
  const [settings, setSettings] = useState(false);
  const [adjusting, setAdjusting] = useState<Payslip | null>(null);
  const act = useMutation({
    mutationFn: (what: 'prepare' | 'recalculate' | 'finalize' | 'revoke' | 'delete') =>
      what === 'delete' ? api(`/payroll/${month}`, { method: 'DELETE' }) : api(`/payroll/${month}/${what}`, { method: 'POST' }),
    onSuccess: (_, what) => {
      toast.success(
        {
          prepare: `Payroll of ${monthName(month)} prepared`,
          recalculate: 'Recalculated with the latest attendance, leave and loans',
          finalize: `Payroll of ${monthName(month)} finalized; loans updated and attendance closed`,
          revoke: 'Payroll back to draft; loan EMIs given back',
          delete: 'Draft deleted',
        }[what],
      );
      setConfirm(null);
    },
    onError: (err) => {
      showApiError(err);
      setConfirm(null);
    },
  });
  const run = data?.run;
  const t = data?.totals;

  return (
    <>
      <PageHeader
        title="Payroll"
        description={`Salary = basic ÷ ${data?.settings.monthDays ?? 26} days × days paid (present + paid leave), plus / minus the hours above / below the shift, minus PF and loan EMI.`}
        actions={
          <>
            <Input type="month" value={month} onChange={(e) => e.target.value && params.set({ month: e.target.value })} className="h-9 w-40" aria-label="Payroll month" />
            {can('payroll.approve') && (
              <Button variant="outline" onClick={() => setSettings(true)}>
                <Settings2 /> Settings
              </Button>
            )}
          </>
        }
      />

      {!data ? (
        <Skeleton className="h-96" />
      ) : !run ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{monthName(month)}: not prepared</CardTitle>
            <CardDescription>
              {data.candidates ? `${data.candidates} employee(s) have attendance in this month.` : 'No attendance in this month yet.'} Preparing makes a draft you can check and change before finalizing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {can('payroll.create') && (
              <Button onClick={() => act.mutate('prepare')} loading={act.isPending} disabled={!data.candidates}>
                <Wallet /> Prepare payroll for {monthName(month)}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className={cn('space-y-3', isFetching && 'opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{monthName(month)}</h2>
            <Badge variant={STATUS_BADGE[run.status]}>{PAYROLL_STATUS_LABELS[run.status]}</Badge>
            <span className="text-sm text-muted-foreground">
              {run.monthDays} days · PF {run.pfPercent}%
              {run.status === 'PAID' && ` · paid on ${fmtDate(run.paidAt)}${run.paymentRef ? ` (${run.paymentRef})` : ''}`}
            </span>
            {run.status !== 'DRAFT' && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3.5" /> attendance of the month is closed
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {run.status === 'DRAFT' && can('payroll.update') && (
                <Button variant="outline" onClick={() => act.mutate('recalculate')} loading={act.isPending && act.variables === 'recalculate'}>
                  <RefreshCw /> Recalculate
                </Button>
              )}
              {run.status === 'DRAFT' && can('payroll.delete') && (
                <Button variant="ghost" className="text-destructive" onClick={() => setConfirm('delete')}>
                  <Trash2 /> Delete draft
                </Button>
              )}
              {run.status === 'DRAFT' && can('payroll.approve') && (
                <Button onClick={() => setConfirm('finalize')}>
                  <CheckCircle2 /> Finalize
                </Button>
              )}
              {run.status === 'FINALIZED' && can('payroll.approve') && (
                <>
                  <Button variant="outline" onClick={() => setConfirm('revoke')}>
                    <Undo2 /> Revoke
                  </Button>
                  <Button onClick={() => setPaying(true)}>
                    <Banknote /> Mark salaries paid
                  </Button>
                </>
              )}
            </div>
          </div>
          {t && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatTile label="Employees" value={t.employees} />
              <StatTile label="Gross" value={fmtMoney(t.gross)} />
              <StatTile label="PF" value={fmtMoney(t.pf)} />
              <StatTile label="Loan EMI" value={fmtMoney(t.loans)} />
              <StatTile label="Net pay" value={fmtMoney(t.net)} sub={t.other ? `incl. ${fmtMoney(t.other)} adjustments` : undefined} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/payroll/${month}/payslips.pdf`} target="_blank" rel="noreferrer">
                <FileText /> All payslips (PDF)
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/payroll/${month}/register`}>
                <Download /> Salary register (CSV)
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/payroll/${month}/bank`}>
                <Download /> Bank transfer sheet (CSV)
              </a>
            </Button>
          </div>
          <ReportTable minWidth={1000}>
            <thead className={theadClass}>
              <tr>
                <th className={th}>Employee</th>
                <th className={thNum} title="Present + paid leave (most the month days)">
                  Days paid
                </th>
                <th className={thNum} title="Hours worked minus present days x shift">
                  Hours +/−
                </th>
                <th className={thNum}>Gross</th>
                <th className={thNum}>PF</th>
                <th className={thNum}>Loan EMI</th>
                <th className={thNum}>Other +/−</th>
                <th className={thNum}>Net pay</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {!data.payslips?.length && <EmptyRow cols={9}>No payslips.</EmptyRow>}
              {data.payslips?.map((p) => (
                <tr key={p.id} className="border-b align-top last:border-0">
                  <td className={td}>
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">{p.employee.empCode}</span>
                    <span className="font-medium">{p.employee.name}</span>
                    <div className="text-xs text-muted-foreground">
                      Basic {fmtMoney(p.basicSalary)} · {p.shiftHours} h{p.employee.bankAccountNo ? '' : ' · cash'}
                    </div>
                  </td>
                  <td className={tdNum}>
                    <span className="font-semibold">{p.payableDays}</span>
                    <div className="text-xs text-muted-foreground">
                      {p.presentDays} present{p.paidLeaveDays ? ` + ${p.paidLeaveDays} leave` : ''}
                      {p.sundaysWorked ? ` · ${p.sundaysWorked} Sun` : ''}
                    </div>
                  </td>
                  <td className={cn(tdNum, p.hourDifference < 0 ? 'text-destructive' : p.hourDifference > 0 ? 'text-success' : '')}>
                    {p.hourDifference ? fmtHours(p.hourDifference) : '—'}
                    {p.hourAdjustment !== 0 && <div className="text-xs">{fmtMoney(p.hourAdjustment)}</div>}
                  </td>
                  <td className={tdNum}>{fmtMoney(p.grossEarning)}</td>
                  <td className={tdNum}>{p.pfDeduction ? fmtMoney(p.pfDeduction) : '—'}</td>
                  <td className={tdNum}>{p.loanDeduction ? fmtMoney(p.loanDeduction) : '—'}</td>
                  <td className={tdNum}>
                    {p.otherAdjustment ? fmtMoney(p.otherAdjustment) : '—'}
                    {p.adjustmentNote && <div className="max-w-40 truncate text-xs text-muted-foreground" title={p.adjustmentNote}>{p.adjustmentNote}</div>}
                  </td>
                  <td className={cn(tdNum, 'font-semibold')}>{fmtMoney(p.netSalary)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {run.status === 'DRAFT' && can('payroll.update') && (
                      <Button variant="ghost" size="icon-sm" title="Add / change an amount" aria-label={`Adjust pay of ${p.employee.name}`} onClick={() => setAdjusting(p)}>
                        <Pencil />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" asChild title="Payslip PDF">
                      <a href={`/api/payroll/payslips/${p.id}/pdf`} target="_blank" rel="noreferrer" aria-label={`Payslip of ${p.employee.name}`}>
                        <FileText />
                      </a>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            {t && !!data.payslips?.length && (
              <tfoot>
                <tr className={totalRow}>
                  <td className={td} colSpan={3}>
                    Total ({t.employees})
                  </td>
                  <td className={tdNum}>{fmtMoney(t.gross)}</td>
                  <td className={tdNum}>{fmtMoney(t.pf)}</td>
                  <td className={tdNum}>{fmtMoney(t.loans)}</td>
                  <td className={tdNum}>{fmtMoney(t.other)}</td>
                  <td className={tdNum}>{fmtMoney(t.net)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </ReportTable>
        </div>
      )}

      {!!runs.data?.length && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Earlier months</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {runs.data.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => params.set({ month: r.month })} className={cn('flex w-full items-center gap-3 py-2 text-left hover:text-primary', r.month === month && 'font-semibold')}>
                    <span className="whitespace-nowrap sm:w-36">{monthName(r.month)}</span>
                    <Badge variant={STATUS_BADGE[r.status]}>{PAYROLL_STATUS_LABELS[r.status]}</Badge>
                    <span className="hidden text-muted-foreground sm:inline">
                      {r.employees} employee{r.employees === 1 ? '' : 's'}
                    </span>
                    <span className="tabular ml-auto whitespace-nowrap">{fmtMoney(r.net)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === 'finalize'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Finalize payroll of ${monthName(month)}?`}
        description="It is recalculated once more, the loan EMIs are taken off the loans and the attendance of the month is closed. You can revoke it until it is marked paid."
        confirmLabel="Finalize"
        destructive={false}
        loading={act.isPending}
        onConfirm={() => act.mutate('finalize')}
      />
      <ConfirmDialog
        open={confirm === 'revoke'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Revoke payroll of ${monthName(month)}?`}
        description="It goes back to draft: the loan EMIs are given back to the loans and attendance can be corrected again."
        confirmLabel="Revoke"
        destructive={false}
        loading={act.isPending}
        onConfirm={() => act.mutate('revoke')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this draft?"
        description="Nothing is booked yet; you can prepare it again."
        loading={act.isPending}
        onConfirm={() => act.mutate('delete')}
      />
      {paying && <PaidDialog month={month} onClose={() => setPaying(false)} />}
      {settings && data && <SettingsDialog current={data.settings} onClose={() => setSettings(false)} />}
      {adjusting && <AdjustDialog payslip={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}

function AdjustDialog({ payslip, onClose }: { payslip: Payslip; onClose: () => void }) {
  const form = useZodForm(payrollAdjustSchema, { otherAdjustment: String(payslip.otherAdjustment) as unknown as number, adjustmentNote: payslip.adjustmentNote ?? '' });
  const save = useMutation({
    mutationFn: (v: PayrollAdjustInput) => api(`/payroll/payslips/${payslip.id}`, { method: 'PUT', body: v }),
    onSuccess: () => {
      toast.success(`Pay of ${payslip.employee.name} changed`);
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Add / cut an amount: ${payslip.employee.name}`}
      description="Plus for a bonus or Sunday work, minus for a fine or damage. Printed on the payslip with the note."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <FormGrid>
        <TextField form={form} name="otherAdjustment" label="Amount (₹, minus to cut)" type="number" step="0.01" />
        <TextField form={form} name="adjustmentNote" label="For" placeholder="Sunday work 2 days" />
      </FormGrid>
    </FormDialog>
  );
}

function PaidDialog({ month, onClose }: { month: string; onClose: () => void }) {
  const form = useZodForm(payrollPaidSchema, { paidOn: toInputDate(new Date()), paymentRef: '' });
  const save = useMutation({
    mutationFn: (v: PayrollPaidInput) => api(`/payroll/${month}/paid`, { method: 'POST', body: v }),
    onSuccess: () => {
      toast.success('Salaries marked as paid');
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={`Salaries of ${monthName(month)} paid`} description="After this the payroll cannot be revoked." onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormGrid>
        <TextField form={form} name="paidOn" label="Paid on" type="date" required />
        <TextField form={form} name="paymentRef" label="Bank batch / reference" />
      </FormGrid>
    </FormDialog>
  );
}

function SettingsDialog({ current, onClose }: { current: PayrollSettingsInput; onClose: () => void }) {
  const form = useZodForm(payrollSettingsSchema, { monthDays: String(current.monthDays) as unknown as number, pfPercent: String(current.pfPercent) as unknown as number });
  const save = useMutation({
    mutationFn: (v: PayrollSettingsInput) => api('/payroll/settings', { method: 'PUT', body: v }),
    onSuccess: () => {
      toast.success('Payroll settings saved');
      onClose();
    },
    onError: (err) => showApiError(err, form),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Payroll settings" description="Used for months prepared from now on (a prepared month keeps its own)." onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormGrid>
        <TextField form={form} name="monthDays" label="Working days in a month" type="number" min={20} max={31} hint="Basic is divided by this" />
        <TextField form={form} name="pfPercent" label="PF % of basic" type="number" min={0} max={30} step="0.01" />
      </FormGrid>
    </FormDialog>
  );
}
