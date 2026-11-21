'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileUp, Plus, X } from 'lucide-react';
import { fmtHours, pairHours } from '@bht/shared';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { showApiError } from '@/hooks/use-api';
import type { AttendancePreview, DayStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Label } from '@/components/ui/primitives';

/** What each day cell shows. Colour is never the only signal: every cell has a letter. */
export const DAY_STATUS: Record<Exclude<DayStatus, ''>, { letter: string; label: string; cls: string }> = {
  P: { letter: 'P', label: 'Present', cls: 'bg-success/15 text-success' },
  M: { letter: 'M', label: 'Missing punch', cls: 'bg-warning/20 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning' },
  A: { letter: 'A', label: 'Absent', cls: 'bg-destructive/12 text-destructive' },
  S: { letter: 'S', label: 'Sunday', cls: 'bg-muted text-muted-foreground' },
  SW: { letter: 'S', label: 'Worked on Sunday', cls: 'bg-info/15 text-info ring-1 ring-info/40' },
  CL: { letter: 'CL', label: 'Casual leave', cls: 'bg-secondary text-secondary-foreground' },
  SL: { letter: 'SL', label: 'Sick leave', cls: 'bg-secondary text-secondary-foreground' },
  EL: { letter: 'EL', label: 'Earned leave', cls: 'bg-secondary text-secondary-foreground' },
  LWP: { letter: 'LW', label: 'Leave without pay', cls: 'bg-destructive/8 text-destructive' },
};

export function DayCell({ status, date, onClick }: { status: DayStatus; date: string; onClick?: () => void }) {
  const s = status ? DAY_STATUS[status] : null;
  const cls = cn('flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold', s ? s.cls : 'text-muted-foreground/40');
  const title = `${fmtDate(date)}: ${s?.label ?? 'not counted'}`;
  return onClick ? (
    <button type="button" className={cn(cls, 'hover:ring-2 hover:ring-ring/40')} title={title} aria-label={title} onClick={onClick}>
      {s?.letter ?? '·'}
    </button>
  ) : (
    <span className={cls} title={title}>
      {s?.letter ?? '·'}
    </span>
  );
}

export function DayLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {(['P', 'M', 'A', 'S', 'SW', 'CL', 'LWP'] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <DayCell status={k} date="" />
          {DAY_STATUS[k].label}
        </span>
      ))}
    </div>
  );
}

/** Correct one employee's punches for one day (forgot to punch out, machine was down ...). */
export function PunchDialog({
  employee,
  date,
  punches: initial,
  remarks: initialRemarks,
  onClose,
}: {
  employee: { id: number; empCode: string; name: string };
  date: string;
  punches: string[];
  remarks?: string | null;
  onClose: () => void;
}) {
  const [punches, setPunches] = useState<string[]>(initial.length ? initial : ['', '']);
  const [remarks, setRemarks] = useState(initialRemarks ?? '');
  const filled = punches.filter((p) => /^\d{2}:\d{2}$/.test(p)).sort();
  const { hours, missingPunch } = pairHours(filled);
  const save = useMutation({
    mutationFn: () => api('/attendance/day', { method: 'PUT', body: { employeeId: employee.id, date, punches: filled, remarks } }),
    onSuccess: () => {
      toast.success(filled.length ? `Attendance of ${employee.name} saved` : `Attendance of ${employee.name} removed`);
      onClose();
    },
    onError: (err) => showApiError(err),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {employee.empCode} · {employee.name}
          </DialogTitle>
          <DialogDescription>{fmtDate(date)} — punches are taken in pairs: IN, OUT, IN, OUT …</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {punches.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Label className="w-10 text-xs text-muted-foreground" htmlFor={`punch-${i}`}>
                {i % 2 === 0 ? 'IN' : 'OUT'}
              </Label>
              <Input id={`punch-${i}`} type="time" value={p} onChange={(e) => setPunches(punches.map((x, j) => (j === i ? e.target.value : x)))} className="h-9" aria-label={`Punch ${i + 1}`} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove punch ${i + 1}`} onClick={() => setPunches(punches.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" disabled={punches.length >= 12} onClick={() => setPunches([...punches, ''])}>
            <Plus /> Add punch
          </Button>
          <span className="text-sm">
            Hours: <span className="font-semibold">{fmtHours(hours)}</span>
            {missingPunch && <Badge variant="warning" className="ml-2">One punch has no pair</Badge>}
          </span>
        </div>
        <div>
          <Label htmlFor="punch-remarks" className="text-sm">
            Reason for the correction
          </Label>
          <Input id="punch-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Forgot to punch out" className="mt-1" maxLength={255} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {filled.length ? 'Save punches' : 'Remove the day'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Upload the CSV exported from the machine software, check it, then import the good rows. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<AttendancePreview | null>(null);
  const [fileName, setFileName] = useState('');
  const check = useMutation({
    mutationFn: (csv: string) => api<AttendancePreview>('/attendance/import/preview', { method: 'POST', body: { csv } }),
    onSuccess: setPreview,
    onError: (err) => showApiError(err),
  });
  const run = useMutation({
    mutationFn: () =>
      api<{ added: number; unknown: number; locked: number }>('/attendance/import', {
        method: 'POST',
        body: { rows: preview!.rows.filter((r) => r.status === 'READY').map((r) => ({ empCode: r.empCode, date: r.date, punches: r.punches })) },
      }),
    onSuccess: (r) => {
      toast.success(`${r.added} punches imported`);
      onClose();
    },
    onError: (err) => showApiError(err),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import attendance from the machine</DialogTitle>
          <DialogDescription>CSV from the machine software: employee code, name, date, punch times …, total hours. Punches already in the ERP are not added twice.</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm hover:bg-muted/40">
          <FileUp className="size-5 text-muted-foreground" />
          <span className="flex-1">{fileName || 'Choose the CSV file'}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Attendance CSV file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setPreview(null);
              check.mutate(await f.text());
            }}
          />
        </label>
        {check.isPending && <p className="text-sm text-muted-foreground">Reading the file…</p>}
        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="success">{preview.ready} ready</Badge>
              {preview.unknown > 0 && <Badge variant="warning">{preview.unknown} unknown code</Badge>}
              {preview.locked > 0 && <Badge variant="muted">{preview.locked} in a closed payroll month</Badge>}
              {preview.skipped > 0 && <Badge variant="muted">{preview.skipped} lines without punches skipped</Badge>}
            </div>
            <div className="max-h-80 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Punches</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{r.empCode}</td>
                      <td className="px-3 py-1.5">{r.employee?.name ?? r.name}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.punches.join(' ')}</td>
                      <td className="tabular px-3 py-1.5 text-right">{fmtHours(pairHours(r.punches).hours)}</td>
                      <td className="px-3 py-1.5">
                        {r.status === 'READY' ? <Badge variant="success">Ready</Badge> : r.status === 'UNKNOWN' ? <Badge variant="warning">No such employee</Badge> : <Badge variant="muted">Month closed</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => run.mutate()} disabled={!preview?.ready} loading={run.isPending}>
            Import {preview?.ready ?? 0} row(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
