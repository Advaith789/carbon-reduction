/*
 * How one chat turn renders — extracted so every surface that shows Bucky's answers
 * shows the *same* evidence.
 *
 * There are two such surfaces: the floating dock that follows the user across the
 * whole application, and the inline panel still embedded on the Planner (where
 * watching the sliders move in response to a sentence is the point of the page). If
 * the provenance strip lived in only one of them, the other would be free to render a
 * bare paragraph — and a bare paragraph from a language model is exactly the thing
 * this application is arguing against. Keeping it here makes that impossible.
 *
 * Two behaviours in this file are load-bearing rather than cosmetic:
 *
 * - **The provenance strip is not decoration.** It names the deterministic method that
 *   produced each figure, its arguments and its elapsed time, so a sceptical reader can
 *   replay the call. An answer with an empty strip is labelled unverified rather than
 *   shown as a result.
 * - **A `pendingAction` renders as an offer, never as a completed act.** The intercept's
 *   contract is that it suggests and a human decides; a model proposing to decline a
 *   purchase request must not be able to record it.
 */

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  confirmCopilotAction,
  type ChatTurn,
  type CopilotPendingAction,
  type CopilotToolCall,
} from '@/api/copilot';

/**
 * Render a manifest tool name as the call it actually dispatches to.
 *
 * The `agent_method` naming convention is what makes this possible: every tool in
 * {@link BadgerCopilot}'s registry is named for the real method it invokes, so
 * `forecast_buildingForecast` displays as `forecast.buildingForecast()` and a reader can
 * find that method in the source. A tool named for something it does not call would make
 * this strip actively misleading.
 */
function toolLabel(call: CopilotToolCall): string {
  const [agent, ...rest] = call.name.split('_');
  const method = rest.join('_');
  return `${agent}.${method}()`;
}

/**
 * The provenance strip — the component's reason for existing. A reader who does not
 * trust the prose can see exactly which audited method produced it, with what
 * arguments, and how long it took.
 */
export function Provenance({ calls }: { calls: CopilotToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-[var(--c3-style-basic-fg-accent)] pl-2.5">
      {calls.map((call, i) => (
        <li key={`${call.name}-${i}`} className="text-[11px] leading-relaxed">
          <span className="font-mono text-[var(--c3-style-basic-fg-accent)]">{toolLabel(call)}</span>
          <span className="text-[var(--c3-style-basic-fg-secondary)]"> · {call.ms}ms</span>
          {call.summary ? (
            <span className="text-[var(--c3-style-basic-fg-secondary)]"> · {call.summary}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * A write the model wants to make, held for approval.
 *
 * Rendered as an offer with its arguments visible, because approving a write you cannot
 * read is not consent.
 */
export function PendingAction({
  action,
  onConfirmed,
}: {
  action: CopilotPendingAction;
  onConfirmed: (summary: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <p className="mt-2 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
        Suggestion dismissed — nothing was recorded.
      </p>
    );
  }
  if (done) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-primary)]">
        <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{done}</span>
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-[var(--c3-style-border-radius-6)] border border-dashed border-[var(--c3-style-basic-border-border)] p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
        <ShieldQuestion className="size-3.5 shrink-0" aria-hidden />
        Needs your approval — nothing has been recorded yet
      </p>
      <p className="mt-1 font-mono text-[11px] leading-relaxed break-words text-[var(--c3-style-basic-fg-secondary)]">
        {action.name}({JSON.stringify(action.args)})
      </p>
      {failed ? (
        <p className="mt-1 text-[11px] text-[var(--c3-style-basic-fg-primary)]">{failed}</p>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <Button
          size="sm"
          appearance="accent"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setFailed(null);
            try {
              const res = await confirmCopilotAction(action);
              if (res.ok) {
                setDone(res.summary || 'Recorded.');
                onConfirmed(res.summary || 'Recorded.');
              } else {
                setFailed(res.error || 'The write was rejected.');
              }
            } catch (e) {
              setFailed(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Approve &amp; record
        </Button>
        <Button size="sm" variant="ghost" appearance="secondary" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** One message — the user's own, or Bucky's answer with its evidence attached. */
export function TurnBubble({
  turn,
  onWriteCommitted,
}: {
  turn: ChatTurn;
  onWriteCommitted?: () => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[var(--c3-style-border-radius-6)] bg-[var(--c3-style-basic-bg-secondary)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-primary)]">
          {turn.content}
        </p>
      </div>
    );
  }

  const unverified = turn.grounded === false && !turn.error;

  return (
    <div className="min-w-0">
      <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--c3-style-basic-fg-primary)]">
        {turn.content}
      </p>
      <Provenance calls={turn.toolCalls ?? []} />
      {unverified ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Unverified — no agent method ran, so this answer carries no computed figures. Treat it
            as context, not as a result.
          </span>
        </p>
      ) : null}
      {turn.pendingAction ? (
        <PendingAction action={turn.pendingAction} onConfirmed={() => onWriteCommitted?.()} />
      ) : null}
    </div>
  );
}
