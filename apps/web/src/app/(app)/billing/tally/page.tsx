'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, Download, FileOutput, History, ListChecks, RotateCcw, Settings2 } from 'lucide-react';
import {
  DEFAULT_TALLY_SETTINGS,
  TALLY_LEDGERS,
  TALLY_VOUCHER_TYPES,
  type TallyPreview,
  type TallySettings,
  type TallyVoucherKind,
} from '@bht/shared';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useApiQuery } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Company } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Badge, Card, Label, Skeleton } from '@/components/ui/primitives';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { EmptyRow, FilterBar, PeriodPicker, ReportTable, StatRow, StatTile, td, tdNum, th, theadClass, thNum, usePeriod } from '@/components/reports/report-kit';

const KINDS: { kind: TallyVoucherKind; param: 'sales' | 'purchases' | 'receipts' | 'payments'; label: string; badge: 'success' | 'info' | 'muted' | 'warning' }[] = [
  { kind: 'Sales', param: 'sales', label: 'Sales invoices', badge: 'success' },
  { kind: 'Purchase', param: 'purchases', label: 'Purchases', badge: 'muted' },
  { kind: 'Receipt', param: 'receipts', label: 'Money received', badge: 'info' },
  { kind: 'Payment', param: 'payments', label: 'Money paid', badge: 'warning' },
];

const errorText = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.');

export default function TallyExportPage() {
  return (
    <RequirePermission permission="tally.export">
      <TallyExport />
    </RequirePermission>
  );
}

