'use client';

/*
 * The "soft glass" dashboard blocks: performance overview (team, daily sales, collection gauge,
 * on-time block chart), money status donuts and the deliveries table. Live data only; every chart
 * also says its numbers in words, and colour is never the only clue (labels, legends, icons).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ArrowUpRight, BarChart3, ExternalLink, FileText, MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import type { BusinessDashboard, DashboardSummary } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Tooltip } from '@/components/ui/primitives';
import { ASK_EVENT } from '@/components/app/assistant';
import { useSession } from '@/components/app/session';
import { initialsOf, UserAvatar } from '@/components/app/user-avatar';

const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const inr = (v: number) => `₹${rupees.format(v)}`;
const short = (v: number) => `₹${compact.format(v)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Soft avatar tones for customers (light background, dark text of the same hue). */
const TONES = [
  'bg-[#dfe6fa] text-[#2f4c9a]',
  'bg-[#fbe1e3] text-[#9b2c36]',
  'bg-[#e6e1f6] text-[#4a3a8c]',
  'bg-[#dff1ea] text-[#1d5c44]',
  'bg-[#f7ead9] text-[#7a4a12]',
];
const toneOf = (name: string) => TONES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % TONES.length];

/** The big rounded glass frame around a group of cards. */
export function GlassPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('glass rounded-[28px] p-3.5', className)}>{children}</section>;
}

/** A white card inside a glass panel. */
function InnerCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <article className={cn('flex min-w-0 flex-col rounded-[22px] bg-popover/80 p-5 dark:bg-white/[0.04]', className)}>{children}</article>;
}

/** Round "open" button at the top right of a card. */
function CornerLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-popover text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ArrowUpRight className="size-4" />
    </Link>
  );
}

function RoundAction({ label, children, href, onClick }: { label: string; children: React.ReactNode; href?: string; onClick?: () => void }) {
  const cls =
    'flex size-11 items-center justify-center rounded-full border border-border bg-popover/80 text-foreground transition-colors hover:bg-popover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
  return (
    <Tooltip content={label}>
      {href ? (
        <Link href={href} aria-label={label} className={cls}>
          {children}
        </Link>
      ) : (
        <button type="button" onClick={onClick} aria-label={label} className={cls}>
          {children}
        </button>
      )}
    </Tooltip>
  );
}

// ------------------------------------------------------------------ performance overview

export function PerformanceOverview({ data, money }: { data: DashboardSummary; money?: BusinessDashboard }) {
  const { can } = useSession();
  const month = format(new Date(), 'MMMM yyyy');
  const timing = data.orderTiming;
  return (
    <GlassPanel>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4 px-2 pt-1 pb-4">
        <div className="min-w-[220px] flex-1">
          <h2 className="text-lg font-bold">Performance overview</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Sales, collections and deliveries · {month}</p>
        </div>
        {data.team && data.team.length > 0 && <TeamRow team={data.team} />}
        <div className="flex gap-2">
          {can('sales_orders.create') && (
            <RoundAction label="New sales order" href="/sales/orders/new">
              <Plus className="size-[18px]" />
            </RoundAction>
          )}
          {can('business_reports.view') && (
            <RoundAction label="Sales & GST report" href="/reports/sales">
              <BarChart3 className="size-[18px]" />
            </RoundAction>
          )}
          {can('assistant.view') && (
            <RoundAction label="Ask ERP" onClick={() => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: '' }))}>
              <Sparkles className="size-[18px] text-primary" />
            </RoundAction>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {money && <DailySales days={money.days} className="flex-[2_1_440px]" />}
        {money && <CollectionGauge billed={money.sales.thisMonth} received={money.receivedThisMonth} className="flex-[1_1_250px]" />}
        {timing && <OnTimeBlocks onTrack={timing.onTrack} late={timing.late} className="flex-[1_1_250px]" />}
      </div>
    </GlassPanel>
  );
}

