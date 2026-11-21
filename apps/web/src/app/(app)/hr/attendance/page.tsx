'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Ban, Check, Download, FileUp, Lock, Pencil, Search, Trash2 } from 'lucide-react';
import { ATTENDANCE_SOURCE_LABELS, fmtHours, LEAVE_TYPE_LABELS } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtAgo, fmtDate, fmtDateTime, toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { AttendanceDay, AttendanceMonth, BiometricDevice } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { ReportTabs, ReportTable, EmptyRow, td, tdNum, th, theadClass, thNum } from '@/components/reports/report-kit';
import { DayCell, DayLegend, ImportDialog, PunchDialog } from '@/components/hr/attendance-bits';

const TABS = [
  { key: 'month', label: 'Month' },
  { key: 'day', label: 'Day' },
  { key: 'machines', label: 'Machines' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const thisMonth = () => toInputDate(new Date()).slice(0, 7);

export default function AttendancePage() {
  return (
    <RequirePermission permission="attendance.view">
      <Attendance />
    </RequirePermission>
  );
}

function Attendance() {
  const { can } = useSession();
  const params = useListParams({ filters: { tab: 'month' } });
  const tab = params.filters.tab as Tab;
  const [importing, setImporting] = useState(false);
  const month = params.filters.month || thisMonth();
  const unknown = useApiQuery<{ empCode: string; punches: number; from: string; to: string }[]>('/attendance/unknown-codes');

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Punches come from the biometric machine; pairs are IN and OUT. Sundays are the weekly off. Correct a day by clicking it."
        actions={
          <>
            {tab === 'month' && (
              <Button variant="outline" asChild>
                <a href={`/api/attendance/month/export?month=${month}${params.filters.departmentId ? `&departmentId=${params.filters.departmentId}` : ''}`}>
                  <Download /> Excel (CSV)
                </a>
              </Button>
            )}
            {can('attendance.create') && (
              <Button onClick={() => setImporting(true)}>
                <FileUp /> Import CSV
              </Button>
            )}
          </>
        }
      />
      {!!unknown.data?.length && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning" />
          <div>
            <span className="font-medium">Punches from codes that are not in the employee list: </span>
            {unknown.data.map((u) => `${u.empCode} (${u.punches})`).join(', ')}. Add an employee with that code and the punches are counted.
          </div>
        </div>
      )}
      <ReportTabs tabs={TABS} value={tab} onChange={(k) => params.set({ tab: k })} label="Attendance view" />
      {tab === 'month' && <MonthView params={params} month={month} />}
      {tab === 'day' && <DayView params={params} />}
      {tab === 'machines' && <Machines unknown={unknown.data ?? []} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function Filters({ params, children }: { params: ReturnType<typeof useListParams>; children: React.ReactNode }) {
  const lookups = useLookups('departments');
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {children}
      <FilterSelect value={params.filters.departmentId} onChange={(v) => params.set({ departmentId: v })} options={(lookups.data?.departments ?? []).map((o) => ({ value: o.value, label: o.label }))} placeholder="All departments" />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={params.searchInput} onChange={(e) => params.setSearchInput(e.target.value)} placeholder="Code or name" className="h-9 w-44 pl-8" aria-label="Search employee" />
      </div>
    </div>
  );
}

function MonthView({ params, month }: { params: ReturnType<typeof useListParams>; month: string }) {
  const { can } = useSession();
  const { data, isFetching } = useApiQuery<AttendanceMonth>('/attendance/month', { month, departmentId: params.filters.departmentId, search: params.search || undefined });
  const [editing, setEditing] = useState<{ employee: { id: number; empCode: string; name: string }; date: string } | null>(null);
  return (
    <>
      <Filters params={params}>
        <Input type="month" value={month} onChange={(e) => e.target.value && params.set({ month: e.target.value })} className="h-9 w-40" aria-label="Month" />
      </Filters>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <DayLegend />
        {!!data?.locked.length && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3.5" /> Payroll finalized: this month is closed
          </span>
        )}
      </div>
      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <ReportTable minWidth={1100} className={cn(isFetching && 'opacity-70')}>
          <thead className={theadClass}>
            <tr>
              <th className={th}>Employee</th>
              <th className={thNum} title="Days with punches (not Sundays)">
                Present
              </th>
              <th className={thNum} title="Sundays worked">
                Sun
              </th>
              <th className={thNum}>Leave</th>
              <th className={thNum}>Absent</th>
              <th className={thNum}>Hours</th>
              <th className={thNum} title="Hours worked minus present days x shift hours">
                +/−
              </th>
              <th className={th}>Days</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <EmptyRow cols={8}>No employees.</EmptyRow>}
            {data.rows.map((r) => (
              <tr key={r.employee.id} className="border-b align-middle last:border-0">
                <td className={cn(td, 'min-w-48')}>
                  <div className="font-medium">
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.employee.empCode}</span>
                    {r.employee.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[r.employee.department, `${r.shiftHours} h shift`].filter(Boolean).join(' · ')}
                    {r.missingPunchDays > 0 && <span className="ml-1 font-medium text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning">· {r.missingPunchDays} missing punch</span>}
                  </div>
                </td>
                <td className={cn(tdNum, 'font-semibold')}>{r.presentDays}</td>
                <td className={tdNum}>{r.sundaysWorked || '—'}</td>
                <td className={tdNum}>
                  {r.paidLeaveDays || '—'}
                  {r.lwpDays > 0 && <div className="text-xs text-destructive">{r.lwpDays} LWP</div>}
                </td>
                <td className={cn(tdNum, r.absentDays > 0 && 'text-destructive')}>{r.absentDays || '—'}</td>
                <td className={tdNum}>
                  {fmtHours(r.hoursWorked)}
                  <div className="text-xs text-muted-foreground">of {fmtHours(r.expectedHours)}</div>
                </td>
                <td className={cn(tdNum, r.hourDifference < 0 ? 'text-destructive' : r.hourDifference > 0 ? 'text-success' : '')}>{r.hourDifference ? fmtHours(r.hourDifference) : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-0.5">
                    {data.dates.map((d) => (
                      <DayCell
                        key={d}
                        date={d}
                        status={r.status[d]}
                        onClick={can('attendance.update') && !data.locked.includes(d) && r.status[d] !== '' ? () => setEditing({ employee: r.employee, date: d }) : undefined}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ReportTable>
      )}
      {editing && <EditDay employee={editing.employee} date={editing.date} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Loads one day's punches, then opens the editor. */
function EditDay({ employee, date, onClose }: { employee: { id: number; empCode: string; name: string }; date: string; onClose: () => void }) {
  const { data } = useApiQuery<AttendanceDay>('/attendance/day', { date, search: employee.empCode });
  const row = data?.rows.find((r) => r.employee.id === employee.id);
  if (!data) return null;
  return <PunchDialog employee={employee} date={date} punches={row?.punches ?? []} remarks={row?.remarks} onClose={onClose} />;
}

function DayView({ params }: { params: ReturnType<typeof useListParams> }) {
  const { can } = useSession();
  const date = params.filters.date || toInputDate(new Date());
  const { data, isFetching } = useApiQuery<AttendanceDay>('/attendance/day', { date, departmentId: params.filters.departmentId, search: params.search || undefined });
  const [editing, setEditing] = useState<AttendanceDay['rows'][number] | null>(null);
  const present = data?.rows.filter((r) => r.punches.length).length ?? 0;
  return (
    <>
      <Filters params={params}>
        <Input type="date" value={date} onChange={(e) => e.target.value && params.set({ date: e.target.value })} className="h-9 w-40" aria-label="Date" />
      </Filters>
      {data && (
        <p className="mb-2 text-sm text-muted-foreground">
          {fmtDate(date)}
          {data.isSunday && ' · Sunday (weekly off)'} · {present} of {data.rows.length} punched in
          {data.locked && (
            <span className="ml-2 inline-flex items-center gap-1">
              <Lock className="size-3.5" /> closed by payroll
            </span>
          )}
        </p>
      )}
      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <ReportTable minWidth={760} className={cn(isFetching && 'opacity-70')}>
          <thead className={theadClass}>
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Punches (IN · OUT)</th>
              <th className={thNum}>Hours</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <EmptyRow cols={5}>No employees.</EmptyRow>}
            {data.rows.map((r) => (
              <tr key={r.employee.id} className="border-b last:border-0">
                <td className={td}>
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.employee.empCode}</span>
                  <span className="font-medium">{r.employee.name}</span>
                </td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {r.punches.map((p, i) => (
                      <span key={i} className={cn('rounded px-1.5 py-0.5 font-mono text-xs', i % 2 === 0 ? 'bg-success/12 text-success' : 'bg-muted')}>
                        {p}
                      </span>
                    ))}
                    {!r.punches.length && <span className="text-muted-foreground">—</span>}
                  </div>
                  {r.source && r.source !== 'DEVICE' && <div className="mt-0.5 text-xs text-muted-foreground">{ATTENDANCE_SOURCE_LABELS[r.source]}{r.remarks ? `: ${r.remarks}` : ''}</div>}
                </td>
                <td className={tdNum}>
                  {r.punches.length ? fmtHours(r.hoursWorked) : '—'}
                  {r.punches.length > 0 && <div className="text-xs text-muted-foreground">of {fmtHours(r.shiftHours)}</div>}
                </td>
                <td className={td}>
                  {r.missingPunch ? (
                    <Badge variant="warning">Missing punch</Badge>
                  ) : r.punches.length ? (
                    <Badge variant="success">Present</Badge>
                  ) : r.leave ? (
                    <Badge variant="secondary">
                      {LEAVE_TYPE_LABELS[r.leave.type]}
                      {r.leave.isHalfDay && ' (half)'}
                    </Badge>
                  ) : data.isSunday ? (
                    <Badge variant="muted">Sunday</Badge>
                  ) : (
                    <Badge variant="destructive">Absent</Badge>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {can('attendance.update') && !data.locked && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Correct ${r.employee.name}`} onClick={() => setEditing(r)}>
                      <Pencil />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ReportTable>
      )}
      {editing && <PunchDialog employee={editing.employee} date={date} punches={editing.punches} remarks={editing.remarks} onClose={() => setEditing(null)} />}
    </>
  );
}

function Machines({ unknown }: { unknown: { empCode: string; punches: number; from: string; to: string }[] }) {
  const { can } = useSession();
  const { data } = useApiQuery<BiometricDevice[]>('/attendance/devices');
  const [names, setNames] = useState<Record<number, string>>({});
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; isApproved?: boolean }) => api(`/attendance/devices/${id}`, { method: 'PUT', body }),
    onSuccess: () => toast.success('Machine updated'),
    onError: (err) => showApiError(err),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/attendance/devices/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast.success('Machine removed'),
    onError: (err) => showApiError(err),
  });
  const host = typeof window === 'undefined' ? '' : window.location.host;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Biometric machines</CardTitle>
          <CardDescription>A machine appears here the first time it contacts the ERP. Approve it to accept its punches; until then it keeps them and sends them later.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data?.length === 0 && <p className="text-sm text-muted-foreground">No machine has contacted the ERP yet.</p>}
          {data?.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{d.serialNo}</span>
                  {d.isApproved ? <Badge variant="success">Approved</Badge> : <Badge variant="warning">Waiting for approval</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  Last contact {fmtAgo(d.lastSeenAt)}
                  {d.lastIp && ` from ${d.lastIp}`} · last punch {d.lastPunchAt ? fmtDateTime(d.lastPunchAt) : 'never'}
                </div>
              </div>
              {can('attendance.approve') ? (
                <>
                  <Input value={names[d.id] ?? d.name ?? ''} onChange={(e) => setNames({ ...names, [d.id]: e.target.value })} onBlur={() => names[d.id] !== undefined && names[d.id] !== (d.name ?? '') && update.mutate({ id: d.id, name: names[d.id] })} placeholder="Name (e.g. Main gate)" className="h-8 w-44" aria-label={`Name of ${d.serialNo}`} />
                  {d.isApproved ? (
                    <Button size="sm" variant="outline" onClick={() => update.mutate({ id: d.id, isApproved: false })}>
                      <Ban /> Block
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => update.mutate({ id: d.id, isApproved: true })}>
                      <Check /> Approve
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${d.serialNo}`} onClick={() => remove.mutate(d.id)}>
                    <Trash2 />
                  </Button>
                </>
              ) : (
                d.name && <span className="text-sm">{d.name}</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Connect a machine</CardTitle>
            <CardDescription>eSSL / ZKTeco machines with “ADMS” / cloud server push.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1.5 pl-4 text-sm">
              <li>
                On the machine: <span className="font-medium">Comm. → Cloud Server Setting</span> (ADMS).
              </li>
              <li>
                Server address: <span className="font-mono">{host.split(':')[0] || 'your ERP address'}</span>, port <span className="font-mono">{host.split(':')[1] || '443'}</span> (HTTPS on if the ERP uses https).
              </li>
              <li>The machine shows up here as “waiting”: approve it.</li>
              <li>Users on the machine must have the same number as the employee code.</li>
            </ol>
          </CardContent>
        </Card>
        {unknown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Unknown codes</CardTitle>
              <CardDescription>Punches kept aside until an employee with the code is added.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {unknown.map((u) => (
                  <li key={u.empCode} className="flex justify-between py-1.5">
                    <span className="font-mono font-semibold">{u.empCode}</span>
                    <span className="text-muted-foreground">
                      {u.punches} punches · {fmtDate(u.from)} – {fmtDate(u.to)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