function TallyExport() {
  const params = useListParams();
  const { from, to } = usePeriod(params, 'last_month');
  const companies = useApiQuery<Company[]>('/settings/companies');
  const active = (companies.data ?? []).filter((c) => c.isActive);
  const companyId = params.filters.companyId ?? String((active.find((c) => c.isDefault) ?? active[0])?.id ?? '');
  const include = Object.fromEntries(KINDS.map((k) => [k.param, params.filters[k.param] !== 'false'])) as Record<(typeof KINDS)[number]['param'], boolean>;
  const query = { companyId, from, to, ...Object.fromEntries(Object.entries(include).map(([k, v]) => [k, String(v)])) };
  const preview = useApiQuery<TallyPreview>('/tally/preview', query, !!companyId && Object.values(include).some(Boolean));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const data = preview.data;
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;

  const download = async (part: 'ledgers' | 'vouchers') => {
    try {
      await api('/tally/preview', { query }); // renews the login first if needed, and shows any problem as a message
    } catch (err) {
      return toast.error(errorText(err));
    }
    const link = document.createElement('a');
    link.href = `/api/tally/export/${part}?${new URLSearchParams(query).toString()}`;
    document.body.append(link);
    link.click();
    link.remove();
    if (part === 'vouchers') setTimeout(() => void preview.refetch(), 1500); // shows the new "last export"
  };

  return (
    <>
      <PageHeader
        title="Tally export"
        description="Sales invoices, purchases and payments as files for TallyPrime or Tally.ERP 9. Nothing in the ERP changes."
        actions={
          <Button type="button" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 /> Tally ledger names
          </Button>
        }
      />

      <FilterBar>
        <PeriodPicker params={params} initial="last_month" />
        {active.length > 1 && (
          <NativeSelect value={companyId} onChange={(e) => params.set({ companyId: e.target.value })} className="h-9 w-auto min-w-44" aria-label="Company">
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </FilterBar>
      <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="What to export">
        <span className="mr-1 text-sm text-muted-foreground">Include:</span>
        {KINDS.map((k) => {
          const on = include[k.param];
          return (
            <button
              key={k.param}
              type="button"
              aria-pressed={on}
              onClick={() => params.set({ [k.param]: on ? 'false' : undefined })}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors', on ? 'border-ink bg-ink text-ink-foreground' : 'text-muted-foreground hover:bg-muted')}
            >
              {on && <Check className="size-3.5" strokeWidth={3} />} {k.label}
            </button>
          );
        })}
      </div>

      {!Object.values(include).some(Boolean) ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Choose at least one kind of entry above.</Card>
      ) : !data ? (
        preview.error ? (
          <Card className="p-8 text-center text-sm text-destructive">{errorText(preview.error)}</Card>
        ) : (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )
      ) : (
        <div className={cn('space-y-5 transition-opacity', preview.isFetching && 'opacity-60')}>
          <StatRow>
            {KINDS.map((k) => (
              <StatTile
                key={k.kind}
                label={k.label}
                value={include[k.param] ? fmtMoney(data.totals[k.kind]) : '—'}
                sub={include[k.param] ? `${data.counts[k.kind]} ${data.counts[k.kind] === 1 ? 'entry' : 'entries'}` : 'Not included'}
              />
            ))}
          </StatRow>

          {data.warnings.length > 0 && (
            <Card className="border-warning/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 text-warning" /> Please note
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-muted-foreground">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Download for Tally</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {data.company.name} · {fmtDate(data.from)} – {fmtDate(data.to)}
                </p>
              </div>
              {data.lastExport && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <History className="size-3.5" />
                  Last export: {data.lastExport.company} {fmtDate(data.lastExport.from)} – {fmtDate(data.lastExport.to)}, {data.lastExport.vouchers} entries, {fmtDateTime(data.lastExport.at)} by {data.lastExport.by}
                </p>
              )}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Step n={1} title="Ledgers file" text={`${data.ledgers} ledgers: the customers, suppliers and accounts these entries use. Import it first. Ledgers already in Tally stay as they are.`}>
                <Button type="button" variant="outline" disabled={!total} onClick={() => void download('ledgers')}>
                  <Download /> Download ledgers
                </Button>
              </Step>
              <Step n={2} title="Entries file" text={`${total} ${total === 1 ? 'entry' : 'entries'} (vouchers). Import each period only once: importing the same file again adds the entries twice.`}>
                <Button type="button" disabled={!total} onClick={() => void download('vouchers')}>
                  <FileOutput /> Download entries
                </Button>
              </Step>
            </div>
            <HowTo />
          </Card>

          <ReportTable title={`Entries in the file${data.moreRows ? ` (first ${data.rows.length} shown)` : ''}`} minWidth={720}>
            <thead className={theadClass}>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Type</th>
                <th className={th}>Number</th>
                <th className={th}>Party</th>
                <th className={th}>Against</th>
                <th className={thNum}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && <EmptyRow cols={6}>Nothing to export for this company and period.</EmptyRow>}
              {data.rows.map((r) => (
                <tr key={`${r.kind}-${r.number}`} className="border-b last:border-0">
                  <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(r.date)}</td>
                  <td className={td}>
                    <Badge variant={KINDS.find((k) => k.kind === r.kind)!.badge}>{r.kind}</Badge>
                  </td>
                  <td className={cn(td, 'font-medium whitespace-nowrap')}>{r.number}</td>
                  <td className={td}>{r.party}</td>
                  <td className={cn(td, 'text-muted-foreground')}>{r.reference ?? '—'}</td>
                  <td className={tdNum}>{fmtMoney(r.amount)}</td>
                </tr>
              ))}
              {data.moreRows > 0 && <EmptyRow cols={6}>…and {data.moreRows} more in the file.</EmptyRow>}
            </tbody>
          </ReportTable>
        </div>
      )}

      <LedgerNames open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={() => void preview.refetch()} />
    </>
  );
}

function Step({ n, title, text, children }: { n: number; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border px-4 py-3.5">
      <div className="flex gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-ink-foreground">{n}</span>
        <div>
          <div className="font-semibold">{title}</div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{text}</p>
        </div>
      </div>
      <div className="pl-10">{children}</div>
    </div>
  );
}

