'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, FileText, Pencil } from 'lucide-react';
import { fmtHours, GENDER_LABELS, LOAN_STATUS_LABELS, PAYROLL_STATUS_LABELS } from '@bht/shared';
import { fmtDate, fmtMoney, toInputDate } from '@/lib/format';
import { useApiQuery } from '@/hooks/use-api';
import type { AttendanceMonth, EmployeeDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { DayCell, DayLegend } from '@/components/hr/attendance-bits';
import { EmployeeSheet } from '@/components/hr/employee-sheet';

export default function EmployeePage() {
  return (
    <RequirePermission permission="employees.view">
      <EmployeeView />
    </RequirePermission>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{children || '—'}</div>
    </div>
  );
}

function EmployeeView() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: e, isError } = useApiQuery<EmployeeDetail>(`/employees/${id}`);
  const month = toInputDate(new Date()).slice(0, 7);
  const att = useApiQuery<AttendanceMonth>('/attendance/month', { month, employeeId: id }, can('attendance.view'));
  const [editing, setEditing] = useState(false);
  if (isError) return <p className="py-20 text-center text-sm text-muted-foreground">Employee not found.</p>;
  if (!e) return <Skeleton className="h-96" />;
  const row = att.data?.rows[0];
  const quota = e.leaveBalances[0];
  const leave = (k: 'CL' | 'SL' | 'EL', allowed: number | undefined) => `${Math.round(((allowed ?? 0) - (e.leaveUsed[k] ?? 0)) * 10) / 10} of ${allowed ?? 0}`;

  return (
    <>
      <PageHeader
        title={`${e.empCode} · ${e.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {e.status === 'ACTIVE' ? <Badge variant="success">Working</Badge> : <Badge variant="muted">Left {fmtDate(e.leftOn)}</Badge>}
            <span>{[e.designation, e.department?.name].filter(Boolean).join(' · ') || 'No department'}</span>
          </span>
        }
        actions={
          <>
            {can('employees.update') && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href="/hr/employees">
                <ArrowLeft /> All employees
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="Joined">{fmtDate(e.dateOfJoining)}</Fact>
            <Fact label="Gender">{GENDER_LABELS[e.gender]}</Fact>
            <Fact label="Phone">{e.phone}</Fact>
            <Fact label="Basic salary">{fmtMoney(e.basicSalary)} / month</Fact>
            <Fact label="Shift">{e.shiftHours} hours</Fact>
            <Fact label="PF">{e.isPfEligible ? `Yes${e.uan ? ` · UAN ${e.uan}` : ''}` : 'No'}</Fact>
            <Fact label="Bank">{e.bankAccountNo ? `${e.bankName ?? ''} ····${e.bankAccountNo.slice(-4)} · ${e.bankIfsc ?? ''}` : 'Cash'}</Fact>
            <Fact label="CTC">{e.ctc ? `${fmtMoney(e.ctc)} / year` : null}</Fact>
            <Fact label="Address">{e.address}</Fact>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leave {e.leaveYear}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Fact label="Casual leave left">{leave('CL', quota?.casual)}</Fact>
            <Fact label="Sick leave left">{leave('SL', quota?.sick)}</Fact>
            <Fact label="Earned leave left">{leave('EL', quota?.earned)}</Fact>
            <Fact label="Without pay taken">{e.leaveUsed.LWP ?? 0} day(s)</Fact>
          </CardContent>
        </Card>
      </div>

      {row && att.data && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Attendance {format(parseISO(`${month}-01`), 'MMMM yyyy')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                Present <b>{row.presentDays}</b>
              </span>
              <span>
                Sundays worked <b>{row.sundaysWorked}</b>
              </span>
              <span>
                Leave <b>{row.paidLeaveDays}</b>
              </span>
              <span>
                Absent <b>{row.absentDays}</b>
              </span>
              <span>
                Hours <b>{fmtHours(row.hoursWorked)}</b> of {fmtHours(row.expectedHours)}
              </span>
              {row.missingPunchDays > 0 && <Badge variant="warning">{row.missingPunchDays} day(s) with a missing punch</Badge>}
            </div>
            <div className="flex flex-wrap gap-0.5">
              {att.data.dates.map((d) => (
                <DayCell key={d} date={d} status={row.status[d]} />
              ))}
            </div>
            <DayLegend />
          </CardContent>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Running loans</CardTitle>
          </CardHeader>
          <CardContent>
            {e.loans.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {e.loans.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span>
                      {fmtMoney(l.balance)} left <span className="text-muted-foreground">of {fmtMoney(l.amount)}</span>
                      <div className="text-xs text-muted-foreground">
                        EMI {fmtMoney(l.emiAmount)} · {LOAN_STATUS_LABELS[l.status]}
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payslips</CardTitle>
          </CardHeader>
          <CardContent>
            {e.payslips.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {e.payslips.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-24">{format(parseISO(`${p.payrollRun.month}-01`), 'MMM yyyy')}</span>
                    <span className="text-xs text-muted-foreground">{PAYROLL_STATUS_LABELS[p.payrollRun.status]}</span>
                    <span className="tabular ml-auto font-medium">{fmtMoney(p.netSalary)}</span>
                    {can('payroll.view') && (
                      <a href={`/api/payroll/payslips/${p.id}/pdf`} target="_blank" rel="noreferrer" aria-label={`Payslip ${p.payrollRun.month}`} className="text-primary">
                        <FileText className="size-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assets with this employee</CardTitle>
          </CardHeader>
          <CardContent>
            {e.assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {e.assets.map((a) => (
                  <li key={a.id}>
                    <span className="font-mono text-xs font-semibold">{a.code}</span> {a.name}
                    {a.assignDate && <span className="text-xs text-muted-foreground"> · since {fmtDate(a.assignDate)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {editing && <EmployeeSheet employee={e} onClose={() => setEditing(false)} />}
    </>
  );
}
