'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Check, DatabaseBackup, Download, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { BACKUP_KEEP_DAYS, type BackupFile, type BackupOverview, type BackupRun, type BackupSettings } from '@bht/shared';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fmtAgo, fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Skeleton, Switch } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Row, Section } from './settings-section';

const PATH = '/settings/backups';
const KEY = [PATH, {}];

const errorText = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.');
const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Tomorrow at 02:00", "Today at 14:30", or "Starting in a few minutes" when it is due. */
function nextText(iso: string | null): string {
  if (!iso) return 'Off';
  const at = new Date(iso);
  const now = new Date();
  if (at <= now) return 'Starting in a few minutes';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(at, now)) return `Today at ${format(at, 'HH:mm')}`;
  if (sameDay(at, tomorrow)) return `Tomorrow at ${format(at, 'HH:mm')}`;
  return fmtDateTime(at);
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' }) {
  return (
    <div className={cn('rounded-2xl border px-4 py-3', tone === 'bad' && 'border-destructive/35 bg-destructive/6')}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 font-semibold', tone === 'bad' && 'text-destructive')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Settings → Backups (admins): status, the daily rule, "Back up now" and the saved files. */
export function BackupsSection() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api<BackupOverview>(PATH),
    // while a backup is being made (e.g. the automatic one), look again every few seconds
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const data = query.data;
  const [draft, setDraft] = useState<BackupSettings | null>(null);
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<BackupFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const settings = draft ?? data?.settings;
  const changed = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.settings);
  const edit = (change: Partial<BackupSettings>) => settings && setDraft({ ...settings, ...change });

  const backupNow = async () => {
    setMaking(true);
    try {
      const run = await api<BackupRun>(PATH, { method: 'POST' });
      if (run.ok) toast.success(`Backup made: ${fmtSize(run.sizeBytes ?? 0)}, ${run.tables} tables, ${run.rows?.toLocaleString('en-IN')} rows`);
      else toast.error(`Backup failed: ${run.message}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMaking(false);
      void query.refetch();
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      queryClient.setQueryData(KEY, await api<BackupOverview>(`${PATH}/settings`, { method: 'PUT', body: draft }));
      setDraft(null);
      toast.success(draft.enabled ? `Saved: a backup every day at ${draft.time}` : 'Saved: automatic backup is off');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const download = async (file: BackupFile) => {
    try {
      await api(PATH); // renews the login first if it has expired, so the download link works
    } catch (err) {
      return toast.error(errorText(err));
    }
    const link = document.createElement('a');
    link.href = `/api${PATH}/${encodeURIComponent(file.name)}/download`;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`${PATH}/${encodeURIComponent(toDelete.name)}`, { method: 'DELETE' });
      toast.success('Backup deleted');
      setToDelete(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setDeleting(false);
      void query.refetch();
    }
  };

  const busy = making || !!data?.running;
  const newest = data?.files[0];
  const failed = data?.lastRun && !data.lastRun.ok ? data.lastRun : null;

  return (
    <Section
      id="backups"
      title="Backups"
      description="A full copy of all ERP data, made automatically every day."
      icon={DatabaseBackup}
      action={
        <Button type="button" onClick={() => void backupNow()} disabled={!data || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <DatabaseBackup />} {busy ? 'Backing up…' : 'Back up now'}
        </Button>
      }
    >
      {!data || !settings ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label="Last backup" value={newest ? fmtAgo(newest.createdAt) : 'None yet'} sub={newest ? `${fmtDateTime(newest.createdAt)} · ${fmtSize(newest.sizeBytes)}` : 'Press Back up now to make the first one'} />
            <Tile label="Next automatic backup" value={nextText(data.nextRunAt)} sub={data.settings.enabled ? `Every day at ${data.settings.time}` : 'Turned off below'} />
            <Tile label="Saved on the server" value={`${data.files.length} backup${data.files.length === 1 ? '' : 's'}`} sub={`${fmtSize(data.totalBytes)} · kept ${data.settings.keepDays} days`} />
          </div>

          {failed && (
            <div role="alert" className="flex gap-3 rounded-2xl border border-destructive/35 bg-destructive/6 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">The last {failed.kind === 'auto' ? 'automatic ' : ''}backup failed ({fmtDateTime(failed.at)})</div>
                <div className="mt-0.5 text-muted-foreground">{failed.message}</div>
                {failed.kind === 'auto' && <div className="mt-0.5 text-xs text-muted-foreground">It is tried again in 2 hours. Back up now to try at once.</div>}
              </div>
            </div>
          )}

          <Row label="Automatic backup" hint="One full copy every day.">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={settings.enabled} onCheckedChange={(c) => edit({ enabled: c })} aria-label="Make a backup every day" />
              Make a backup every day
            </label>
          </Row>
          <Row label="Time" hint="Server time. Pick a quiet time, like 2 at night.">
            <Input type="time" value={settings.time} onChange={(e) => e.target.value && edit({ time: e.target.value })} disabled={!settings.enabled} className="max-w-[150px]" aria-label="Backup time" />
          </Row>
          <Row label="Keep backups for" hint="Older ones are deleted after each new backup. The newest one always stays.">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Keep backups for">
              {[...new Set([...BACKUP_KEEP_DAYS, settings.keepDays])].sort((a, b) => a - b).map((days) => {
                const on = settings.keepDays === days;
                return (
                  <button
                    key={days}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => edit({ keepDays: days })}
                    className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors', on ? 'border-ink bg-ink text-ink-foreground' : 'hover:bg-muted')}
                  >
                    {on && <Check className="size-3.5" strokeWidth={3} />} {days} days
                  </button>
                );
              })}
            </div>
          </Row>
          {changed && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void save()} loading={saving}>
                Save backup settings
              </Button>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Saved backups</h3>
              <span className="text-xs text-muted-foreground">Newest first</span>
            </div>
            {data.files.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No backups yet. {data.settings.enabled ? `The first one is made at ${data.settings.time}, or press Back up now.` : 'Press Back up now to make one.'}
              </div>
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border">
                {data.files.map((f, i) => (
                  <li key={f.name} className="flex items-center gap-3 px-4 py-2.5">
                    <DatabaseBackup className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        <span className="whitespace-nowrap">{fmtDateTime(f.createdAt)}</span>
                        <Badge variant={f.kind === 'auto' ? 'muted' : 'info'}>{f.kind === 'auto' ? 'Automatic' : 'Manual'}</Badge>
                        {i === 0 && <Badge variant="success">Newest</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {fmtSize(f.sizeBytes)} · {f.name}
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="max-sm:size-9 max-sm:px-0" onClick={() => void download(f)} aria-label={`Download the backup of ${fmtDateTime(f.createdAt)}`}>
                      <Download /> <span className="max-sm:hidden">Download</span>
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setToDelete(f)} aria-label={`Delete the backup of ${fmtDateTime(f.createdAt)}`}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5 rounded-2xl bg-muted/60 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">Keep a copy off the server.</strong> Once a week, download the newest backup and save it on your computer or Google Drive. Then your data is safe even if the server has a problem.
            </p>
            <p>
              <strong className="text-foreground">To restore:</strong> open phpMyAdmin, choose the database, open Import and choose the .sql.gz file. Try it on a new, empty database first. It replaces every table with the saved copy.
            </p>
            <p className="break-all text-xs">Folder on the server: {data.folder}</p>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this backup?"
        description={toDelete ? `The backup of ${fmtDateTime(toDelete.createdAt)} (${fmtSize(toDelete.sizeBytes)}) is removed from the server. This cannot be undone.` : ''}
        confirmLabel="Delete backup"
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </Section>
  );
}
