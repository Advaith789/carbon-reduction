/*
 * Intercept — the decision-time page. The only one that changes an outcome, and
 * the only one that writes.
 *
 * **Three things:** the scoreboard, the queue, and the ladder for whichever
 * request is selected.
 *
 * **Nothing here is computed in the browser.** Every figure comes off
 * {@link InterceptAgent}: `queue` for the list, `interceptStats` for the
 * scoreboard, `evaluate` for the ladder, `decide` for the buttons. This file used
 * to carry a 436-line TypeScript copy of the whole ladder — a second
 * implementation of the reuse match, the substitution test, the consolidation
 * scan and the spend-based factor — and it quietly disagreed with the agent: it
 * never *stacked* the rungs, so a request the agent can fully cover by claiming
 * surplus and merging the remainder read as partially avoidable here. The numbers
 * on this page changed when it was deleted, because they were wrong.
 *
 * The other consequence of talking to the real agent is that decisions are real.
 * `decide` writes {@link PurchaseRequest#status} and appends to its
 * justification, so this page refetches rather than patching its own copy, keeps
 * decided rows visible instead of dropping them out of the list, and offers
 * `reset` as the only honest undo.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  Clock,
  Info,
  Recycle,
  RotateCcw,
  SearchX,
  ShieldAlert,
} from 'lucide-react';

import PageShell, { Section } from '@/components/badger/PageShell';
import Panel from '@/components/badger/Panel';
import StatTile from '@/components/badger/StatTile';
import Term from '@/components/badger/Term';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/badger/DataState';
import { Button } from '@/components/ui/button';
import { useBuckyBinding } from '@/contexts/BuckyProvider';
import { cn } from '@/lib/utils';
import {
  BASELINE_FY,
  decideRequest,
  fetchInterceptEvaluation,
  fetchInterceptQueue,
  fetchInterceptStats,
} from '@/api/badger';
import { pct, shortDate, tonnes, usd } from '@/lib/badger/format';
import { STATUS } from '@/lib/badger/palette';
import type {
  DecisionAction,
  InterceptDecision,
  InterceptEvaluation,
  InterceptOption,
  InterceptQueue,
  InterceptStats,
  LeverKind,
  RequestStatus,
  ReuseProximity,
} from '@/types/badger';

/**
 * The agents state every percentage as a 0–100 double; `pct()` takes a 0–1
 * fraction. Divided here and nowhere else, so a missed division cannot render
 * 80.8% as "8080%".
 */
const asFraction = (p: number) => p / 100;

/**
 * Lever identity is carried by an **icon plus a word**, not by a fourth hue. The
 * validated palette proves three categorical slots; there are four levers, so
 * colour is the wrong channel for this distinction.
 *
 * `decisionAction` is where the ladder meets the write path. Three rungs map to a
 * status of their own; **deferral does not.** The agent's own caveat on that rung
 * is that it is an over-ordering risk estimate rather than a booked saving, so
 * recording it as realised carbon would be a lie. A deferral is therefore written
 * as `decline` — this request withdrawn, to be raised again when the need is
 * confirmed — which is also what actually happens in a purchasing system.
 */
const LEVER_META: Record<
  LeverKind,
  { label: string; icon: React.ElementType; blurb: string; decisionAction: DecisionAction; cta: string }
> = {
  reuse: {
    label: 'Reuse',
    icon: Recycle,
    blurb: 'Somebody nearby already has it. Avoids the entire upstream footprint.',
    decisionAction: 'reuse',
    cta: 'Claim the surplus',
  },
  substitute: {
    label: 'Substitute',
    icon: ArrowLeftRight,
    blurb: 'Same function, lower embodied carbon, already on contract.',
    decisionAction: 'substitute',
    cta: 'Buy the contract line',
  },
  consolidate: {
    label: 'Consolidate',
    icon: Boxes,
    blurb: 'One delivery instead of several. Small carbon win, real cost win.',
    decisionAction: 'consolidate',
    cta: 'Merge the orders',
  },
  defer: {
    label: 'Defer',
    icon: Clock,
    blurb: 'A year-end order worth a second look before the money is committed.',
    decisionAction: 'decline',
    cta: 'Send back for the new year',
  },
};

/** How the proximity rungs read in a sentence. The agent ranks reuse by these first. */
const PROXIMITY_LABEL: Record<ReuseProximity, string> = {
  same_department: 'same department',
  same_building: 'same building',
  nearby: 'a short walk',
  campus: 'elsewhere on campus',
};

