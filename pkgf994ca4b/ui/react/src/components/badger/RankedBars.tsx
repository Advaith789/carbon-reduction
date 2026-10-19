/*
 * Single-hue ranked bars — the magnitude form used for all 13 spend categories.
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { PRIMARY } from '@/lib/badger/palette';

export interface RankedBarDatum {
  id: string;
  label: string;
  value: number;
  /** Formatted value shown as the direct label. */
  display: string;
  /** Extra lines revealed on hover. */
  tooltip?: { label: string; value: string }[];
  /** Marks this row as the one the surrounding prose is about. */
  emphasis?: boolean;
}

interface RankedBarsProps {
  data: RankedBarDatum[];
  /** Accessible name for the whole chart. */
  ariaLabel: string;
  /** Override the single hue. Defaults to the validated primary. */
  color?: string;
  /** Width of the label gutter. */
  labelWidth?: number;
  /** Cap the number of rows; the remainder is summarised. */
  maxRows?: number;
  onSelect?: (id: string) => void;
  selectedId?: string;
}

/**
 * A ranked bar list in **one hue**.
 *
 * Thirteen categories cannot be thirteen colours — only three categorical slots
 * are validated, and a legend of thirteen swatches would be unreadable anyway.
 * Encoding magnitude by bar length in a single hue solves both problems: there is
 * one series, so there is no legend and no palette conflict, and the ranking is
 * the message.
 *
 * Bars are thin, anchored to a common left baseline, rounded only on the data
 * end, and separated by a surface gap. Every row is directly labelled, which
 * doubles as the table view — magnitude is never colour-alone.
 */
export default function RankedBars({
  data,
  ariaLabel,
  color = PRIMARY,
  labelWidth = 168,
  maxRows,
  onSelect,
  selectedId,
}: RankedBarsProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const rows = maxRows ? data.slice(0, maxRows) : data;
  const hiddenRows = maxRows ? data.slice(maxRows) : [];
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 0) || 1;

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-col gap-[2px]">
      {rows.map((d) => {
        const isActive = hovered === d.id || selectedId === d.id;
        const width = `${Math.max(0.6, (Math.abs(d.value) / max) * 100)}%`;
        const interactive = !!onSelect;
        const RowTag = interactive ? 'button' : 'div';

        return (
          <div key={d.id} className="relative">
            <RowTag
              {...(interactive ? { type: 'button' as const, onClick: () => onSelect?.(d.id) } : {})}
              onMouseEnter={() => setHovered(d.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(d.id)}
              onBlur={() => setHovered(null)}
              className={cn(
                'group flex w-full items-center gap-3 rounded-[4px] px-1.5 py-[5px] text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]',
                isActive && 'bg-white/[0.045]',
                interactive && 'cursor-pointer',
              )}
            >
              <span
                className={cn(
                  'shrink-0 truncate text-[12px] leading-tight',
                  d.emphasis
                    ? 'font-semibold text-[var(--c3-style-basic-fg-primary)]'
                    : 'text-[var(--c3-style-basic-fg-secondary)]',
                )}
                style={{ width: labelWidth }}
                title={d.label}
              >
                {d.label}
              </span>

              <span className="relative h-[10px] min-w-0 flex-1">
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width,opacity] duration-200"
                  style={{
                    width,
                    backgroundColor: color,
                    opacity: isActive ? 1 : d.emphasis ? 0.95 : 0.78,
                  }}
                />
              </span>

              <span className="shrink-0 text-right text-[12px] font-medium tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                {d.display}
              </span>
            </RowTag>

            {isActive && d.tooltip?.length ? (
              <div
                role="tooltip"
                className={cn(
                  'pointer-events-none absolute right-0 top-full z-20 mt-1 w-max max-w-[320px]',
                  'rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)]',
                  'bg-[var(--c3-style-basic-bg-secondary)] px-3 py-2 shadow-lg',
                )}
              >
                <p className="mb-1 text-[12px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
                  {d.label}
                </p>
                <dl className="flex flex-col gap-0.5">
                  {d.tooltip.map((t) => (
                    <div key={t.label} className="flex items-baseline justify-between gap-4">
                      <dt className="text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                        {t.label}
                      </dt>
                      <dd className="text-[11px] font-medium tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                        {t.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        );
      })}

      {hiddenRows.length ? (
        <p className="mt-1.5 px-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
          + {hiddenRows.length} smaller categories, {''}
          {hiddenRows.reduce((s, d) => s + d.value, 0) > 0
            ? `${((hiddenRows.reduce((s, d) => s + d.value, 0) / data.reduce((s, d) => s + d.value, 0)) * 100).toFixed(1)}% of the total`
            : 'no recorded spend'}
        </p>
      ) : null}
    </div>
  );
}