function HowTo() {
  return (
    <details className="group mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-foreground">
        <ListChecks className="size-4" /> How to import in Tally
      </summary>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <div>
          <div className="font-semibold text-foreground">TallyPrime</div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Back up your Tally data, then open the company.</li>
            <li>Press Alt+O (Import) → Masters, choose the ledgers file. If asked about masters that already exist, choose “Ignore duplicates”.</li>
            <li>Alt+O (Import) → Transactions, choose the entries file.</li>
            <li>Check the import result: it shows how many were created and any errors.</li>
          </ol>
        </div>
        <div>
          <div className="font-semibold text-foreground">Tally.ERP 9</div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Back up your Tally data, then open the company.</li>
            <li>Gateway of Tally → Import of Data → Masters, choose the ledgers file.</li>
            <li>Gateway of Tally → Import of Data → Vouchers, choose the entries file.</li>
          </ol>
        </div>
      </div>
      <ul className="mt-3 list-disc space-y-0.5 pl-5">
        <li>To keep the ERP invoice numbers, set numbering of the Sales voucher type in Tally to Manual (or Automatic with manual override).</li>
        <li>Each purchase order becomes one purchase entry, on the day goods first arrived. The supplier bill numbers are in the reference and the note.</li>
        <li>Ledger names are set with “Tally ledger names” (top right). Use the same names as in your Tally company.</li>
      </ul>
    </details>
  );
}

// ------------------------------------------------------------------ ledger names (side panel)

function LedgerNames({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const saved = useApiQuery<TallySettings>('/tally/settings', undefined, open);
  const [draft, setDraft] = useState<TallySettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && saved.data) setDraft(saved.data);
    if (!open) setErrors({});
  }, [open, saved.data]);

  const setLedger = (key: keyof TallySettings['ledgers'], value: string) => draft && setDraft({ ...draft, ledgers: { ...draft.ledgers, [key]: value } });
  const setType = (key: keyof TallySettings['voucherTypes'], value: string) => draft && setDraft({ ...draft, voucherTypes: { ...draft.voucherTypes, [key]: value } });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setErrors({});
    try {
      const result = await api<TallySettings>('/tally/settings', { method: 'PUT', body: draft });
      queryClient.setQueryData(['/tally/settings', {}], result);
      toast.success('Tally ledger names saved');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Tally ledger names</SheetTitle>
          <SheetDescription>Use the names of the ledgers and voucher types in your Tally company. Ledgers that are not in Tally yet are made by the ledgers file.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {!draft ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <>
              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Ledgers</h3>
                {TALLY_LEDGERS.map((l) => (
                  <div key={l.key} className="grid gap-1.5">
                    <Label htmlFor={`tl-${l.key}`}>
                      {l.label}
                      <span className="font-normal text-muted-foreground">· {l.group}</span>
                    </Label>
                    <Input id={`tl-${l.key}`} value={draft.ledgers[l.key]} onChange={(e) => setLedger(l.key, e.target.value)} placeholder={'optional' in l ? 'Empty = add to the main ledger' : l.defaultName} aria-invalid={!!errors[`ledgers.${l.key}`]} />
                    {errors[`ledgers.${l.key}`] ? <p className="text-xs text-destructive">{errors[`ledgers.${l.key}`]}</p> : 'hint' in l && <p className="text-xs text-muted-foreground">{l.hint}</p>}
                  </div>
                ))}
              </section>
              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Voucher types</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {TALLY_VOUCHER_TYPES.map((t) => (
                    <div key={t.key} className="grid gap-1.5">
                      <Label htmlFor={`tv-${t.key}`}>{t.label}</Label>
                      <Input id={`tv-${t.key}`} value={draft.voucherTypes[t.key]} onChange={(e) => setType(t.key, e.target.value)} aria-invalid={!!errors[`voucherTypes.${t.key}`]} />
                      {errors[`voucherTypes.${t.key}`] && <p className="text-xs text-destructive">{errors[`voucherTypes.${t.key}`]}</p>}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => setDraft(DEFAULT_TALLY_SETTINGS)} disabled={!draft}>
            <RotateCcw /> Defaults
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} loading={saving} disabled={!draft}>
              Save names
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
