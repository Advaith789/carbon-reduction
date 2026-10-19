/*
 * The inline chat panel — a second window onto the *same* conversation {@link BuckyDock}
 * shows, embedded in a page's layout.
 *
 * It used to own its transcript in local state, which made every page a separate
 * conversation that was destroyed on navigation. The transcript now lives in
 * {@link BuckyProvider}, and this component is a presentational view onto it: anything
 * asked here appears in the floating dock and vice versa, and switching pages no longer
 * loses the thread.
 *
 * **Why keep an inline panel at all, when there is a global one?** On the Planner it is
 * the point of the page. Typing "we can only cut IT hardware 4%" and watching the
 * sliders physically move while the answer explains the shortfall is a single visual
 * claim — that the narration and the controls are computed from the same solver call —
 * and it only reads that way when both are on screen together. Pages with nothing to
 * drive do not embed this; they rely on the dock.
 *
 * Two behaviours are load-bearing rather than cosmetic:
 *
 * - **A `uiAction` is handed to the host page, not applied here.** The planner responds
 *   by moving its own sliders and re-rendering against the same
 *   {@link PlannerAgent#solve} result the narration was written from, so the controls on
 *   screen and the prose in the transcript cannot disagree.
 * - **A `pendingAction` renders as a button, never as a completed act** — see
 *   {@link CopilotTurn}, which owns that rendering for both surfaces.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { TurnBubble } from '@/components/badger/CopilotTurn';
import { useBucky, useBuckyBinding } from '@/contexts/BuckyProvider';
import type { CopilotPage, CopilotUiAction } from '@/api/copilot';

interface CopilotPanelProps {
  /**
   * Which page is asking.
   *
   * Retained for the input's element id and for callers that predate the provider. Tool
   * selection is no longer biased from here — {@link BuckyProvider} derives the page from
   * the route instead, because the dock is mounted outside `<Routes>` and has no page
   * component to ask, and two sources of truth for the same value would drift.
   */
  page: CopilotPage;
  /**
   * The caller's live on-screen state, serialised into the model's instructions so
   * follow-ups like "what if we *also* capped plastics?" resolve against what the user is
   * looking at. Pass the current pins/target/strategy on the planner.
   */
  scenario?: Record<string, unknown> | null;
  /** Click-to-ask starters. Keep them short and answerable by one or two tools. */
  suggestions?: string[];
  /**
   * Called when the model's answer implies the page should change its own state. Omit on
   * pages that have nothing to drive.
   */
  onUiAction?: (action: CopilotUiAction) => void;
  /** Called after a confirmed write succeeds, so the host can refetch. */
  onWriteCommitted?: () => void;
  className?: string;
}

/** Fixed header copy, so the grounding claim is stated before anything is asked. */
const STANDFIRST =
  'Ask in plain English. Bucky picks which agent methods to run and reports which ones it used — it never computes a figure itself.';

export default function CopilotPanel({
  page,
  scenario = null,
  suggestions = [],
  onUiAction,
  onWriteCommitted,
  className,
}: CopilotPanelProps) {
  const { turns, busy, send } = useBucky();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Contribute this page's live state and handlers to the shared conversation, so an
  // answer asked from the floating dock can still move this page's controls.
  useBuckyBinding({ scenario, onUiAction, onWriteCommitted });

  // Keep the newest turn in view without yanking the page itself around.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const submit = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message) return;
      setDraft('');
      void send(message);
    },
    [send],
  );

  const empty = turns.length === 0;

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col rounded-[var(--c3-style-border-radius-6)]',
        'border border-[var(--c3-style-basic-border-border)]',
        'bg-[var(--c3-style-basic-bg-primary)]',
        className,
      )}
    >
      <div className="border-b border-[var(--c3-style-basic-border-border)] px-4 pt-3.5 pb-2.5">
        <h3 className="flex items-center gap-1.5 text-[13px] leading-snug font-semibold text-[var(--c3-style-basic-fg-primary)]">
          <Sparkles
            className="size-3.5 shrink-0 text-[var(--c3-style-basic-fg-accent)]"
            aria-hidden
          />
          Bucky
        </h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
          {STANDFIRST}
        </p>
      </div>

      <div ref={scrollRef} className="min-h-[7rem] flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {empty ? (
          <p className="text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
            Nothing asked yet. The page below works entirely without this panel.
          </p>
        ) : (
          turns.map((turn, i) => (
            <TurnBubble key={i} turn={turn} onWriteCommitted={onWriteCommitted} />
          ))
        )}
        {busy ? (
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
            <Spinner size="sm" />
            Routing to the agents…
          </p>
        ) : null}
      </div>

      {suggestions.length > 0 && empty ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => submit(s)}
              className={cn(
                'rounded-[var(--c3-style-border-radius-6)] border px-2 py-1 text-left text-[11px] leading-snug',
                'border-[var(--c3-style-basic-border-border)] text-[var(--c3-style-basic-fg-secondary)]',
                'hover:text-[var(--c3-style-basic-fg-primary)] disabled:opacity-50',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-1.5 border-t border-[var(--c3-style-basic-border-border)] px-4 py-2.5">
        <label htmlFor={`copilot-input-${page}`} className="sr-only">
          Ask Bucky
        </label>
        <Textarea
          id={`copilot-input-${page}`}
          rows={2}
          value={draft}
          disabled={busy}
          placeholder="e.g. we can only cut IT hardware 4% — can we still hit 2030?"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
          className="min-h-0 resize-none text-[12px]"
        />
        <Button
          size="sm"
          appearance="accent"
          loading={busy}
          disabled={!draft.trim()}
          onClick={() => submit(draft)}
          leadingIcon={<Send className="size-3.5" aria-hidden />}
        >
          Ask
        </Button>
      </div>
    </div>
  );
}