/** People who changed things this week, with how many changes each made. */
function TeamRow({ team }: { team: NonNullable<DashboardSummary['team']> }) {
  return (
    <div className="flex items-center rounded-full border border-glass-border bg-white/60 py-1.5 pr-3 pl-2 dark:bg-white/5" role="list" aria-label="Team activity this week">
      {team.map((p) => (
        <Tooltip key={p.id} content={`${p.name}: ${plural(p.changes, 'change')} this week`}>
          <Link href="/admin/audit-log" role="listitem" aria-label={`${p.name}: ${plural(p.changes, 'change')} this week`} className="relative -ml-0 mr-1.5 rounded-full ring-2 ring-white dark:ring-[#1b202b]">
            <UserAvatar name={p.name} style={p.style ?? undefined} className="size-10 text-[12px]" />
            <span className="absolute -bottom-1.5 left-1/2 flex h-[18px] min-w-[18px] -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-primary px-1 text-[10px] font-bold text-primary-foreground dark:border-[#1b202b]">
              {p.changes > 99 ? '99+' : p.changes}
            </span>
          </Link>
        </Tooltip>
      ))}
    </div>
  );
}

/** Thin bars of invoice value per day; the best day and today carry a value tag. */
function DailySales({ days, className }: { days: BusinessDashboard['days']; className?: string }) {
  const W = 560, base = 196, top = 62, x0 = 46, x1 = 548;
  const max = Math.max(0, ...days.map((d) => d.sales));
  const { scale, steps } = niceScale(max);
  const step = days.length > 1 ? (x1 - x0) / (days.length - 1) : 0;
  const cx = (i: number) => x0 + i * step;
  const Y = (v: number) => base - (v / scale) * (base - top);
  const total = days.reduce((s, d) => s + d.sales, 0);
  const peakI = max > 0 ? days.findIndex((d) => d.sales === max) : -1;
  const todayI = days.length - 1;
  const grid = Array.from({ length: steps }, (_, k) => (scale * (k + 1)) / steps).map((v) => ({ y: Y(v), label: short(v) }));
  const labelIdx = [0, Math.round((days.length - 1) / 3), Math.round(((days.length - 1) * 2) / 3), days.length - 1];
  const tag = (i: number, text: string, color: string) => {
    const x = cx(i), y = Y(days[i].sales);
    const w = Math.max(64, text.length * 6.6 + 18);
    const px = Math.min(Math.max(x - w / 2, 2), W - w - 2);
    const py = Math.max(y - 46, 2);
    return (
      <g key={`tag${i}`}>
        <line x1={x} x2={x} y1={py + 24} y2={y} stroke={color} strokeWidth={2} />
        <circle cx={x} cy={y} r={5} fill="var(--foreground)" stroke="var(--popover)" strokeWidth={2} />
        <rect x={px} y={py} width={w} height={24} rx={12} fill="var(--ink)" />
        <text x={px + w / 2} y={py + 16} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="var(--ink-foreground)">
          {text}
        </text>
      </g>
    );
  };
  return (
    <InnerCard className={className}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold">Daily sales</h3>
        <span className="rounded-full border border-border bg-popover px-3.5 py-1.5 text-[12.5px] font-semibold">Last 30 days</span>
      </div>
      <svg viewBox={`0 0 ${W} 228`} className="mt-3 h-auto w-full" role="img" aria-label={`Bar chart of sales per day for the last 30 days, ${inr(total)} in all${peakI >= 0 ? `; best day ${format(parseISO(days[peakI].date), 'd MMM')} with ${inr(max)}` : ''}.`}>
        {grid.map((g) => (
          <g key={g.y}>
            <line x1={x0} x2={x1 + 4} y1={g.y} y2={g.y} stroke="var(--border)" strokeWidth={1} />
            <text x={0} y={g.y + 4} fontSize={10.5} fill="var(--muted-foreground)">
              {g.label}
            </text>
          </g>
        ))}
        <line x1={x0} x2={x1 + 4} y1={base} y2={base} stroke="var(--input)" strokeWidth={1} />
        {days.map((d, i) => {
          const h = d.sales > 0 ? Math.max(base - Y(d.sales), 3) : 2;
          return (
            <rect key={d.date} x={cx(i) - 2} y={base - h} width={4} height={h} rx={2} fill={i === todayI ? 'var(--chart-2)' : d.sales > 0 ? 'var(--foreground)' : 'var(--input)'}>
              <title>{`${format(parseISO(d.date), 'EEE d MMM')}: ${inr(d.sales)}`}</title>
            </rect>
          );
        })}
        {peakI >= 0 && peakI !== todayI && tag(peakI, `${short(max)} · ${format(parseISO(days[peakI].date), 'd MMM')}`, 'var(--chart-1)')}
        {days.length > 0 && days[todayI].sales > 0 && tag(todayI, `${short(days[todayI].sales)} · today`, 'var(--chart-2)')}
        {labelIdx.map((i, k) => (
          <text key={i} x={cx(i)} y={222} fontSize={10.5} textAnchor={k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle'} fill="var(--muted-foreground)">
            {format(parseISO(days[i].date), 'd MMM')}
          </text>
        ))}
        {total === 0 && (
          <text x={(x0 + x1) / 2} y={(base + top) / 2} textAnchor="middle" fontSize={13} fill="var(--muted-foreground)">
            No invoices in the last 30 days
          </text>
        )}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">{inr(total)} billed in the last 30 days (with GST). Today’s bar is coral.</p>
    </InnerCard>
  );
}

/** A tidy top for the value axis (1, 2, 2.5, 5 or 10 times a power of ten) and how many even steps to draw. */
function niceScale(v: number) {
  if (v <= 0) return { scale: 1000, steps: 4 };
  const p = 10 ** Math.floor(Math.log10(v));
  const m = [1, 2, 2.5, 5, 10].find((k) => k * p >= v) ?? 10;
  return { scale: m * p, steps: m === 2.5 || m === 5 || m === 10 ? 5 : 4 };
}

/** Half-circle of ticks: how much of this month's billing is already paid. */
function CollectionGauge({ billed, received, className }: { billed: number; received: number; className?: string }) {
  const pct = billed > 0 ? Math.min(100, Math.round((received / billed) * 100)) : null;
  const n = 41, cx = 130, cy = 98, rin = 70, rout = 92;
  const on = pct === null ? -1 : Math.round((pct / 100) * (n - 1));
  const ok = pct !== null && pct >= 75;
  return (
    <InnerCard className={className}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold">Collection rate</h3>
        <CornerLink href="/billing/payments" label="Open payments" />
      </div>
      <svg viewBox="0 0 260 128" className="mx-auto mt-2 h-auto w-full max-w-[280px]" role="img" aria-label={pct === null ? 'No billing yet this month' : `${pct}% of this month's billing received`}>
        {Array.from({ length: n }, (_, k) => {
          const th = Math.PI - (k * Math.PI) / (n - 1);
          return (
            <line
              key={k}
              x1={cx + rin * Math.cos(th)}
              y1={cy - rin * Math.sin(th)}
              x2={cx + rout * Math.cos(th)}
              y2={cy - rout * Math.sin(th)}
              stroke={k <= on ? 'var(--chart-1)' : 'color-mix(in oklch, var(--chart-1) 22%, var(--popover))'}
              strokeWidth={5}
              strokeLinecap="round"
            />
          );
        })}
        <text x={cx} y={88} textAnchor="middle" fontSize={38} fontWeight={800} fill="var(--foreground)">
          {pct === null ? '–' : `${pct}%`}
        </text>
        <text x={cx} y={120} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
          of {format(new Date(), 'MMMM')} billing received
        </text>
      </svg>
      <div className="mt-auto rounded-2xl bg-muted/70 px-4 py-3">
        <strong className="block text-[13px] font-bold">{pct === null ? 'Nothing billed yet this month.' : ok ? 'Collections are on track.' : 'Collections need a push.'}</strong>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {inr(received)} received of {inr(billed)} billed this month.
        </span>
      </div>
    </InnerCard>
  );
}

/** Two block grids: open orders still on time and those already past the promised date. */
function OnTimeBlocks({ onTrack, late, className }: { onTrack: number; late: number; className?: string }) {
  const total = onTrack + late;
  const pct = total ? Math.round((onTrack / total) * 100) : null;
  const cells = 24;
  const onCells = total ? Math.round((onTrack / total) * cells) : 0;
  const grid = (filled: number, color: string, label: string) => (
    <div className="grid grid-cols-4 gap-1" role="img" aria-label={label}>
      {Array.from({ length: cells }, (_, k) => (
        <span key={k} className="aspect-square rounded-[4px]" style={{ background: k >= cells - filled ? color : `color-mix(in oklch, ${color} 18%, var(--popover))` }} />
      ))}
    </div>
  );
  return (
    <InnerCard className={className}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold">On-time delivery</h3>
        <CornerLink href="/reports/pending-orders" label="Open pending orders" />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[30px] font-extrabold tracking-[-0.02em]">{pct === null ? '–' : `${pct}%`}</span>
        {late > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">{late} late</span>}
      </div>
      <span className="text-xs text-muted-foreground">{total ? `of ${plural(total, 'open order')} ${total === 1 ? 'is' : 'are'} still on time` : 'No open orders with a promised date'}</span>
      {total > 0 && (
        <div className="mt-3 flex gap-2.5">
          <div className="flex-1 rounded-2xl bg-muted/70 p-2.5">
            {grid(onCells, 'var(--chart-1)', `${onTrack} of ${total} orders on time`)}
            <div className="mt-2 flex justify-between text-xs">
              <span>On time</span>
              <strong className="font-bold">{onTrack}</strong>
            </div>
          </div>
          <div className="flex-1 rounded-2xl bg-muted/70 p-2.5">
            {grid(cells - onCells, 'var(--chart-2)', `${late} of ${total} orders late`)}
            <div className="mt-2 flex justify-between text-xs">
              <span>Late</span>
              <strong className="font-bold">{late}</strong>
            </div>
          </div>
        </div>
      )}
    </InnerCard>
  );
}

// ------------------------------------------------------------------ money status

export function MoneyStatus({ money, className }: { money: BusinessDashboard; className?: string }) {
  return (
    <GlassPanel className={cn('px-5 pt-4 pb-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-bold">Money status</h2>
        <CornerLink href="/reports/ageing" label="Open the ageing report" />
      </div>
      <div className="mt-2 flex flex-wrap justify-around gap-3">
        <Donut
          total={money.receivable.total}
          overdue={money.receivable.overdue}
          sub="to receive"
          caption="Customers owe us"
          href="/reports/ageing"
        />
        <Donut
          total={money.payable.total}
          overdue={money.payable.overdue}
          sub="to pay"
          caption="We owe suppliers"
          href="/reports/ageing?direction=PAYMENT"
        />
      </div>
      <div className="mt-3 flex justify-center gap-5 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-1" /> Not due yet
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-2" /> Overdue
        </span>
      </div>
    </GlassPanel>
  );
}

function Donut({ total, overdue, sub, caption, href }: { total: number; overdue: number; sub: string; caption: string; href: string }) {
  const R = 64, C = 2 * Math.PI * R;
  const parts = total > 0 ? [{ v: total - overdue, c: 'var(--chart-1)' }, { v: overdue, c: 'var(--chart-2)' }].filter((p) => p.v > 0) : [];
  let acc = 0;
  const segs = parts.map((p) => {
    const len = (p.v / total) * C;
    const mid = ((acc + len / 2) / C) * 2 * Math.PI - Math.PI / 2;
    const s = { ...p, dash: `${Math.max(len - (parts.length > 1 ? 4 : 0), 1)} ${C}`, off: -acc, pct: Math.round((p.v / total) * 100), px: 115 + 92 * Math.cos(mid), py: 115 + 92 * Math.sin(mid) };
    acc += len;
    return s;
  });
  const overduePct = total > 0 ? Math.round((overdue / total) * 100) : 0;
  return (
    <Link href={href} className="flex flex-col items-center gap-1 rounded-3xl p-1 transition-colors hover:bg-white/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-white/5">
      <svg viewBox="0 0 230 230" className="size-[200px]" role="img" aria-label={`${caption}: ${inr(total)}, ${overduePct}% overdue`}>
        {total <= 0 && <circle cx={115} cy={115} r={R} fill="none" stroke="var(--muted)" strokeWidth={40} />}
        {segs.map((s, i) => (
          <circle key={i} cx={115} cy={115} r={R} fill="none" stroke={s.c} strokeWidth={40} strokeDasharray={s.dash} strokeDashoffset={s.off} transform="rotate(-90 115 115)" />
        ))}
        <text x={115} y={112} textAnchor="middle" fontSize={21} fontWeight={800} fill="var(--foreground)">
          {short(total)}
        </text>
        <text x={115} y={132} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
          {total > 0 ? sub : 'nothing due'}
        </text>
        {segs.length > 1 &&
          segs.map((s, i) => (
            <g key={`p${i}`}>
              <circle cx={s.px} cy={s.py} r={19} fill="var(--popover)" stroke="var(--border)" />
              <text x={s.px} y={s.py + 4} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="var(--foreground)">
                {s.pct}%
              </text>
            </g>
          ))}
      </svg>
      <span className="text-[13px] font-semibold">{caption}</span>
      <span className="text-xs text-muted-foreground">{overdue > 0 ? `${inr(overdue)} overdue` : 'Nothing overdue'}</span>
    </Link>
  );
}

// ------------------------------------------------------------------ deliveries table

export function DeliveriesTable({ rows, className }: { rows: NonNullable<DashboardSummary['dueOrders']>; className?: string }) {
  const router = useRouter();
  const now = new Date();
  return (
    <GlassPanel className={cn('px-5 pt-4 pb-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold">Deliveries due</h2>
          <p className="text-xs text-muted-foreground">Open orders, the soonest promised date first</p>
        </div>
        <CornerLink href="/sales/orders" label="Open all sales orders" />
      </div>
      <div className="mt-3.5 overflow-x-auto rounded-[18px] bg-popover/85 dark:bg-white/[0.04]">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No open orders with a promised date.</p>
        ) : (
          <table className="w-full min-w-[620px] text-[13px]">
            <thead>
              <tr className="bg-muted/70 text-left text-xs text-muted-foreground">
                <th className="py-3 pr-3 pl-4 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold">Order</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Due</th>
                <th className="px-3 py-3 text-right font-semibold">Value</th>
                <th className="py-3 pr-4 pl-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const days = differenceInCalendarDays(parseISO(o.expectedDelivery), now);
                const late = days < 0;
                const status = late ? `Late · ${plural(-days, 'day')}` : days === 0 ? 'Due today' : 'On track';
                return (
                  <tr key={o.id} className="border-t border-border/70">
                    <td className="py-2.5 pr-3 pl-4">
                      <span className="flex items-center gap-2.5">
                        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold', toneOf(o.customer.name))}>{initialsOf(o.customer.name)}</span>
                        <span className="max-w-[150px] truncate font-medium xl:max-w-[190px]" title={o.customer.name}>
                          {o.customer.name}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/sales/orders/${o.id}`} className="font-mono text-[12.5px] font-medium whitespace-nowrap hover:text-primary hover:underline">
                        {o.soNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn('size-2 rounded-full', late ? 'bg-chart-2' : 'bg-chart-1')} aria-hidden />
                        <span className={cn(late && 'font-semibold text-destructive')}>{status}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{format(parseISO(o.expectedDelivery), 'dd MMM yyyy')}</td>
                    <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">{fmtMoney(o.totalAmount, o.currency)}</td>
                    <td className="py-2.5 pr-4 pl-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger aria-label={`More for ${o.soNo}`} className="inline-flex size-8 items-center justify-center rounded-full text-foreground/80 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => router.push(`/sales/orders/${o.id}`)}>
                            <ExternalLink /> Open order
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => router.push('/reports/pending-orders')}>
                            <FileText /> Pending orders report
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rows.length > 0 && rows.length < 4 && (
          <p className="border-t border-border/70 px-5 py-6 text-center text-xs text-muted-foreground">
            {rows.length === 1 ? 'This is the only open order with a promised date.' : `These are all ${rows.length} open orders with a promised date.`}
          </p>
        )}
      </div>
    </GlassPanel>
  );
}
