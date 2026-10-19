/*
 * Stat tiles: the headline-number form, used when a chart would be overkill.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { STATUS } from '@/lib/badger/palette';

export type StatTone = 'neutral' | 'good' | 'warning' | 'critical';

const TONE_INK: Record<StatTone, string | undefined> = {
  neutral: undefined,
  good: STATUS.good,
  warning: STATUS.warning,
  critical: STATUS.critical,
};

interface StatTileProps {
  label: string;
  value: string;
  /** Unit or qualifier rendered small beside the value. */
  unit?: string;
  /** Supporting line beneath the value — what the number is measured against. */
  caption?: string;
  /** Tints the value. Reserved status colours only, and always with a caption. */
  tone?: StatTone;
  icon?: React.ReactNode;
  /** Renders larger, for the single most important number on a page. */
  hero?: boolean;
  className?: string;
}

/**
 * A single number with its label, unit and basis.
 *
 * Tone uses the reserved status palette and is never the only signal — a tinted
 * value always has a caption that states the condition in words, so the state is
 * legible without colour vision.
 */
export default function StatTile({
  label,
  value,
  unit,
  caption,
  tone = 'neutral',
  icon,
  hero = false,
  className,
}: StatTileProps) {
  const ink = TONE_INK[tone];
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-between gap-1.5 rounded-[var(--c3-style-border-radius-6)]',
        'border border-[var(--c3-style-basic-border-border)]',
        'bg-[var(--c3-style-basic-bg-primary)] px-4 py-3.5',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {icon ? (
          <span className="shrink-0 text-[var(--c3-style-basic-fg-secondary)]" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)]">
          {label}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span
          className={cn(
            'font-semibold tabular-nums leading-none text-[var(--c3-style-basic-fg-primary)]',
            hero ? 'text-[34px]' : 'text-[22px]',
          )}
          style={ink ? { color: ink } : undefined}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[12px] font-medium text-[var(--c3-style-basic-fg-secondary)]">
            {unit}
          </span>
        ) : null}
      </div>
      {caption ? (
        <p className="text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
