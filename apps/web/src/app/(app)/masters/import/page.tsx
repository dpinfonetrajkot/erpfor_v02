'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Boxes, Building2, CircleCheck, Component, Download, FileSpreadsheet, FileUp, Flame, Package, RotateCcw, TriangleAlert, Truck, type LucideIcon } from 'lucide-react';
import {
  IMPORT_MAX_MB,
  IMPORT_MAX_ROWS,
  IMPORT_TYPE_INFO,
  IMPORT_TYPES,
  type ImportCheck,
  type ImportMode,
  type ImportResult,
  type ImportRowStatus,
  type ImportType,
} from '@bht/shared';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fmtDateTime } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlays';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { EmptyRow, ReportTable, td, th, theadClass } from '@/components/reports/report-kit';

const ICONS: Record<ImportType, LucideIcon> = {
  customers: Building2,
  suppliers: Truck,
  products: Package,
  raw_materials: Boxes,
  rm_stock: Flame,
  fg_stock: Component,
};

const STATUS: Record<ImportRowStatus, { label: string; badge: 'success' | 'info' | 'muted' | 'destructive' }> = {
  new: { label: 'New', badge: 'success' },
  update: { label: 'Update', badge: 'info' },
  same: { label: 'No change', badge: 'muted' },
  skip: { label: 'Already in ERP', badge: 'muted' },
  error: { label: 'Problem', badge: 'destructive' },
};

type Filter = 'all' | ImportRowStatus | 'warned';

/** Rows shown at once; the rest are counted. */
const SHOW = 500;

const STOCK_TYPES: ImportType[] = ['rm_stock', 'fg_stock'];
const ALL_PERMISSIONS = [...new Set(Object.values(IMPORT_TYPE_INFO).map((i) => i.permissions[0]))];

const errorText = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.');
const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;

export default function ImportPage() {
  return (
    <RequirePermission permission={ALL_PERMISSIONS}>
      <ExcelImport />
    </RequirePermission>
  );
}