/**
 * Where the surplus actually is. The rung name alone is not enough — `campus`
 * covers everything from the next quad to the far side of Lake Mendota — so the
 * metres the agent computed from the two buildings' coordinates are printed
 * whenever the answer is not trivially "here". Whether 730 m is walkable is the
 * reader's call, not the agent's, and they can only make it if they see it.
 */
function proximityLabel(proximity: ReuseProximity, distanceMeters: number | null): string {
  const name = PROXIMITY_LABEL[proximity];
  const elsewhere = proximity === 'nearby' || proximity === 'campus';
  return elsewhere && distanceMeters !== null && distanceMeters > 0
    ? `${name} · ${Math.round(distanceMeters)} m`
    : name;
}

/** A decided request keeps its badge; only the three accepted rungs are a win. */
function statusTone(status: RequestStatus): string | null {
  if (status === 'Reused' || status === 'Substituted' || status === 'Consolidated') return STATUS.good;
  if (status === 'Approved' || status === 'Declined') return 'var(--c3-style-basic-fg-secondary)';
  return null;
}

/** The one-word reason a human clicked, written into the audit trail with the status. */
function reasonForOption(o: InterceptOption): string {
  switch (o.action) {
    case 'reuse':
      return `Claiming the surplus held by ${o.sourceDepartmentName ?? 'another department'}.`;
    case 'substitute':
      return `Switching to ${o.contractProductName} on an existing contract.`;
    case 'consolidate':
      return `Merging with ${o.ordersAvoided} other request${o.ordersAvoided === 1 ? '' : 's'} to the same building.`;
    case 'defer':
      return 'Deferred into the new fiscal year, to be raised again when the need is confirmed.';
  }
}

