/*
 * Planner — scenario planning. Explicitly not prediction.
 *
 * **Nothing on this page is computed in the browser.** Every allocation, cost and
 * feasibility verdict comes from `PlannerAgent.solve`; this file holds controls,
 * layout and prose. See `usePlannerSolve` for how a slider drag becomes one
 * debounced, order-guarded batch of solves instead of sixty racing requests.
 *
 * That move was not cosmetic. The client solver applied every lever at every
 * horizon, so it put the 2030 ceiling at 50.8% of baseline. The agent filters
 * levers by the year they can actually be in place — 19 of 35 by 2030 — which
 * puts the real 2030 ceiling at 24.4%, four points above the published 20%
 * target. The page used to say a 30% cut by 2030 was comfortable; it is in fact
 * 79 tCO2e out of reach, and saying so is the entire value of the exercise.
 *
 * **Three sections under one verdict banner:** set the scenario, pull the levers,
 * see where it lands. Previously there were four sections carrying eleven separate
 * figures — a five-tile stat row, a panel solving every milestone independently, a
 * gap meter, a glide path and a marginal abatement cost curve with its own top-five
 * table.
 *
 * What went, and why it was safe to lose:
 *   - **The stat row** repeated the banner. Baseline, required cut, delivered and
 *     blended cost are all sentences in the verdict already; the two that were not
 *     (baseline tonnes, net cost) are now in the gap meter's note, beside the bar
 *     they describe.
 *   - **The milestone-comparison panel** is now a single strip inside the banner.
 *     It was always one fact — which published targets survive the current pins —
 *     and one fact does not need a panel. Compressed, it is actually read.
 *   - **The MACC curve** was the one genuinely hard figure on the page: two
 *     encodings (width = tonnes supplied, height = $/tonne) that need a paragraph
 *     before they mean anything. Every lever's cost per tonne is already on its own
 *     slider, and `cheapest_first` strategy *is* the MACC, applied rather than
 *     drawn. Dropping it costs a picture and no information.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pin, RotateCcw, Sparkles } from 'lucide-react';

import PageShell, { Section } from '@/components/badger/PageShell';
import Panel from '@/components/badger/Panel';
import LeverSlider from '@/components/badger/LeverSlider';
import CopilotPanel from '@/components/badger/CopilotPanel';
import Term from '@/components/badger/Term';
import { GlidePathChart, GlidePathLegend } from '@/components/badger/Charts';
import { ErrorState, LoadingBlock } from '@/components/badger/DataState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBadgerData } from '@/contexts/BadgerDataProvider';
import type { CopilotUiAction } from '@/api/copilot';
import {
  glidePath,
  STRATEGY_DESCRIPTIONS,
  STRATEGY_LABELS,
  type Strategy,
} from '@/lib/badger/planner';
import { costPerTonne, pct, tonnes, usd, usdCompact } from '@/lib/badger/format';
import { STATUS } from '@/lib/badger/palette';
import { usePlannerSolve } from './usePlannerSolve';

const STRATEGIES: Strategy[] = ['equal', 'cheapest', 'effort'];

/**
 * Upper bound of the reduction-target slider, as a percentage.
 *
 * This must stay >= the most ambitious published {@link SustainabilityGoal}: the
 * net-zero 2048 target is a 95% cut, and a range input silently clamps its thumb
 * to `max` while the numeric readout beside it keeps showing the real figure. A
 * smaller ceiling here would make the control contradict its own label the moment
 * anyone selected that goal. The track fill is derived from the same constant so
 * the gradient and the thumb cannot drift apart.
 */
const TARGET_MAX_PCT = 100;

/**
 * Maps the copilot's strategy name onto this page's own union.
 *
 * The backend solver names its strategies `equal_pct` / `cheapest_first` /
 * `effort_balanced`; this page uses `equal` / `cheapest` / `effort`. The copilot
 * already translates on the way out, so this is a defensive second pass — it
 * accepts either vocabulary and falls back rather than crashing on a third.
 */
