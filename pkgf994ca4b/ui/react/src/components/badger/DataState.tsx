/*
 * Loading and error states. There is deliberately no third state that
 * substitutes placeholder data for a failed fetch.
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STATUS } from '@/lib/badger/palette';

/** Shimmer placeholder sized to the block it will be replaced by. */
export function LoadingBlock({ height = 160, label }: { height?: number; label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex w-full animate-pulse items-center justify-center rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)] bg-white/[0.02]"
      style={{ height }}
    >
      <span className="text-[12px] text-[var(--c3-style-basic-fg-secondary)]">
        {label ?? 'Loading…'}
      </span>
    </div>
  );
}

/**
 * The visible failure surface. When a `c3Action` call fails the user sees this
 * and the real message — the app never silently falls back to fabricated
 * client-side numbers, because a dashboard that lies when the backend is down is
 * worse than one that stops.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] p-5"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4" style={{ color: STATUS.critical }} aria-hidden />
        <h2 className="text-[14px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
          Could not load data from the C3 backend
        </h2>
      </div>
      <p className="max-w-2xl text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
        Nothing is shown rather than something invented. The underlying error was:
      </p>
      <pre className="max-w-full overflow-x-auto rounded-[4px] bg-black/40 px-3 py-2 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
        {message}
      </pre>
      {onRetry ? (
        <Button variant="outline" appearance="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Neutral empty state for a query that legitimately returned nothing. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center rounded-[var(--c3-style-border-radius-6)] border border-dashed border-[var(--c3-style-basic-border-border)] p-6">
      <p className="text-center text-[12px] text-[var(--c3-style-basic-fg-secondary)]">{message}</p>
    </div>
  );
}