export default function Intercept() {
  const [queue, setQueue] = useState<InterceptQueue | null>(null);
  const [stats, setStats] = useState<InterceptStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<InterceptEvaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<InterceptDecision | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');

  /* The queue and the portfolio totals, together: the scoreboard contrasts
     `avoidableTonnes` with `realised.tonnes`, and only the second of those moves
     when a decision is recorded. Both are reloaded after every write. */
  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const [q, s] = await Promise.all([
        fetchInterceptQueue('all', 50),
        fetchInterceptStats(BASELINE_FY),
      ]);
      setQueue(q);
      setStats(s);
      setActiveId((cur) => cur ?? q.rows[0]?.requestId ?? null);
    } catch (e) {
      // No fallback: a failed call must be visible, not papered over with fiction.
      setError(e instanceof Error ? e.message : String(e));
      setQueue(null);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  /* One evaluation at a time, fetched on selection. It scans the surplus list,
     the contract catalogue and every other pending request, so evaluating all
     thirteen up front would cost thirteen times what the open one costs. */
  const loadEvaluation = useCallback(async (requestId: string) => {
    setEvalError(null);
    try {
      setEvaluation(await fetchInterceptEvaluation(requestId));
    } catch (e) {
      setEvaluation(null);
      setEvalError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void loadEvaluation(activeId);
  }, [activeId, loadEvaluation]);

  const activeRow = useMemo(
    () => queue?.rows.find((r) => r.requestId === activeId) ?? null,
    [queue, activeId],
  );

  /* Bucky floats over every page now rather than sitting in a panel at the bottom of
     this one, so this page has to hand the dock the two things the dock cannot know:
     which request is on screen, and what to reread once a confirmed `intercept_decide`
     lands. Without the second, the queue in front of you would quietly disagree with
     the statuses that were just persisted. */
  useBuckyBinding({
    scenario: { selectedRequestId: activeId, queued: queue?.requestCount ?? 0 },
    onWriteCommitted: () => {
      void loadQueue();
      if (activeId) void loadEvaluation(activeId);
    },
  });

  function select(requestId: string) {
    setActiveId(requestId);
    setEvaluation(null);
    setReceipt(null);
    setReasonOpen(false);
    setReason('');
  }

  /** Record a decision, then reread everything from the server. */
  async function decide(action: DecisionAction, why: string) {
    if (!activeId || busy) return;
    setBusy(true);
    try {
      const res = await decideRequest(activeId, action, why);
      setReceipt(action === 'reset' ? null : res);
      setReasonOpen(false);
      setReason('');
      await Promise.all([loadQueue(), loadEvaluation(activeId)]);
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <PageShell title="Purchase intercept">
        <ErrorState message={error} onRetry={() => void loadQueue()} />
      </PageShell>
    );
  }

  if (loading || !queue || !stats) {
    return (
      <PageShell kicker="Present · Decide" title="Intercept, before the money is spent">
        <LoadingBlock height={420} label="Evaluating the request queue…" />
      </PageShell>
    );
  }

  const decided = stats.realised;
  const notBought = queue.requestCount - queue.requestsWithOpportunity;

  return (
    <PageShell
      kicker="Present · Decide"
      title="Intercept, before the money is spent"
      standfirst={
        <>
          The one page where the outcome is still open. For each pending request the agent asks
          whether the same need can be met without a new purchase — then a{' '}
          <Term id="intercept">human decides</Term>, and the decision is written down.
        </>
      }
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)] px-3 py-1.5 text-[11px] font-medium text-[var(--c3-style-basic-fg-secondary)]">
          <Info className="size-3.5" aria-hidden />
          Suggests, never blocks — every request can proceed
        </span>
      }
    >
      {/* ------------------------------ scoreboard ---------------------------
          Three tiles. The middle one is the only figure on the page that moves
          when you click, because it counts what was accepted rather than what
          was offered — and it is read off the persisted statuses, so it survives
          a reload. A total accumulated in browser state would not. */}
      <div className="mb-7 grid gap-3 md:grid-cols-3">
        <StatTile
          label="In the queue"
          value={String(queue.requestCount)}
          caption={`${tonnes(queue.totalEstimatedTonnes)} of embodied carbon · ${queue.requestsWithOpportunity} have an alternative, ${notBought} should just be bought${
            decided.decidedCount > 0 ? ` · ${decided.decidedCount} already decided` : ''
          }`}
        />
        <StatTile
          label="Avoided so far"
          value={tonnes(decided.tonnes, false)}
          unit="tCO₂e"
          tone={decided.tonnes > 0 ? 'good' : 'neutral'}
          caption={`${decided.note} ${
            decided.usd > 0
              ? `${usd(decided.usd)} stays with the department that took the suggestion.`
              : `${usd(stats.avoidableUsd)} is on the table, and the saving stays with whoever takes it.`
          }`}
        />
        {stats.goal ? (
          <StatTile
            label={`Share of the ${stats.goal.targetYear} gap`}
            value={pct(asFraction(stats.goal.interceptSharePct), 1)}
            caption={stats.goal.note}
          />
        ) : (
          <StatTile
            label="Share of campus carbon"
            value={pct(asFraction(stats.campusContext.queueShareOfCampusTonnesPct), 1)}
            caption={`This queue against all ${tonnes(stats.campusContext.campusTonnes)} of FY${stats.campusContext.fiscalYear} purchasing.`}
          />
        )}
      </div>

      <Section
        title="Why this is the agent that matters"
        description="The analyst says what happened; the planner says what could. This one acts while the decision is still open."
      >
        <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
          {/* ------------------------------ queue ----------------------------- */}
          <Panel
            title="The queue"
            subtitle="Ordered by the size of the alternative, not by the size of the purchase"
            note={
              <>
                What each request would emit if approved unchanged, and the plan the agent would
                run. Decided rows stay in the list with their new status — a decision here is a
                real write.
              </>
            }
          >
            {queue.rows.length === 0 ? (
              <EmptyState message="No purchase requests in the queue." />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {queue.rows.map((r) => {
                  const isActive = r.requestId === activeId;
                  const tone = statusTone(r.status);
                  const meta = r.topAction === 'proceed' ? null : LEVER_META[r.topAction as LeverKind];
                  const Icon = meta?.icon ?? CheckCircle2;

                  return (
                    <li key={r.requestId}>
                      <button
                        type="button"
                        onClick={() => select(r.requestId)}
                        className={cn(
                          'w-full rounded-[var(--c3-style-border-radius-6)] border px-3 py-2.5 text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]',
                          isActive
                            ? 'border-[var(--c3-style-basic-fg-accent)] bg-white/[0.045]'
                            : 'border-[var(--c3-style-basic-border-border)] hover:bg-white/[0.028]',
                          tone && 'opacity-80',
                        )}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="min-w-0 truncate text-[13px] font-medium text-[var(--c3-style-basic-fg-primary)]">
                            {r.productName}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-[var(--c3-style-basic-fg-secondary)]">
                            {usd(r.amount)} · {tonnes(r.estimatedTonnes)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                          {r.quantity} units · {r.departmentName ?? '—'} ·{' '}
                          {r.buildingName ?? '—'} · {shortDate(r.requestDate ?? undefined)}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {tone ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-[2px] text-[10px] font-semibold"
                              style={{ color: tone, boxShadow: `inset 0 0 0 1px ${tone}` }}
                            >
                              <CheckCircle2 className="size-3" aria-hidden />
                              {r.status}
                            </span>
                          ) : null}
                          {meta ? (
                            <span className="inline-flex items-center gap-1 rounded-[3px] bg-white/[0.06] px-1.5 py-[2px] text-[10px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
                              <Icon className="size-3" aria-hidden />
                              {meta.label} · −{tonnes(r.avoidedTonnes)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-[2px] text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                              <CheckCircle2 className="size-3" aria-hidden />
                              Nothing credible found
                            </span>
                          )}
                          {r.reuseProximity ? (
                            <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                              {proximityLabel(r.reuseProximity, r.reuseDistanceMeters)}
                            </span>
                          ) : null}
                          {r.optionCount > 1 ? (
                            <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                              {r.optionCount} options
                            </span>
                          ) : null}
                          {r.yearEndFlag ? (
                            <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                              year-end
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* ----------------------------- detail ---------------------------- */}
          <div className="flex min-w-0 flex-col gap-3">
            {evalError ? (
              <ErrorState
                message={evalError}
                onRetry={() => (activeId ? void loadEvaluation(activeId) : undefined)}
              />
            ) : null}

            {!activeRow ? (
              <EmptyState message="Select a request to see its options." />
            ) : !evaluation ? (
              <LoadingBlock height={300} label={`Evaluating ${activeRow.productName}…`} />
            ) : (
              <>
                <Panel
                  title={evaluation.request.productName}
                  subtitle={`${evaluation.request.quantity} × ${usd(evaluation.request.unitPrice)} = ${usd(
                    evaluation.request.amount,
                  )} · ${evaluation.request.categoryName ?? '—'}`}
                  note={`Requested by ${evaluation.request.requestedBy ?? 'a department buyer'} on ${shortDate(
                    evaluation.request.requestDate ?? undefined,
                  )} for ${evaluation.request.departmentName ?? '—'}, ${
                    evaluation.request.buildingName ?? '—'
                  }. Preferred vendor: ${evaluation.request.vendorName ?? '—'}.`}
                >
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)]">
                        If approved unchanged
                      </p>
                      <p className="mt-0.5 text-[26px] font-semibold leading-none tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                        {tonnes(evaluation.estimated.tonnes)}
                      </p>
                      {/* The method is never hidden: a product-footprint estimate and
                          a spend-based one are not the same kind of claim. */}
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                        {evaluation.estimated.basis}
                      </p>
                    </div>
                    {evaluation.request.status !== 'Pending' ? (
                      <Button
                        variant="outline"
                        appearance="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void decide('reset', 'Decision withdrawn from the review screen.')}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        Return to the queue
                      </Button>
                    ) : null}
                  </div>

                  {receipt ? (
                    <p
                      className="mt-3 border-t border-[var(--c3-style-basic-border-border)] pt-2.5 text-[12px] leading-relaxed"
                      style={{ color: receipt.accepted ? STATUS.good : undefined }}
                    >
                      <span className="font-semibold">Recorded as {receipt.status}. </span>
                      {receipt.accepted
                        ? `${tonnes(receipt.realisedTonnes)} and ${usd(receipt.realisedUsd)} credited${
                            receipt.counterparty ? `, from ${receipt.counterparty}` : ''
                          }. ${tonnes(receipt.residualTonnes)} still ordered.`
                        : (receipt.barrierSignal?.note ??
                          'No suggestion existed for this request, so nothing was forgone.')}
                      {receipt.barrierSignal
                        ? ` ${tonnes(receipt.barrierSignal.forgoneTonnes)} and ${usd(
                            receipt.barrierSignal.forgoneUsd,
                          )} left on the table — which is the data worth having.`
                        : ''}
                    </p>
                  ) : evaluation.request.justification ? (
                    <p className="mt-3 border-t border-[var(--c3-style-basic-border-border)] pt-2.5 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                      <span className="font-medium text-[var(--c3-style-basic-fg-primary)]">
                        Justification:{' '}
                      </span>
                      {evaluation.request.justification}
                    </p>
                  ) : null}
                </Panel>

                {evaluation.options.length === 0 ? (
                  <Panel title="No action needed — approve as requested">
                    <p className="text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                      {evaluation.recommendation.summary}
                    </p>
                    {/* Why rung 1 found nothing, from the surplus list the agent
                        actually searched. "No suggestions" would hide three
                        different problems belonging to three different people. */}
                    {evaluation.reuseGap ? (
                      <div className="mt-3 flex gap-2 rounded-[4px] border border-[var(--c3-style-basic-border-border)] bg-white/[0.02] p-2.5">
                        <SearchX
                          className="mt-[1px] size-4 shrink-0 text-[var(--c3-style-basic-fg-secondary)]"
                          aria-hidden
                        />
                        <div>
                          <p className="text-[12px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
                            Why there is no reuse option
                          </p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                            {evaluation.reuseGap}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {evaluation.request.status === 'Pending' ? (
                      <div className="mt-3">
                        <Button
                          variant="outline"
                          appearance="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void decide('approve', 'No credible alternative found; unavoidable demand.')
                          }
                        >
                          Approve as requested
                        </Button>
                      </div>
                    ) : null}
                  </Panel>
                ) : (
                  <Panel
                    title="The lever ladder"
                    subtitle="Ordered by carbon avoided. Hover a lever name for what that lever is."
                    note={
                      <>
                        Every figure is computed by the agent, with the assumption behind it
                        printed underneath it.{' '}
                        <Term id="avoided-emissions">
                          &ldquo;Avoided&rdquo; is a counterfactual
                        </Term>
                        , not a cut in the measured ledger.
                      </>
                    }
                  >
                    {/* The agent's actual advice, which is not the same as its option
                        list: the options are alternatives, the plan stacks them. */}
                    {evaluation.recommendation.steps.length > 1 ? (
                      <div className="mb-3 rounded-[4px] border border-[var(--c3-style-basic-fg-accent)] bg-white/[0.03] p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--c3-style-basic-fg-accent)]">
                          Recommended plan · −{tonnes(evaluation.recommendation.avoidedTonnes)} (
                          {pct(asFraction(evaluation.recommendation.avoidedPct), 0)} of this request)
                        </p>
                        <ol className="mt-1.5 flex flex-col gap-1">
                          {evaluation.recommendation.steps.map((s) => (
                            <li
                              key={s.order}
                              className="text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]"
                            >
                              <span className="font-semibold text-[var(--c3-style-basic-fg-primary)]">
                                {s.order}. {LEVER_META[s.action].label} {s.units} ·{' '}
                                −{tonnes(s.avoidedTonnes)}
                              </span>{' '}
                              {s.detail}
                            </li>
                          ))}
                        </ol>
                        <p className="mt-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                          The rungs stack: claim what exists, buy only the remainder.{' '}
                          {evaluation.recommendation.unitsStillOrdered > 0
                            ? `${evaluation.recommendation.unitsStillOrdered} units still ordered, ${tonnes(
                                evaluation.recommendation.residualTonnes,
                              )} residual.`
                            : 'Nothing new needs to be ordered.'}
                        </p>
                      </div>
                    ) : null}

                    <ul className="flex flex-col gap-2.5">
                      {evaluation.options.map((o, i) => {
                        const meta = LEVER_META[o.action];
                        const Icon = meta.icon;
                        return (
                          <li
                            key={`${o.action}-${o.rank}-${i}`}
                            className={cn(
                              'rounded-[var(--c3-style-border-radius-6)] border p-3',
                              i === 0
                                ? 'border-[var(--c3-style-basic-border-border)] bg-white/[0.025]'
                                : 'border-[var(--c3-style-basic-border-border)]',
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              {/* The four-panel "what each lever is" section was cut;
                                  `blurb` is the whole of it, attached to its badge. */}
                              <span
                                title={meta.blurb}
                                className="inline-flex cursor-help items-center gap-1 rounded-[3px] bg-white/[0.07] px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--c3-style-basic-fg-primary)]"
                              >
                                <Icon className="size-3" aria-hidden />
                                {meta.label}
                              </span>
                              {i === 0 ? (
                                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--c3-style-basic-fg-accent)]">
                                  Best available
                                </span>
                              ) : null}
                              {o.action === 'reuse' ? (
                                <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                                  {proximityLabel(o.proximity, o.distanceMeters)}
                                  {o.full ? '' : ` · covers ${pct(asFraction(o.coversPct), 0)}`}
                                </span>
                              ) : null}
                              {o.action === 'substitute' ? (
                                <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                                  {/* The delta is signed: positive means the contract line is
                                      cheaper. A lower-carbon substitute that costs *more* is a
                                      real case, and printing "−18% cheaper" would hide it. */}
                                  {pct(asFraction(Math.abs(o.unitPriceDeltaPct)), 0)}{' '}
                                  {o.unitPriceDeltaPct >= 0 ? 'cheaper' : 'dearer'} per unit
                                </span>
                              ) : null}
                              {o.action === 'consolidate' ? (
                                <span className="text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
                                  {o.ordersAvoided} deliver{o.ordersAvoided === 1 ? 'y' : 'ies'} removed
                                </span>
                              ) : null}
                              <span className="ml-auto text-[12px] font-semibold tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                                −{tonnes(o.avoidedTonnes)}
                              </span>
                              <span
                                className="text-[12px] font-semibold tabular-nums"
                                style={{ color: STATUS.good }}
                              >
                                {usd(o.avoidedUsd)}
                              </span>
                            </div>

                            <p className="mt-2 text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-primary)]">
                              {o.message}
                            </p>

                            {o.action === 'reuse' && o.ownerNotes ? (
                              <p className="mt-1 text-[11px] italic leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                                Holder&apos;s note: {o.ownerNotes}
                              </p>
                            ) : null}
                            {o.action === 'substitute' ? (
                              <p className="mt-1 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                                {o.evidence}
                              </p>
                            ) : null}
                            {o.action === 'consolidate' && o.peers.length > 0 ? (
                              <p className="mt-1 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                                Waiting with it:{' '}
                                {o.peers
                                  .map((p) => `${p.productName} (${p.departmentName ?? '—'})`)
                                  .join('; ')}
                                .
                              </p>
                            ) : null}
                            {o.action === 'defer' ? (
                              <p
                                className="mt-1 flex gap-1.5 text-[11px] leading-relaxed"
                                style={{ color: STATUS.warning }}
                              >
                                <ShieldAlert className="mt-[1px] size-3.5 shrink-0" aria-hidden />
                                {o.caveat}
                              </p>
                            ) : null}

                            <p className="mt-2 border-t border-[var(--c3-style-basic-border-border)] pt-2 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                              <span className="font-semibold">Basis: </span>
                              {o.basis}
                            </p>

                            {evaluation.request.status === 'Pending' ? (
                              <div className="mt-2.5">
                                <Button
                                  variant="outline"
                                  appearance="accent"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void decide(meta.decisionAction, reasonForOption(o))}
                                >
                                  {meta.cta}
                                </Button>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>

                    {/* Suggest, never block. The reason box is the most useful data
                        this tool collects: it names the barrier, not the failure. */}
                    {evaluation.request.status === 'Pending' ? (
                      <div className="mt-3 border-t border-[var(--c3-style-basic-border-border)] pt-3">
                        {reasonOpen ? (
                          <div className="flex flex-col gap-2">
                            <label
                              htmlFor="decline-reason"
                              className="text-[11px] font-medium text-[var(--c3-style-basic-fg-primary)]"
                            >
                              Why was the suggestion not usable? (optional)
                            </label>
                            <textarea
                              id="decline-reason"
                              rows={2}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="e.g. grant requires a specific catalogue number"
                              className="w-full resize-none rounded-[4px] border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-secondary)] px-2.5 py-2 text-[12px] text-[var(--c3-style-basic-fg-primary)] placeholder:text-[var(--c3-style-basic-fg-secondary)] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]"
                            />
                            <div className="flex gap-2">
                              <Button
                                variant="solid"
                                appearance="secondary"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void decide(
                                    'approve',
                                    reason || 'Approved as requested; no reason given.',
                                  )
                                }
                              >
                                Approve as requested
                              </Button>
                              <Button
                                variant="ghost"
                                appearance="secondary"
                                size="sm"
                                onClick={() => {
                                  setReasonOpen(false);
                                  setReason('');
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-3">
                            <Button
                              variant="outline"
                              appearance="secondary"
                              size="sm"
                              onClick={() => setReasonOpen(true)}
                            >
                              Approve as requested anyway
                            </Button>
                            <p className="text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                              Nothing here is a gate. Research does not wait for a carbon tool.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </Panel>
                )}
              </>
            )}
          </div>
        </div>
      </Section>

      {/*
        No copilot panel here any more — see the `useBuckyBinding` call above. This is
        still the one page where Bucky can propose a *write*, and therefore the page
        where the confirm gate earns its keep: `intercept_decide` is declared to the
        model but never executed by `ask`, so a proposed decision arrives in the dock as
        an offer with its arguments visible and a person approves it. The intercept's own
        contract — it suggests, a human decides — enforced in code rather than asserted
        in a paragraph.
      */}
    </PageShell>
  );
}
