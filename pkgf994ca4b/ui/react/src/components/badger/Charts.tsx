/*
 * Recharts figures, all sharing one dark-mode axis/grid/tooltip treatment.
 */

import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AXIS_INK, CATEGORICAL, GRID, PRIMARY, STATUS } from '@/lib/badger/palette';
import { monthLabel, tonnes, tonnesCompact, usdCompact } from '@/lib/badger/format';
import type { MonthTotal, YearTotal } from '@/lib/badger/carbon';
import type { GlidePoint, MaccSegment } from '@/lib/badger/planner';

/** Shared tick/axis styling so every chart in the app reads as one family. */
const axisProps = {
  stroke: GRID,
  tick: { fill: AXIS_INK, fontSize: 11 },
  tickLine: false,
} as const;

const tooltipStyle: React.CSSProperties = {
  background: 'var(--c3-style-basic-bg-secondary)',
  border: '1px solid var(--c3-style-basic-border-border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--c3-style-basic-fg-primary)',
  padding: '8px 10px',
};

const tooltipCommon = {
  contentStyle: tooltipStyle,
  labelStyle: { color: 'var(--c3-style-basic-fg-secondary)', fontSize: 11, marginBottom: 4 },
  itemStyle: { color: 'var(--c3-style-basic-fg-primary)', fontSize: 12 },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
} as const;

/* -------------------------------- trend line ------------------------------- */

/**
 * Measured emissions by fiscal year — **one series**, so there is no legend and
 * the title carries the identity. The 2px line and 8px markers follow the mark
 * spec; the grid is recessive so the data reads first.
 */