function ExcelImport() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const params = useListParams();
  const allowed = IMPORT_TYPES.filter((t) => IMPORT_TYPE_INFO[t].permissions.every(can));
  const type = (allowed as string[]).includes(params.filters.type ?? '') ? (params.filters.type as ImportType) : allowed[0];
  const info = type ? IMPORT_TYPE_INFO[type] : null;
  const isStock = !!type && STOCK_TYPES.includes(type);
  const canUpdate = !!info?.updatePermission && can(info.updatePermission);

  const [mode, setMode] = useState<ImportMode>('skip');
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  // another kind of import starts clean
  useEffect(() => {
    setFile(null);
    setCheck(null);
    setDone(null);
    setMode('skip');
    setFilter('all');
  }, [type]);

  const runCheck = async (f: File, m: ImportMode) => {
    if (!type) return;
    setChecking(true);
    setCheck(null);
    setDone(null);
    setFilter('all');
    try {
      const body = new FormData();
      body.append('file', f);
      setCheck(await api<ImportCheck>(`/imports/${type}/check`, { method: 'POST', body, query: { mode: m } }));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    if (f.size > IMPORT_MAX_MB * 1024 * 1024) return toast.error(`The file is bigger than ${IMPORT_MAX_MB} MB. Please split it into smaller files.`);
    setFile(f);
    void runCheck(f, mode);
  };

  const changeMode = (m: ImportMode) => {
    setMode(m);
    if (file) void runCheck(file, m);
  };

  const downloadTemplate = async () => {
    if (!type) return;
    try {
      await api('/auth/me'); // renews the login first if needed
    } catch (err) {
      return toast.error(errorText(err));
    }
    const link = document.createElement('a');
    link.href = `/api/imports/${type}/template`;
    document.body.append(link);
    link.click();
    link.remove();
  };

  const runImport = async () => {
    if (!type || !file) return;
    setConfirmAgain(false);
    setImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await api<ImportResult>(`/imports/${type}`, { method: 'POST', body, query: { mode } });
      setDone(result);
      setCheck(null);
      setFile(null);
      toast.success(`Import finished: ${result.summary}`);
      void queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setImporting(false);
    }
  };

  const toImport = check ? check.counts.new + check.counts.update : 0;
  const shown = useMemo(() => {
    if (!check) return [];
    if (filter === 'all') return check.rows;
    if (filter === 'warned') return check.rows.filter((r) => r.warnings.length && r.status !== 'error');
    return check.rows.filter((r) => r.status === filter);
  }, [check, filter]);

  if (!type || !info) return null;
  const Icon = ICONS[type];

  return (
    <>
      <PageHeader
        title="Import from Excel"
        description="Load customers, suppliers, products, raw materials and opening stock from an Excel file. Every row is checked and shown to you before anything is saved."
      />

      <div className="space-y-5">
        <Card className="p-5">
          <h2 className="text-base font-semibold">1. What do you want to import?</h2>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="What to import">
            {allowed.map((t) => {
              const TIcon = ICONS[t];
              const on = t === type;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => params.set({ type: t })}
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    on ? 'border-ink bg-ink/5 ring-1 ring-ink' : 'hover:bg-muted/50',
                  )}
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', on ? 'bg-ink text-ink-foreground' : 'bg-muted text-muted-foreground')}>
                    <TIcon className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{IMPORT_TYPE_INFO[t].label}</span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">{IMPORT_TYPE_INFO[t].description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold">2. Download the template and fill it</h2>
            <p className="text-sm text-muted-foreground">
              One {info.rowNoun} per row. Columns with <b className="text-foreground">*</b> are needed; the others can stay empty. The <b className="text-foreground">Help</b> sheet in the file explains every column, and the
              columns with fixed values have drop-down lists.
            </p>
            {isStock ? (
              <p className="flex items-start gap-2 rounded-xl bg-warning/15 px-3 py-2 text-[13px] text-[color-mix(in_oklch,var(--warning),black_40%)] dark:text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {type === 'rm_stock'
                    ? 'Import the raw materials (and suppliers) first. Import each stock file once only: importing it again adds the stock again.'
                    : 'Import the products with “Make items for” filled first, so the items are there. Import each stock file once only: importing it again adds the stock again.'}
                </span>
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">You can also use your own Excel or CSV file: columns are found by their headings (for example “GST No”, “Mobile” or “Credit days” work too).</p>
            )}
            <div className="mt-auto">
              <Button type="button" variant="outline" onClick={() => void downloadTemplate()}>
                <Download /> Download template
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold">3. Upload the filled file</h2>
            <label
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-4 py-4 text-sm transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring',
                checking && 'pointer-events-none opacity-60',
              )}
            >
              <FileUp className="size-6 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{file ? file.name : 'Choose the Excel (.xlsx) or CSV file'}</span>
                <span className="block text-xs text-muted-foreground">
                  {checking ? 'Checking every row…' : file ? 'Click to choose another file (for example after fixing it in Excel)' : `Up to ${IMPORT_MAX_MB} MB and ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows`}
                </span>
              </span>
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="sr-only"
                aria-label="Excel or CSV file to import"
                onChange={(e) => {
                  choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {canUpdate && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-sm font-medium">If a {info.rowNoun} is already in the ERP:</legend>
                {(
                  [
                    ['skip', 'Leave it as it is', 'Only new ones are added.'],
                    ['update', 'Update it from the filled cells', 'Empty cells never wipe out what is in the ERP.'],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => changeMode(value)} disabled={checking} className="mt-1 size-4 accent-[var(--ink)]" />
                    <span>
                      {label} <span className="text-muted-foreground">· {hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </Card>
        </div>

        {done && (
          <Card className="border-success/40 p-5">
            <div className="flex flex-wrap items-start gap-3">
              <CircleCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">Import finished</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {info.label}: {done.summary}.
                </p>
                {done.failed > 0 && <p className="mt-1 text-sm text-muted-foreground">Fix the rows with problems in Excel and upload the file again: rows already imported are not added twice.</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href={info.href}>
                    {isStock ? 'Open stock' : `Open ${info.label}`} <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        )}

        {check && check.columns.missing.length > 0 && (
          <Card className="border-destructive/40 p-5">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="text-sm">
                <h2 className="text-base font-semibold">Some needed columns are missing</h2>
                <p className="mt-1">
                  The sheet “{check.sheet}” has no column for: <b>{check.columns.missing.join(', ')}</b>.
                </p>
                <p className="mt-1 text-muted-foreground">Download the template above and copy your data into it, or rename your column headings to match.</p>
                {check.columns.used.length > 0 && <p className="mt-2 text-muted-foreground">Columns found: {check.columns.used.join(', ')}.</p>}
              </div>
            </div>
          </Card>
        )}

        {check && !check.columns.missing.length && (
          <>
            {check.importedBefore && (
              <Card className="border-warning/50 p-4">
                <div className="flex items-start gap-2.5 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <p>
                    <b>This same file was imported before</b>, {fmtDateTime(check.importedBefore.at)}
                    {check.importedBefore.by ? ` by ${check.importedBefore.by}` : ''}.{' '}
                    {isStock ? 'Importing it again adds the stock again.' : 'Rows already in the ERP are not added twice.'}
                  </p>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <FileSpreadsheet className="size-[18px] text-muted-foreground" aria-hidden /> {check.fileName}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Sheet “{check.sheet}” · {plural(check.rows.length, 'row')} checked · nothing saved yet
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => file && void runCheck(file, mode)} disabled={checking || !file}>
                  <RotateCcw /> Check again
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show rows">
                {(
                  [
                    ['all', `All ${check.rows.length}`],
                    ['new', `New ${check.counts.new}`],
                    ['update', `Update ${check.counts.update}`],
                    ['same', `No change ${check.counts.same}`],
                    ['skip', `Already in ERP ${check.counts.skip}`],
                    ['error', `Problems ${check.counts.error}`],
                    ['warned', `Warnings ${check.warned}`],
                  ] as [Filter, string][]
                )
                  .filter(([f]) => f === 'all' || (f === 'warned' ? check.warned : check.counts[f as ImportRowStatus]) > 0)
                  .map(([f, label]) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        'inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
                        filter === f ? 'border-ink bg-ink text-ink-foreground' : 'text-muted-foreground hover:bg-muted',
                        f === 'error' && filter !== f && 'border-destructive/40 text-destructive',
                      )}
                    >
                      {label}
                    </button>
                  ))}
              </div>

              {(check.willCreate.length > 0 || check.columns.ignored.length > 0) && (
                <div className="mt-3 space-y-1 text-[13px] text-muted-foreground">
                  {check.willCreate.length > 0 && <p>Also made on the way: {check.willCreate.join(' · ')}.</p>}
                  {check.columns.ignored.length > 0 && <p>Columns not used: {check.columns.ignored.join(', ')}.</p>}
                </div>
              )}
            </Card>

            {/* on phones the status and notes go under the name, so nothing is hidden off the side */}
            <ReportTable minWidth={0}>
              <thead className={theadClass}>
                <tr>
                  <th className={cn(th, 'w-12 sm:w-16')}>Row</th>
                  <th className={th}>{info.rowNoun.charAt(0).toUpperCase() + info.rowNoun.slice(1)}</th>
                  <th className={cn(th, 'hidden w-32 sm:table-cell')}>Status</th>
                  <th className={cn(th, 'hidden sm:table-cell')}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && <EmptyRow cols={4}>No rows here.</EmptyRow>}
                {shown.slice(0, SHOW).map((r) => (
                  <tr key={r.row} className={cn('border-b align-top last:border-0', r.status === 'error' && 'bg-destructive/4')}>
                    <td className={cn(td, 'tabular text-muted-foreground')}>{r.row}</td>
                    <td className={cn(td, 'font-medium break-words')}>
                      {r.label}
                      <div className="mt-1.5 space-y-1 font-normal sm:hidden">
                        <Badge variant={STATUS[r.status].badge}>{STATUS[r.status].label}</Badge>
                        <RowNotes notes={r.notes} warnings={r.warnings} problem={r.status === 'error'} />
                      </div>
                    </td>
                    <td className={cn(td, 'hidden sm:table-cell')}>
                      <Badge variant={STATUS[r.status].badge}>{STATUS[r.status].label}</Badge>
                    </td>
                    <td className={cn(td, 'hidden sm:table-cell')}>
                      <RowNotes notes={r.notes} warnings={r.warnings} problem={r.status === 'error'} />
                    </td>
                  </tr>
                ))}
                {shown.length > SHOW && <EmptyRow cols={4}>…and {plural(shown.length - SHOW, 'more row')}.</EmptyRow>}
              </tbody>
            </ReportTable>

            <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
              <div className="min-w-0 flex-1 text-sm">
                {toImport > 0 ? (
                  <>
                    <p className="font-semibold">
                      Ready: {check.counts.new > 0 && `${plural(check.counts.new, 'new ' + info.rowNoun)}`}
                      {check.counts.new > 0 && check.counts.update > 0 && ' and '}
                      {check.counts.update > 0 && `${check.counts.update.toLocaleString('en-IN')} to update`}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {check.counts.error > 0
                        ? `${plural(check.counts.error, 'row')} with problems will be left out: fix them in Excel and upload again later.`
                        : 'Everything is saved together; if the database refuses one row, nothing is saved.'}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Nothing to import: {check.counts.error ? 'fix the rows with problems in Excel and choose the file again.' : `every ${info.rowNoun} is already in the ERP.`}
                  </p>
                )}
              </div>
              <Button type="button" onClick={() => (check.importedBefore && isStock ? setConfirmAgain(true) : void runImport())} disabled={!toImport || checking} loading={importing}>
                <Icon /> Import {plural(toImport, 'row')}
              </Button>
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmAgain}
        onOpenChange={setConfirmAgain}
        title="Import this stock file again?"
        description="This same file was imported before. Importing it again adds the stock a second time. Continue only if that is what you want."
        confirmLabel="Import again"
        loading={importing}
        onConfirm={() => void runImport()}
      />
    </>
  );
}

/** What will happen to a row (or why it cannot be imported), and its warnings. */
function RowNotes({ notes, warnings, problem }: { notes: string[]; warnings: string[]; problem: boolean }) {
  return (
    <ul className="space-y-0.5 text-[13px]">
      {notes.map((n) => (
        <li key={n} className={problem ? 'text-destructive' : 'text-muted-foreground'}>
          {n}
        </li>
      ))}
      {warnings.map((w) => (
        <li key={w} className="flex items-start gap-1.5 text-[color-mix(in_oklch,var(--warning),black_40%)] dark:text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
        </li>
      ))}
    </ul>
  );
}
