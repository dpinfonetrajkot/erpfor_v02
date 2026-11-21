'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 12-point trend line for a stat tile: the past in a quiet grey, the current month as a dot in the accent.
 * Decorative (the tile's text says the value), so it is hidden from screen readers.
 */
export function Sparkline({
  values,
  height = 36,
  className,
}: {
  values: number[];
  height?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 5; // room for the end dot and its ring
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) =>
    pad + (values.length > 1 ? (i / (values.length - 1)) * (width - pad * 2) : 0);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const last = values.length - 1;

  return (
    <div ref={box} className={cn('w-full', className)} style={{ height }} aria-hidden>
      {width > 0 && values.length > 1 && (
        <svg width={width} height={height} className="block overflow-visible">
          <polygon
            points={`${x(0)},${y(min)} ${points} ${x(last)},${y(min)}`}
            fill="var(--chart-1)"
            opacity={0.1}
          />
          <polyline
            points={points}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeOpacity={0.55}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={x(last)}
            cy={y(values[last])}
            r={4}
            fill="var(--chart-1)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        </svg>
      )}
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  href?: string;
  /** small grey text under the label */
  hint?: string;
  /** colour of this bar (default: the list's colour) */
  color?: string;
  /** text shown at the end instead of the formatted value */
  valueText?: string;
}

/**
 * Horizontal bars on one baseline, one hue (compare sizes; the value sits at the end of each row).
 * Each row can open the matching list.
 */
export function BarList({
  rows,
  format,
  color = 'var(--chart-1)',
  label,
}: {
  rows: BarRow[];
  format: (v: number) => string;
  color?: string;
  label: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className="-mx-2 space-y-0.5" aria-label={label}>
      {rows.map((r) => {
        const pct = max > 0 ? Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100) : 0;
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {r.label}
                {r.hint && <span className="ml-1.5 text-xs text-muted-foreground">{r.hint}</span>}
              </span>
              <span className="tabular shrink-0 font-medium">{r.valueText ?? format(r.value)}</span>
            </div>
            <div className="mt-1.5 h-2.5 w-full rounded-r-[4px] bg-muted/70">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-500"
                style={{ width: `${pct}%`, background: r.color ?? color }}
              />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link
                href={r.href}
                aria-label={`${r.label}: ${format(r.value)}`}
                className="block rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {body}
              </Link>
            ) : (
              <div className="px-2 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One whole split into parts (thin bar, no text on it): the list next to it gives each part's name and amount,
 * with the same colour swatch.
 */
export function SegmentedBar({
  parts,
  label,
  format,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
  label: string;
  format: (v: number) => string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <div
      role="img"
      aria-label={`${label}: ${parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}
      className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-muted"
    >
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.key}
              title={`${p.label}: ${format(p.value)}`}
              style={{ flexGrow: p.value, flexBasis: 0, background: p.color }}
            />
          ))}
    </div>
  );
}
