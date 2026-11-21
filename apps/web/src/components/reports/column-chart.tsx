'use client';

import { useEffect, useRef, useState } from 'react';

export interface ChartSeries {
  label: string;
  /** CSS colour, e.g. 'var(--chart-1)' */
  color: string;
}

/** 1,25,000 -> "1.3L", 2,40,00,000 -> "2.4Cr" (Indian short form for axis ticks). */
export function compactInr(v: number): string {
  const a = Math.abs(v);
  const t = (n: number) => String(Math.round(n * 10) / 10);
  if (a >= 1e7) return `${t(v / 1e7)}Cr`;
  if (a >= 1e5) return `${t(v / 1e5)}L`;
  if (a >= 1e3) return `${t(v / 1e3)}K`;
  return String(Math.round(v));
}

/** A round top for the axis that leaves little empty space: 1 / 1.2 / 1.6 / 2 / 2.4 / 3 / 4 / 5 / 6 / 8 × 10^n (quarters stay round). */
function niceMax(v: number): number {
  // at least 4, so the quarter ticks are whole numbers (an empty chart reads 0-1-2-3-4, never "0, 0, 1, 1, 1")
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** Column with a 4px rounded top and a square foot on the baseline. */
function column(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

const M = { top: 10, right: 8, bottom: 26, left: 52 };
const GAP = 2;

/**
 * Grouped columns over time (one shared axis). Hover or focus a group for its values;
 * the same values are in the table under the chart.
 */
export function ColumnChart({
  data,
  series,
  format,
  tick = compactInr,
  height = 220,
  title,
}: {
  data: { label: string; short: string; values: number[] }[];
  series: ChartSeries[];
  format: (v: number) => string;
  tick?: (v: number) => string;
  height?: number;
  title: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => d.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const band = data.length ? innerW / data.length : 0;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - GAP * (series.length - 1)) / series.length));
  const groupW = barW * series.length + GAP * (series.length - 1);
  const y = (v: number) => M.top + innerH - (v / max) * innerH;
  // keep x labels apart on a narrow screen
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 38))));
  const tip = active != null ? data[active] : null;
  const tipLeft =
    active != null ? Math.min(Math.max(M.left + band * active + band / 2, 90), width - 90) : 0;

  return (
    <figure className="m-0">
      {series.length > 1 && (
        <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <div
        ref={box}
        className="relative w-full"
        style={{ height }}
        onPointerLeave={() => setActive(null)}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={title}
            className="chart-svg block overflow-visible"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={width - M.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={M.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {tick(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = M.left + band * i + (band - groupW) / 2;
              return (
                <g key={d.label}>
                  {active === i && (
                    <rect
                      x={M.left + band * i}
                      y={M.top}
                      width={band}
                      height={innerH}
                      className="fill-muted/60"
                    />
                  )}
                  {d.values.map((v, k) =>
                    v > 0 ? (
                      <path
                        key={k}
                        d={column(x0 + k * (barW + GAP), y(v), barW, M.top + innerH - y(v))}
                        fill={series[k].color}
                      />
                    ) : null,
                  )}
                  {i % every === 0 && (
                    <text
                      x={M.left + band * i + band / 2}
                      y={height - 8}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[11px]"
                    >
                      {d.short}
                    </text>
                  )}
                  {/* the whole column of the month is the hover / focus target */}
                  <rect
                    x={M.left + band * i}
                    y={M.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.label}: ${series.map((s, k) => `${s.label} ${format(d.values[k])}`).join(', ')}`}
                    onPointerEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="cursor-default outline-none"
                  />
                </g>
              );
            })}
          </svg>
        )}
        {tip && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: tipLeft }}
          >
            <div className="mb-1 text-muted-foreground">{tip.label}</div>
            {series.map((s, k) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                <span className="tabular font-semibold text-foreground">
                  {format(tip.values[k])}
                </span>
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="mt-2 text-xs print:hidden">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Show as table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 text-left font-medium">Month</th>
                {series.map((s) => (
                  <th key={s.label} className="py-1 pl-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-t">
                  <td className="py-1 pr-3">{d.label}</td>
                  {d.values.map((v, k) => (
                    <td key={k} className="tabular py-1 pl-3 text-right">
                      {format(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A thin bar inside a table cell (one series; the number sits in its own column). */
export function InlineBar({
  value,
  max,
  color = 'var(--chart-1)',
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="h-2.5 w-full min-w-16 rounded-r-[4px] bg-transparent" aria-hidden>
      <div className="h-full rounded-r-[4px]" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
