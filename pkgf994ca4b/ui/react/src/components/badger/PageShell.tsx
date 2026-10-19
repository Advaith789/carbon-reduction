/*
 * Consistent page frame: kicker, title, standfirst, optional actions.
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface PageShellProps {
  /** Small all-caps label above the title — the Past/Present/Future framing. */
  kicker?: string;
  title: string;
  /**
   * One sentence saying what question this page answers.
   *
   * Typed as a node rather than a string so a standfirst can carry an inline
   * {@link Term} link — the mechanism that lets the page stay one sentence long while
   * the definition of "Scope 3" or "spend-based" remains one click away on the FAQ.
   */
  standfirst?: React.ReactNode;
  /** Controls aligned to the right of the title row. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Every page uses this so headings, gutters and vertical rhythm match exactly —
 * the "seamless" part is mostly consistency, not decoration.
 */
export default function PageShell({
  kicker,
  title,
  standfirst,
  actions,
  children,
  className,
}: PageShellProps) {
  return (
    <div className={cn('mx-auto w-full max-w-[1600px] px-6 py-6 lg:px-8', className)}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {kicker ? (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--c3-style-basic-fg-secondary)]">
              {kicker}
            </p>
          ) : null}
          <h1 className="text-[22px] font-semibold leading-tight text-[var(--c3-style-basic-fg-primary)]">
            {title}
          </h1>
          {standfirst ? (
            <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              {standfirst}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

/** A labelled section divider inside a page. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  /** Node rather than string, for the same reason as `standfirst` above. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-7', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
