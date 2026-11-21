'use client';

import { useEffect, useState } from 'react';
import { Download, Printer, TrendingDown, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { PERIOD_PRESET_LABELS, PERIOD_PRESETS, periodRange, type PeriodPreset } from '@bht/shared';
import { fmtDate, toInputDate } from '@/lib/format';
import { BRAND } from '@/lib/brand';
import type { ListParams } from '@/hooks/use-list-params';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { useSession } from '@/components/app/session';

/** Today on this computer ("YYYY-MM-DD"), so "this month" is the month in India. */
export const localToday = () => toInputDate(new Date());

/** Report period kept in the URL (?from=&to=), starting with a preset. */
export function usePeriod(params: ListParams, initial: PeriodPreset = 'this_month') {
  const fallback = periodRange(initial, localToday());
  const from = params.filters.from || fallback.from;
  const to = params.filters.to || fallback.to;
  const preset = PERIOD_PRESETS.find((p) => {
    const r = periodRange(p, localToday());
    return r.from === from && r.to === to;
  });
  return { from, to, preset };
}

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The period just before, of the same size: whole months move back by the same number of months
 * (Oct → Sep, Q3 → Q2, FY → last FY); any other range moves back by its number of days.
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (fd === 1 && td === lastDayOf(ty, tm)) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const start = new Date(Date.UTC(fy, fm - 1 - months, 1));
    const end = new Date(Date.UTC(fy, fm - 1, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** "1 Oct 2026 – 31 Oct 2026", or the preset name when it is one. */
export function periodText(from: string, to: string, preset?: PeriodPreset) {
  return `${preset ? `${PERIOD_PRESET_LABELS[preset]}: ` : ''}${fmtDate(from)} – ${fmtDate(to)}`;
}

/** Preset buttons + from / to dates. */
export function PeriodPicker({
  params,
  initial = 'this_month',
}: {
  params: ListParams;
  initial?: PeriodPreset;
}) {
  const { from, to, preset } = usePeriod(params, initial);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div
        className="flex flex-wrap gap-1 rounded-full glass p-1"
        role="group"
        aria-label="Period"
      >
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p}
            onClick={() => params.set(periodRange(p, localToday()))}
            className={cn(
              'h-8 rounded-full px-3.5 text-[13px] font-semibold text-muted-foreground transition-colors',
              preset === p ? 'bg-ink text-ink-foreground' : 'hover:text-foreground',
            )}
          >
            {PERIOD_PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <Input
          type="date"
          aria-label="From"
          value={from}
          max={to}
          onChange={(e) => e.target.value && params.set({ from: e.target.value, to })}
          className="h-9 w-[9.5rem]"
        />
        <span className="text-muted-foreground">to</span>
        <Input
          type="date"
          aria-label="To"
          value={to}
          min={from}
          onChange={(e) => e.target.value && params.set({ from, to: e.target.value })}
          className="h-9 w-[9.5rem]"
        />
      </div>
    </div>
  );
}

/** Filters row (period, party, product ...): on screen only. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">{children}</div>;
}

/** Pill tabs kept in the URL. */
export function ReportTabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div
      className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-full glass p-1 print:hidden"
      role="tablist"
      aria-label={label}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'h-8 rounded-full px-4 text-[13px] font-semibold text-muted-foreground transition-colors',
            value === t.key ? 'bg-ink text-ink-foreground' : 'hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Headline figure. `compare` adds "▲ 12% vs previous period": green when the change is good,
 * red when it is bad (`upIsGood` false for costs, rejections ...).
 */
export function StatTile({
  label,
  value,
  sub,
  tone,
  compare,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'bad' | 'good';
  /** `upIsGood`: true (default) = a rise is good, false = a rise is bad, null = only show the change */
  compare?: { now: number; before: number | undefined; upIsGood?: boolean | null };
}) {
  let delta: React.ReactNode = null;
  if (compare && compare.before !== undefined) {
    const { now, before, upIsGood = true } = compare;
    if (before > 0) {
      const pct = Math.round(((now - before) / before) * 100);
      const up = pct >= 0;
      const good = pct === 0 || upIsGood === null ? null : up === upIsGood;
      const Icon = up ? TrendingUp : TrendingDown;
      delta = (
        <span
          className={cn(
            'inline-flex items-center gap-1 font-medium',
            good === true && 'text-success',
            good === false && 'text-destructive',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {up ? '+' : '−'}
          {Math.abs(pct)}%{' '}
          <span className="font-normal text-muted-foreground">vs previous period</span>
        </span>
      );
    } else {
      delta = <span className="text-muted-foreground">Nothing in the previous period</span>;
    }
  }
  return (
    <Card className="break-inside-avoid p-4">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-success',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      {delta && <div className="mt-1.5 text-xs">{delta}</div>}
    </Card>
  );
}

/** Row of headline figures. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">{children}</div>;
}

/** A chart (or chart-like list) in a card, kept on one printed page. */
export function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('break-inside-avoid', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

/** "Excel" download of the report as it is filtered now. */
export function ExportButton({
  path,
  query,
  permission,
  label = 'Excel (CSV)',
}: {
  path: string;
  query: Record<string, string | number | undefined>;
  permission: string;
  label?: string;
}) {
  const { can } = useSession();
  if (!can(permission)) return null;
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '')
      .map(([k, v]) => [k, String(v)]),
  );
  return (
    <Button variant="outline" asChild>
      <a href={`/api${path}?${qs.toString()}`}>
        <Download /> {label}
      </a>
    </Button>
  );
}

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  );
}

/**
 * Top of the printed page (hidden on screen): company, report name, what is shown, when and by whom.
 * While printing the page is shown in the light theme, whatever the screen theme is.
 */
export function PrintHeader({
  title,
  lines = [],
}: {
  title: string;
  lines?: (string | false | null | undefined)[];
}) {
  const { user } = useSession();
  const [printedAt, setPrintedAt] = useState(() => new Date());
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      setPrintedAt(new Date());
      wasDark = root.classList.contains('dark');
      if (wasDark) root.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) root.classList.add('dark');
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  const shown = lines.filter((l): l is string => !!l);
  return (
    <div className="mb-5 hidden border-b-2 border-foreground pb-3 print:block">
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className="text-[13px] font-bold tracking-wide uppercase">{BRAND.footer}</div>
          <div className="text-[11px] text-muted-foreground">{BRAND.address}</div>
          <h1 className="mt-1 text-xl font-bold">{title}</h1>
          {shown.length > 0 && <p className="mt-1 text-xs">{shown.join('  ·  ')}</p>}
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
          Printed {format(printedAt, 'd MMM yyyy, h:mm a')}
          <br />
          by {user.name}
        </div>
      </div>
    </div>
  );
}

