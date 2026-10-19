/*
 * A sequential-ramp heatmap for one measure across two dimensions.
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { RAMP_STROKE, SEQUENTIAL_BLUE, rampColor } from '@/lib/badger/palette';
import { tonnes } from '@/lib/badger/format';

export interface MatrixAxis {
  id: string;
  label: string;
}

interface MatrixGridProps {
  rows: MatrixAxis[];
  columns: MatrixAxis[];
  /** `${rowId}|${columnId}` → tonnes CO2e. Missing keys render as empty. */
  values: Map<string, number>;
  rowTotals?: Map<string, number>;
  ariaLabel: string;
  rowHeaderWidth?: number;
}

/**
 * Buildings down, categories across, carbon as brightness.
 *
 * Magnitude is a **sequential single hue**, dim → bright, because on a dark
 * surface brightness is what reads as "more". Every filled cell carries
 * {@link RAMP_STROKE} so it stays visible against the surface, and the exact
 * number is in the cell's title and in the row totals beside it — the ramp
 * narrows attention, it is never the only way to read the value.
 */
export default function MatrixGrid({
  rows,
  columns,
  values,
  rowTotals,
  ariaLabel,
  rowHeaderWidth = 168,
}: MatrixGridProps) {
  const [hover, setHover] = useState<{ row: string; col: string; value: number } | null>(null);

  const max = Math.max(...[...values.values()].filter(Number.isFinite), 0) || 1;

  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px]" aria-label={ariaLabel}>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-[var(--c3-style-basic-bg-primary)] text-left align-bottom"
                style={{ width: rowHeaderWidth, minWidth: rowHeaderWidth }}
              >
                <span className="sr-only">Building</span>
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="align-bottom">
                  <span
                    className="block h-[78px] w-[22px] origin-bottom-left translate-x-[11px] -rotate-45 whitespace-nowrap text-left text-[10px] leading-none text-[var(--c3-style-basic-fg-secondary)]"
                    title={c.label}
                  >
                    {c.label}
                  </span>
                </th>
              ))}
              {rowTotals ? (
                <th scope="col" className="pl-2 align-bottom">
                  <span className="block text-right text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                    Total
                  </span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 truncate bg-[var(--c3-style-basic-bg-primary)] pr-2 text-left text-[11px] font-normal text-[var(--c3-style-basic-fg-secondary)]"
                  style={{ width: rowHeaderWidth, maxWidth: rowHeaderWidth }}
                  title={r.label}
                >
                  {r.label}
                </th>
                {columns.map((c) => {
                  const v = values.get(`${r.id}|${c.id}`) ?? 0;
                  const active = hover?.row === r.id && hover?.col === c.id;
                  return (
                    <td key={c.id} className="p-0">
                      <button
                        type="button"
                        onMouseEnter={() => setHover({ row: r.id, col: c.id, value: v })}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover({ row: r.id, col: c.id, value: v })}
                        onBlur={() => setHover(null)}
                        title={`${r.label} · ${c.label}: ${v > 0 ? tonnes(v) : 'no recorded spend'}`}
                        className={cn(
                          'block h-[22px] w-full min-w-[22px] rounded-[3px] transition-transform',
                          'focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]',
                          active && 'scale-[1.18]',
                        )}
                        style={
                          v > 0
                            ? {
                                backgroundColor: rampColor(v, max),
                                boxShadow: `inset 0 0 0 1px ${RAMP_STROKE}`,
                              }
                            : { backgroundColor: 'rgba(255,255,255,0.035)' }
                        }
                      >
                        <span className="sr-only">
                          {r.label} {c.label} {v > 0 ? tonnes(v) : 'none'}
                        </span>
                      </button>
                    </td>
                  );
                })}
                {rowTotals ? (
                  <td className="pl-2 text-right text-[11px] font-medium tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                    {tonnes(rowTotals.get(r.id) ?? 0)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">0 t</span>
          <span className="flex gap-[2px]" aria-hidden>
            {SEQUENTIAL_BLUE.map((c) => (
              <span
                key={c}
                className="block size-[11px] rounded-[2px]"
                style={{ backgroundColor: c, boxShadow: `inset 0 0 0 1px ${RAMP_STROKE}` }}
              />
            ))}
          </span>
          <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
            {tonnes(max)}
          </span>
        </div>
        <p className="min-h-[15px] text-[11px] text-[var(--c3-style-basic-fg-primary)]">
          {hover ? (
            <>
              <span className="text-[var(--c3-style-basic-fg-secondary)]">
                {rows.find((r) => r.id === hover.row)?.label} ·{' '}
                {columns.find((c) => c.id === hover.col)?.label}:{' '}
              </span>
              <span className="font-medium tabular-nums">
                {hover.value > 0 ? tonnes(hover.value) : 'no recorded spend'}
              </span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
