/*
 * Surfaces: the card that wraps every chart, table and figure.
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface PanelProps {
  title?: string;
  /** Subtitle / standfirst — say what the reader should take away. */
  subtitle?: string;
  /** Right-aligned controls (filters, toggles) in the panel header. */
  actions?: React.ReactNode;
  /** Figure note shown beneath the content: units, method, caveats. */
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

/**
 * The single content surface used across the app, so every chart sits on the same
 * background with the same radius, border and padding.
 *
 * The `note` slot is not decoration: every figure built from a spend-based
 * estimate carries its unit and its method underneath, which is what keeps the
 * numbers honest when they are screenshotted out of context.
 */
export default function Panel({
  title,
  subtitle,
  actions,
  note,
  children,
  className,
  bodyClassName,
}: PanelProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-[var(--c3-style-border-radius-6)]',
        'border border-[var(--c3-style-basic-border-border)]',
        'bg-[var(--c3-style-basic-bg-primary)]',
        className,
      )}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-[13px] font-semibold leading-snug text-[var(--c3-style-basic-fg-primary)]">
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn('min-w-0 flex-1 px-4 pb-4', !title && !actions && 'pt-4', bodyClassName)}>
        {children}
      </div>
      {note ? (
        <div className="border-t border-[var(--c3-style-basic-border-border)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
          {note}
        </div>
      ) : null}
    </div>
  );
}