/** Table frame with horizontal scroll on small screens (full width, no scroll, when printed). */
export function ReportTable({
  children,
  minWidth = 760,
  className,
  title,
}: {
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
  title?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      {title && (
        <div className="border-b px-4 py-3">
          <h3 className="text-[15px] font-semibold">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto print:overflow-visible">
        <table className="report-table w-full text-sm" style={{ minWidth }}>
          {children}
        </table>
      </div>
    </Card>
  );
}

export const th = 'px-3 py-2 text-left first:pl-4 last:pr-4';
export const thNum = 'px-3 py-2 text-right first:pl-4 last:pr-4';
export const td = 'px-3 py-2.5 first:pl-4 last:pr-4';
export const tdNum = 'tabular px-3 py-2.5 text-right whitespace-nowrap first:pl-4 last:pr-4';
export const theadClass = 'border-b bg-muted/40 text-xs text-muted-foreground uppercase';
export const totalRow = 'border-t-2 bg-muted/30 font-semibold';

export function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

/** Share of a total, "34%" ("–" when the total is 0). */
export const share = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';

/** Month key "2026-10" → "Oct". */
export const shortMonth = (m: string) => format(new Date(`${m}-01T00:00:00`), 'MMM');
export const longMonth = (m: string) => format(new Date(`${m}-01T00:00:00`), 'MMMM yyyy');