export function TrendLine({ data, height = 190 }: { data: YearTotal[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="fiscalYear"
          {...axisProps}
          tickFormatter={(v: number) => `FY${String(v).slice(2)}`}
        />
        <YAxis {...axisProps} width={48} tickFormatter={(v: number) => tonnesCompact(v)} />
        <Tooltip
          {...tooltipCommon}
          formatter={(v: number) => [tonnes(v), 'Emissions']}
          labelFormatter={(v: number) => `FY${v}`}
        />
        <Line
          type="monotone"
          dataKey="tonnes"
          stroke={PRIMARY}
          strokeWidth={2}
          dot={{ r: 3.5, fill: PRIMARY, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: PRIMARY, stroke: 'var(--c3-style-basic-bg-primary)', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------- month bars -------------------------------- */

/**
 * Emissions by month across the fiscal year (July → June). One series; the two
 * year-end months are drawn in the warning status colour **and** named in the
 * figure note, so the spike is never signalled by colour alone.
 */
export function MonthBars({ data, height = 190 }: { data: MonthTotal[]; height?: number }) {
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barCategoryGap={4}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval={0} />
        <YAxis {...axisProps} width={48} tickFormatter={(v: number) => tonnesCompact(v)} />
        <Tooltip
          {...tooltipCommon}
          formatter={(v: number) => [tonnes(v), 'Emissions']}
          labelFormatter={(l: string) => l}
        />
        <Bar dataKey="tonnes" radius={[4, 4, 0, 0]} maxBarSize={34}>
          {rows.map((r) => (
            <Cell
              key={r.month}
              fill={r.month === 6 || r.month === 5 ? STATUS.warning : PRIMARY}
              fillOpacity={r.month === 6 || r.month === 5 ? 1 : 0.78}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------- glide path -------------------------------- */

/**
 * Three series exactly — measured history, the straight-line path to target, and
 * business-as-usual at the historical growth rate. Three is both the number the
 * argument needs and the number the validated palette supports, so no fourth hue
 * is ever required.
 */
export function GlidePathChart({
  data,
  targetYear,
  height = 240,
}: {
  data: GlidePoint[];
  targetYear: number;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="year" {...axisProps} />
        <YAxis {...axisProps} width={48} tickFormatter={(v: number) => tonnesCompact(v)} />
        <Tooltip
          {...tooltipCommon}
          formatter={(v: number, name: string) => [tonnes(v), name]}
          labelFormatter={(v: number) => `FY${v}`}
        />
        <ReferenceLine
          x={targetYear}
          stroke={AXIS_INK}
          strokeDasharray="3 3"
          label={{ value: String(targetYear), fill: AXIS_INK, fontSize: 11, position: 'top' }}
        />
        <Line
          name="Measured"
          type="monotone"
          dataKey="actual"
          stroke={CATEGORICAL[0]}
          strokeWidth={2}
          dot={{ r: 3, fill: CATEGORICAL[0], strokeWidth: 0 }}
          connectNulls={false}
        />
        <Line
          name="Business as usual"
          type="monotone"
          dataKey="businessAsUsual"
          stroke={CATEGORICAL[1]}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls
        />
        <Line
          name="Required path"
          type="monotone"
          dataKey="target"
          stroke={CATEGORICAL[2]}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Legend for {@link GlidePathChart}. Present because the chart has ≥2 series. */
export function GlidePathLegend() {
  const items = [
    { label: 'Measured', color: CATEGORICAL[0], dash: false },
    { label: 'Business as usual', color: CATEGORICAL[1], dash: true },
    { label: 'Required path', color: CATEGORICAL[2], dash: false },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li
          key={i.label}
          className="flex items-center gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]"
        >
          <span
            aria-hidden
            className="inline-block h-0 w-4 shrink-0"
            style={{
              borderTop: `2px ${i.dash ? 'dashed' : 'solid'} ${i.color}`,
            }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------- MACC ----------------------------------- */

/**
 * Marginal abatement cost curve. Each block is as wide as the tonnes that
 * category can supply at its ceiling and as tall as its cost per tonne; blocks
 * below the zero line cut carbon **and** save money.
 *
 * Built from positioned `div`s rather than a chart library because a MACC needs
 * variable bar widths on a continuous x-axis, which stacked-bar primitives do not
 * express cleanly.
 */
export function MaccChart({
  segments,
  height = 220,
  onHover,
}: {
  segments: MaccSegment[];
  height?: number;
  onHover?: (categoryId: string | null) => void;
}) {
  if (!segments.length) return null;

  const totalTonnes = segments.reduce((s, x) => s + x.tonnes, 0);
  const costs = segments.map((s) => s.costPerTonne);
  const maxCost = Math.max(...costs, 0);
  const minCost = Math.min(...costs, 0);
  const span = maxCost - minCost || 1;
  // Pixel position of the zero line inside the plot.
  const zeroPct = (maxCost / span) * 100;

  return (
    <div>
      <div className="relative w-full" style={{ height }} role="group" aria-label="Marginal abatement cost curve">
        {/* zero line — the money/no-money boundary */}
        <div
          aria-hidden
          className="absolute left-0 right-0 border-t border-dashed"
          style={{ top: `${zeroPct}%`, borderColor: AXIS_INK }}
        />
        <span
          aria-hidden
          className="absolute right-0 text-[10px] text-[var(--c3-style-basic-fg-secondary)]"
          style={{ top: `calc(${zeroPct}% + 2px)` }}
        >
          $0/t
        </span>

        <div className="absolute inset-0 flex items-stretch">
          {segments.map((s) => {
            const widthPct = (s.tonnes / totalTonnes) * 100;
            const savesMoney = s.costPerTonne < 0;
            const barHeightPct = (Math.abs(s.costPerTonne) / span) * 100;
            return (
              <div
                key={s.categoryId}
                className="relative h-full min-w-0"
                style={{ width: `${widthPct}%` }}
                onMouseEnter={() => onHover?.(s.categoryId)}
                onMouseLeave={() => onHover?.(null)}
              >
                <div
                  className="absolute left-[1px] right-[1px] rounded-[3px] transition-opacity hover:opacity-100"
                  style={{
                    backgroundColor: savesMoney ? CATEGORICAL[2] : CATEGORICAL[1],
                    opacity: 0.85,
                    top: savesMoney ? `${zeroPct}%` : `calc(${zeroPct}% - ${barHeightPct}%)`,
                    height: `${barHeightPct}%`,
                  }}
                  title={`${s.name}: ${s.tonnes.toFixed(0)} t at ${
                    s.costPerTonne < 0 ? '−' : '+'
                  }$${Math.abs(Math.round(s.costPerTonne))}/t`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
        <span>0 t</span>
        <span>cumulative abatement available →</span>
        <span>{tonnesCompact(totalTonnes)} t</span>
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <li className="flex items-center gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[2px]"
            style={{ backgroundColor: CATEGORICAL[2] }}
          />
          Saves money (negative cost)
        </li>
        <li className="flex items-center gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[2px]"
            style={{ backgroundColor: CATEGORICAL[1] }}
          />
          Costs money (positive cost)
        </li>
      </ul>
    </div>
  );
}

/* ------------------------- spend-vs-carbon scatter ------------------------- */

/**
 * The divergence figure: dollars on one axis, carbon on the other, one dot per
 * category. Categories far from the diagonal are where spending and emitting
 * come apart — which is the whole argument for not managing Scope 3 by budget.
 */
export function SpendCarbonScatter({
  data,
  height = 240,
}: {
  data: { categoryId: string; name: string; spend: number; tonnes: number }[];
  height?: number;
}) {
  const maxSpend = Math.max(...data.map((d) => d.spend), 1);
  const maxTonnes = Math.max(...data.map((d) => d.tonnes), 1);

  return (
    <div className="relative w-full" style={{ height }} role="group" aria-label="Spend versus carbon by category">
      <div
        aria-hidden
        className="absolute inset-0 rounded-[4px] border-l border-b"
        style={{ borderColor: GRID }}
      />
      {data.map((d) => {
        const left = (d.spend / maxSpend) * 100;
        const bottom = (d.tonnes / maxTonnes) * 100;
        // Carbon share well above spend share = under-managed by budget.
        const divergent = d.tonnes / maxTonnes > (d.spend / maxSpend) * 1.5;
        return (
          <div
            key={d.categoryId}
            className="absolute -translate-x-1/2 translate-y-1/2 group"
            style={{ left: `${Math.min(94, Math.max(3, left))}%`, bottom: `${Math.min(92, Math.max(4, bottom))}%` }}
          >
            <span
              aria-hidden
              className="block size-[9px] rounded-full"
              style={{
                backgroundColor: divergent ? CATEGORICAL[1] : PRIMARY,
                boxShadow: '0 0 0 2px var(--c3-style-basic-bg-primary)',
              }}
            />
            <span className="pointer-events-none absolute left-3 top-[-6px] hidden whitespace-nowrap rounded-[4px] border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-secondary)] px-2 py-1 text-[10px] text-[var(--c3-style-basic-fg-primary)] group-hover:block">
              {d.name} · {usdCompact(d.spend)} · {tonnes(d.tonnes)}
            </span>
          </div>
        );
      })}
      <span className="absolute bottom-1 right-2 text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
        spend →
      </span>
      <span className="absolute left-1 top-1 text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
        ↑ tCO₂e
      </span>
    </div>
  );
}