function toStrategy(raw: string): Strategy {
  if (raw === 'cheapest' || raw === 'cheapest_first') return 'cheapest';
  if (raw === 'effort' || raw === 'effort_balanced') return 'effort';
  return 'equal';
}

/** What the copilot last did to this page, shown so the binding is never invisible. */
interface AppliedFromChat {
  categoryIds: string[];
  targetYear: number;
  /** Pins whose magnitude looked like a 0–1 fraction and may be a units slip. */
  suspect: string[];
  /** True when no published goal matches the year the copilot solved for. */
  yearUnmatched: boolean;
}

export default function Planner() {
  const { data, loading, error, reload } = useBadgerData();

  const [strategy, setStrategy] = useState<Strategy>('equal');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [targetOverride, setTargetOverride] = useState<number | null>(null);
  /**
   * Pinned categories and the reduction each is held at, as fractions.
   *
   * One map rather than a `Set` plus a parallel `Map`: membership *is* the pin, so
   * there is no state in which a category is pinned to nothing.
   */
  const [pins, setPins] = useState<Map<string, number>>(new Map());
  const [appliedFromChat, setAppliedFromChat] = useState<AppliedFromChat | null>(null);

  const goals = useMemo(
    () => (data ? [...data.goals].sort((a, b) => a.targetYear - b.targetYear) : []),
    [data],
  );
  const goal = goals.find((g) => g.id === goalId) ?? goals[0];

  /**
   * The slider's own position, as a fraction. This is **input**, not a computed
   * figure, so it stays local and responds instantly; the verdict below reads the
   * depth the agent actually solved against (`result.targetPct`), which during
   * the debounce window can briefly be one step behind. That lag is labelled
   * rather than hidden — see the `solving` indicator.
   */
  const sliderPct = targetOverride ?? goal?.reductionPct ?? 0.2;

  /*
   * The whole scenario, sent to the server. Nothing on this page is solved in the
   * browser: `PlannerAgent.solve` allocates the cut across categories, decomposes
   * each category into named levers with owners, prices it, and returns the
   * feasibility verdict. The hook debounces the drag, discards out-of-order
   * replies, and re-solves every published milestone under the same pins.
   */
  const scenario = useMemo(
    () => ({
      targetYear: goal?.targetYear ?? 2030,
      targetPct: targetOverride,
      strategy,
      pins,
    }),
    [goal, targetOverride, strategy, pins],
  );

  const { result, goalComparison, solving, solveError } = usePlannerSolve(
    data ? data.planInputs : null,
    goals,
    scenario,
  );

  const glide = useMemo(() => {
    if (!data || !goal || !result) return [];
    return glidePath(
      data.yearTotals,
      data.baselineFy,
      goal.targetYear,
      result.targetPct,
      Math.max(0, data.cagr),
    );
  }, [data, goal, result]);

  /**
   * The page's live state, in the vocabulary the copilot speaks.
   *
   * Sent with every copilot question so a follow-up like "what if we *also* capped
   * plastics?" resolves against what is actually on screen. The only conversion
   * left is the units one — this page holds fractions, the agents' contract is
   * 0–100 — now that both sides call the same solver.
   */
  const copilotScenario = useMemo(
    () => ({
      targetYear: scenario.targetYear,
      targetPct: Math.round(sliderPct * 1000) / 10,
      strategy:
        strategy === 'cheapest'
          ? 'cheapest_first'
          : strategy === 'effort'
            ? 'effort_balanced'
            : 'equal_pct',
      pins: Object.fromEntries(
        [...pins.entries()].map(([id, v]) => [id, Math.round(v * 1000) / 10]),
      ),
    }),
    [scenario, sliderPct, strategy, pins],
  );

  /**
   * Apply a scenario the copilot set up.
   *
   * This is the whole point of the chat panel on this page: "we can only cut IT
   * hardware by 4%" arrives as a `uiAction` and physically moves the sliders.
   * Moving them re-solves against `PlannerAgent.solve` — the same method the
   * copilot itself called to answer in prose — so the controls and the narration
   * cannot disagree, because they are the same computation run twice. The chat
   * sets up the question; it does not supply the answer, and it no longer even
   * has a second implementation it could accidentally disagree with.
   *
   * Note the unit conversion: the copilot speaks 0–100 percentages (the backend
   * agents' contract) and this page stores 0–1 fractions.
   */
  const applyCopilotAction = useCallback(
    (action: CopilotUiAction) => {
      if (action.type !== 'planner.applyPins') return;
      const ids = Object.keys(action.pins);
      if (ids.length === 0) return;

      setPins(new Map(ids.map((id) => [id, action.pins[id] / 100])));
      setStrategy(toStrategy(action.strategy));

      // The copilot names a target *year*; this page selects a published goal. A
      // year with no matching milestone leaves the target alone and says so rather
      // than silently planning against something the user did not ask for.
      const match = goals.find((g) => g.targetYear === action.targetYear);
      if (match) {
        setGoalId(match.id);
        setTargetOverride(null);
      }

      setAppliedFromChat({
        categoryIds: ids,
        targetYear: action.targetYear,
        suspect: Object.keys(action.suspectFractions),
        yearUnmatched: !match,
      });
    },
    [goals],
  );

  function handleSliderChange(categoryId: string, fraction: number) {
    // Dragging a category *is* pinning it: the value you set is held and the
    // solver redistributes everything else around it.
    setPins((cur) => new Map(cur).set(categoryId, fraction));
    setAppliedFromChat(null);
  }

  function togglePin(categoryId: string, currentPct: number) {
    setAppliedFromChat(null);
    setPins((cur) => {
      const next = new Map(cur);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.set(categoryId, currentPct);
      return next;
    });
  }

  function reset() {
    setPins(new Map());
    setTargetOverride(null);
    setStrategy('equal');
    setAppliedFromChat(null);
  }

  if (error || solveError) {
    return (
      <PageShell title="Reduction planner">
        <ErrorState message={error ?? solveError ?? ''} onRetry={reload} />
      </PageShell>
    );
  }

  if (loading || !data || !result || !goal) {
    return (
      <PageShell kicker="Future · Scenario planning" title="What would it actually take?">
        <LoadingBlock height={420} label="Solving the baseline scenario…" />
      </PageShell>
    );
  }

  const feasible = result.feasible;
  const targetPct = result.targetPct;
  const ceilingPct = result.portfolioCeilingPct;
  const maxPctOfBaseline =
    result.baselineTonnes > 0 ? result.maxAchievableTonnes / result.baselineTonnes : 0;

  /*
   * Binding constraints, abbreviated. Pinning one big category forces the solver
   * to push almost everything else to its ceiling, so this list legitimately runs
   * to eleven names — which in a one-paragraph verdict is a wall of text that
   * stops being read. Three and a count; the sliders themselves mark every one.
   */
  const binding = result.bindingCategories;
  const bindingLabel =
    binding.length === 0
      ? 'none yet'
      : binding.length <= 3
        ? binding.join(', ')
        : `${binding.slice(0, 3).join(', ')} and ${binding.length - 3} more`;

  return (
    <PageShell
      kicker="Future · Scenario planning, not prediction"
      title="What would it actually take?"
      standfirst={
        <>
          Not a forecast — a conditional. If these levers were pulled this hard, where would the
          footprint land, what would it cost, and is the published target even{' '}
          <Term id="feasibility">reachable</Term>? Every figure is{' '}
          <Term id="grounding">solved on the server</Term>, including the ones Bucky narrates.
        </>
      }
      actions={
        <Button variant="outline" appearance="secondary" size="sm" onClick={reset}>
          <RotateCcw className="size-3.5" aria-hidden />
          Reset scenario
        </Button>
      }
    >
      {/* ---------------------------- feasibility ---------------------------- */}
      <div
        className="mb-6 flex flex-wrap items-start gap-3 rounded-[var(--c3-style-border-radius-6)] border p-4"
        style={{
          borderColor: feasible ? STATUS.good : STATUS.critical,
          backgroundColor: feasible ? 'rgba(63,185,80,0.07)' : 'rgba(248,81,73,0.07)',
        }}
        role="status"
      >
        {feasible ? (
          <CheckCircle2 className="mt-[2px] size-5 shrink-0" style={{ color: STATUS.good }} aria-hidden />
        ) : (
          <AlertTriangle className="mt-[2px] size-5 shrink-0" style={{ color: STATUS.critical }} aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
            {feasible
              ? `A ${pct(targetPct)} cut by ${goal.targetYear} is reachable with the levers on the table`
              : `A ${pct(targetPct)} cut by ${goal.targetYear} is not reachable with the levers on the table`}
          </h2>
          <p className="mt-1 max-w-4xl text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
            {feasible ? (
              <>
                The scenario delivers {tonnes(result.achievedTonnes)} of the{' '}
                {tonnes(result.targetTonnes)} required, at a blended{' '}
                {costPerTonne(result.blendedCostPerTonne)}. Headroom left over:{' '}
                {tonnes(result.maxAchievableTonnes - result.achievedTonnes)}. Binding constraints:{' '}
                {bindingLabel}.
              </>
            ) : (
              <>
                Every unpinned category is already pushed to its ceiling and the plan is still{' '}
                <strong className="text-[var(--c3-style-basic-fg-primary)]">
                  {tonnes(result.gapTonnes)} short
                </strong>
                . The maximum this portfolio of levers can deliver is{' '}
                {tonnes(result.maxAchievableTonnes)} — {pct(maxPctOfBaseline)} of the{' '}
                {tonnes(result.baselineTonnes)} baseline. Closing the rest requires something not in
                this list: supplier engagement to lower the factors themselves, a different research
                procurement model, or an honest renegotiation of the target.
              </>
            )}
          </p>
          {!feasible ? (
            <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
              A planner that always finds a way to hit the number is lying to you. The ceiling is{' '}
              {pct(ceilingPct)} — <Term id="feasibility">which is a finding, not an error</Term>.
            </p>
          ) : null}

          {/*
            Every published milestone, re-solved under the *current* pins, as one
            line. This used to be a panel of its own with a paragraph per goal.
            The content that mattered was never the paragraphs — it was that a
            comfortable 2030 and an impossible 2048 can coexist under identical
            assumptions, which is exactly the thing a single near-term verdict
            hides. One strip says it and keeps saying it as the pins change.
          */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-2.5 text-[11px]"
            style={{ borderColor: 'rgba(255,255,255,0.09)' }}
          >
            <span className="font-medium uppercase tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)]">
              Same pins, every milestone
            </span>
            {goalComparison.map(({ goal: g, result: r }) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1.5 tabular-nums"
                style={{ color: r.feasible ? STATUS.good : STATUS.critical }}
                title={`${g.description ?? g.name} — needs ${tonnes(r.targetTonnes)}; these levers can deliver ${tonnes(r.maxAchievableTonnes)}`}
              >
                {r.feasible ? (
                  <CheckCircle2 className="size-3" aria-hidden />
                ) : (
                  <AlertTriangle className="size-3" aria-hidden />
                )}
                <strong className="font-semibold">
                  {pct(r.targetPct)} by {g.targetYear}
                </strong>
                <span className="font-normal">
                  {r.feasible ? `feasible at ${costPerTonne(r.blendedCostPerTonne)}` : `short by ${tonnes(r.gapTonnes)}`}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* -------------------------------- copilot ---------------------------- */}
      {/*
        The one page that deliberately keeps an inline panel after Bucky moved into a
        floating dock. It is placed immediately above the controls it drives, because the
        demonstration *is* the causality: you state a constraint in a sentence and the
        sliders below physically move to match it. In a dock that happens behind a popup
        the audience has to be told about rather than shown. Both surfaces share one
        transcript, so asking here and asking in the dock are the same conversation.
      */}
      <Section
        title="Describe the constraint instead of dialling it"
        description="Say it in English; the sliders below move to match. Bucky picks the methods, runs them, and lists what it ran."
      >
        <CopilotPanel
          page="planner"
          scenario={copilotScenario}
          onUiAction={applyCopilotAction}
          suggestions={[
            'We can only cut IT hardware by 4% — can we still hit 2030?',
            'Lab instruments are fixed at 5% and plastics at 10%. What does 2040 need from everything else?',
            'Which single category gives the cheapest tonne, and what happens if I lean on it hardest?',
          ]}
        />
      </Section>

      {/* ------------------------------- controls ---------------------------- */}
      <Section
        title="Set the scenario"
        description="Pick a published target or dial your own, choose how the burden is shared, then pin anything that is not negotiable."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Target" note="Published UW milestones; the slider overrides them for a what-if.">
            <div className="flex flex-wrap gap-1.5">
              {goals.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setGoalId(g.id);
                    setTargetOverride(null);
                  }}
                  className={cn(
                    'rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]',
                    g.id === goal.id
                      ? 'border-[var(--c3-style-basic-fg-accent)] bg-white/[0.06] text-[var(--c3-style-basic-fg-primary)]'
                      : 'border-[var(--c3-style-basic-border-border)] text-[var(--c3-style-basic-fg-secondary)] hover:text-[var(--c3-style-basic-fg-primary)]',
                  )}
                >
                  {pct(g.reductionPct)} by {g.targetYear}
                </button>
              ))}
            </div>

            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor="target-slider"
                  className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--c3-style-basic-fg-secondary)]"
                >
                  Reduction target
                </label>
                <span className="text-[20px] font-semibold tabular-nums leading-none text-[var(--c3-style-basic-fg-primary)]">
                  {pct(sliderPct)}
                </span>
              </div>
              <input
                id="target-slider"
                type="range"
                min={0}
                max={TARGET_MAX_PCT}
                step={1}
                value={Math.round(sliderPct * 100)}
                onChange={(e) => setTargetOverride(Number(e.target.value) / 100)}
                aria-valuetext={`${Math.round(sliderPct * 100)} percent reduction`}
                className={cn(
                  'mt-2 h-[18px] w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none',
                  '[&::-webkit-slider-runnable-track]:h-[6px] [&::-webkit-slider-runnable-track]:rounded-full',
                  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-[14px]',
                  '[&::-webkit-slider-thumb]:-mt-[4px] [&::-webkit-slider-thumb]:rounded-full',
                  '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--c3-style-basic-bg-primary)]',
                  '[&::-moz-range-thumb]:size-[14px] [&::-moz-range-thumb]:rounded-full',
                )}
                style={{
                  accentColor: feasible ? STATUS.good : STATUS.critical,
                  background: `linear-gradient(to right, ${
                    feasible ? STATUS.good : STATUS.critical
                  } 0%, ${feasible ? STATUS.good : STATUS.critical} ${
                    (sliderPct / (TARGET_MAX_PCT / 100)) * 100
                  }%, rgba(255,255,255,0.09) ${
                    (sliderPct / (TARGET_MAX_PCT / 100)) * 100
                  }%, rgba(255,255,255,0.09) 100%)`,
                  backgroundSize: '100% 6px',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                With nothing pinned, the levers that could be in place by {goal.targetYear} cap out
                at{' '}
                <strong className="text-[var(--c3-style-basic-fg-primary)]">{pct(ceilingPct)}</strong>
                . It moves with the target year — an earlier deadline genuinely has fewer actions
                available, not the same actions in less time.
              </p>
            </div>
          </Panel>

          <Panel
            title="How the burden is shared"
            note={
              <>
                <Term id="strategy">Allocation strategy</Term> — it changes who carries the cut,
                never whether the target is met.
              </>
            }
          >
            <div className="flex flex-col gap-1.5">
              {STRATEGIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStrategy(s)}
                  aria-pressed={strategy === s}
                  className={cn(
                    'rounded-[4px] border px-2.5 py-2 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]',
                    strategy === s
                      ? 'border-[var(--c3-style-basic-fg-accent)] bg-white/[0.05]'
                      : 'border-[var(--c3-style-basic-border-border)] hover:bg-white/[0.028]',
                  )}
                >
                  <span className="text-[12px] font-medium text-[var(--c3-style-basic-fg-primary)]">
                    {STRATEGY_LABELS[s]}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]">
                    {STRATEGY_DESCRIPTIONS[s]}
                  </span>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </Section>

      {/* -------------------------------- levers ----------------------------- */}
      <Section
        title="Pull the levers"
        description={
          <>
            Each slider stops at its own ceiling — the sum of what that category&apos;s named
            actions can deliver. Dragging one <Term id="pin">pins</Term> it; everything else
            absorbs the difference.
          </>
        }
        actions={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium">
            {solving ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--c3-style-basic-fg-secondary)]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                re-solving on the server
              </span>
            ) : null}
            {pins.size > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--c3-style-basic-fg-accent)]">
                <Pin className="size-3.5" aria-hidden />
                {pins.size} pinned
              </span>
            ) : null}
            {appliedFromChat ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--c3-style-basic-fg-accent)]">
                <Sparkles className="size-3.5" aria-hidden />
                set from chat
              </span>
            ) : null}
          </span>
        }
      >
        {/*
          Pins the agent had to clamp, in its own words. A request to cut a
          category by 40% when its levers top out at 18% is not silently honoured
          and not silently dropped — the slider lands at 18% and this says why.
          The client solver clamped identically but had no way to tell anyone.
        */}
        {result.notes.length > 0 ? (
          <ul
            className="mb-3 rounded-[var(--c3-style-border-radius-6)] border p-2.5 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]"
            style={{ borderColor: STATUS.warning }}
          >
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        {/*
          The copilot's two honest failure modes, surfaced rather than swallowed.
          `suspectFractions` is the model emitting 0.04 where the contract is 4 —
          the pins are applied exactly as sent and flagged, never silently
          "corrected", because guessing which one it meant is how a demo quietly
          plans against the wrong number.
        */}
        {appliedFromChat && (appliedFromChat.suspect.length > 0 || appliedFromChat.yearUnmatched) ? (
          <div
            className="mb-3 rounded-[var(--c3-style-border-radius-6)] border p-2.5 text-[11px] leading-relaxed text-[var(--c3-style-basic-fg-secondary)]"
            style={{ borderColor: STATUS.warning }}
            role="status"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--c3-style-basic-fg-primary)]">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              Check what the copilot set
            </span>
            {appliedFromChat.suspect.length > 0 ? (
              <p className="mt-1">
                {appliedFromChat.suspect.join(', ')} came back as a value between 0 and 1, which may
                mean a fraction was sent where a percentage was expected. The slider shows exactly
                what was requested — if it reads under 1%, drag it to the figure you meant.
              </p>
            ) : null}
            {appliedFromChat.yearUnmatched ? (
              <p className="mt-1">
                No published milestone targets {appliedFromChat.targetYear}, so the reduction target
                above was left as it was. Pick a target explicitly to plan against that year.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {result.allocations
            .filter((a) => a.baselineTonnes > 0)
            .map((a) => (
              <LeverSlider
                key={a.categoryId}
                categoryId={a.categoryId}
                label={a.name}
                valuePct={a.reductionPct}
                ceilingPct={a.ceiling}
                baselineTonnes={a.baselineTonnes}
                tonnesCut={a.tonnesCut}
                cost={a.cost}
                costPerTonne={a.costPerTonne}
                effortLevel={a.effortLevel}
                pinned={a.pinned}
                atCeiling={a.atCeiling}
                levers={a.levers}
                actions={a.actions}
                onChange={(f) => handleSliderChange(a.categoryId, f)}
                onTogglePin={() => togglePin(a.categoryId, a.reductionPct)}
              />
            ))}
        </div>
      </Section>

      {/* ------------------------------- outcome ----------------------------- */}
      <Section
        title="Where this scenario lands"
        description="The gap meter is the verdict on one axis; the glide path is the same verdict over time. Both move the instant a slider does."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel
            title="Gap meter"
            subtitle="Delivered, required, and the hard ceiling — on one axis"
            note={
              <>
                Against an <Term id="baseline">FY{data.baselineFy} baseline</Term> of{' '}
                {tonnes(result.baselineTonnes)}, this scenario nets{' '}
                {result.netCost < 0
                  ? `a saving of ${usd(Math.abs(result.netCost))}`
                  : `${usdCompact(result.netCost)} of cost at ${costPerTonne(
                      result.blendedCostPerTonne,
                    )} blended`}
                . Required marker right of the ceiling means no arrangement of these sliders closes
                the gap.
              </>
            }
          >
            <div className="relative h-[42px] w-full overflow-hidden rounded-[4px] bg-white/[0.045]">
              {/* ceiling */}
              <div
                className="absolute inset-y-0 left-0 bg-white/[0.07]"
                style={{ width: `${Math.min(100, maxPctOfBaseline * 160)}%` }}
                aria-hidden
              />
              {/* delivered */}
              <div
                className="absolute inset-y-0 left-0 transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, result.achievedPct * 160)}%`,
                  backgroundColor: feasible ? STATUS.good : STATUS.warning,
                  opacity: 0.85,
                }}
                aria-hidden
              />
              {/* required */}
              <div
                className="absolute inset-y-0 w-[2px]"
                style={{
                  left: `${Math.min(99.5, targetPct * 160)}%`,
                  backgroundColor: feasible ? 'rgba(255,255,255,0.8)' : STATUS.critical,
                }}
                aria-hidden
              />
              <span
                className="absolute top-[3px] text-[10px] font-semibold"
                style={{
                  left: `calc(${Math.min(88, targetPct * 160)}% + 6px)`,
                  color: feasible ? 'rgba(255,255,255,0.8)' : STATUS.critical,
                }}
              >
                target {pct(targetPct)}
              </span>
              <span className="absolute bottom-[3px] left-2 text-[10px] font-semibold text-black/70">
                delivered {pct(result.achievedPct)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-[2px]"
                  style={{ backgroundColor: feasible ? STATUS.good : STATUS.warning }}
                />
                Delivered by this scenario
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2.5 rounded-[2px] bg-white/[0.12]" />
                Reachable ceiling ({pct(maxPctOfBaseline)})
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-3 w-[2px]"
                  style={{ backgroundColor: feasible ? 'rgba(255,255,255,0.8)' : STATUS.critical }}
                />
                Required by the target
              </span>
            </div>
          </Panel>

          <Panel
            title={`Glide path to ${goal.targetYear}`}
            subtitle={`${pct(targetPct)} below the FY${data.baselineFy} baseline`}
            note={
              <div className="flex flex-col gap-1.5">
                <GlidePathLegend />
                <span>
                  Business-as-usual grows at the measured historical {pct(data.cagr, 1)} a year —{' '}
                  <Term id="measured-vs-projected">extrapolation, not a forecast</Term>. The gap
                  between the two lines is the job.
                </span>
              </div>
            }
          >
            <GlidePathChart data={glide} targetYear={goal.targetYear} />
          </Panel>
        </div>
      </Section>
    </PageShell>
  );
}
