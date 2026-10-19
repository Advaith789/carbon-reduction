/*
 * The planner's per-category control. Built from a native <input type="range">
 * because this template ships no slider primitive — and a native range input is
 * keyboard-accessible for free, which a div-based one is not.
 */

import React, { useId, useState } from 'react';
import { ChevronDown, Lock, Unlock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PRIMARY, STATUS } from '@/lib/badger/palette';
import { costPerTonne as fmtCostPerTonne, pct, tonnes, usd } from '@/lib/badger/format';
import type { AgentSolveAction, ReductionLever } from '@/types/badger';

interface LeverSliderProps {
  categoryId: string;
  label: string;
  /** Current reduction, as a fraction in `[0,1]`. */
  valuePct: number;
  /** Feasibility ceiling, as a fraction in `[0,1]`. */
  ceilingPct: number;
  baselineTonnes: number;
  tonnesCut: number;
  cost: number;
  costPerTonne: number;
  effortLevel: string;
  pinned: boolean;
  atCeiling: boolean;
  /** The individual actions that add up to the ceiling. */
  levers: ReductionLever[];
  /**
   * What the solver actually spent, from `PlannerAgent.solve` — a subset of
   * `levers`, cheapest first, each with the share of its own ceiling consumed.
   * Keyed by `leverId` so it can be joined back onto the lever list.
   */
  actions?: AgentSolveAction[];
  onChange: (fraction: number) => void;
  onTogglePin: () => void;
}

/**
 * One category's reduction control.
 *
 * The slider's **maximum is the feasibility ceiling**, not 100%. You cannot drag
 * a category past what the people who would do the work say is achievable — the
 * constraint is in the control itself rather than in a warning after the fact,
 * which is what stops the whole exercise from producing a plan nobody can deliver.
 *
 * Pinning takes the category out of redistribution entirely: pin reagents at 0%
 * for research continuity and every other category has to absorb the difference,
 * which is usually the moment a target stops being feasible.
 */
export default function LeverSlider({
  categoryId,
  label,
  valuePct,
  ceilingPct,
  baselineTonnes,
  tonnesCut,
  cost,
  costPerTonne,
  effortLevel,
  pinned,
  atCeiling,
  levers,
  actions,
  onChange,
  onTogglePin,
}: LeverSliderProps) {
  const [expanded, setExpanded] = useState(false);
  const sliderId = useId();
  const maxPct = Math.round(ceilingPct * 100);
  const curPct = Math.round(valuePct * 1000) / 10;
  const savesMoney = cost < 0;
  /** leverId → what the solver spent on it, for the expanded detail. */
  const spent = new Map((actions ?? []).map((a) => [a.leverId, a]));

  return (
    <div
      className={cn(
        'rounded-[var(--c3-style-border-radius-6)] border px-3.5 py-3 transition-colors',
        pinned
          ? 'border-[var(--c3-style-basic-fg-accent)]/50 bg-white/[0.035]'
          : 'border-[var(--c3-style-basic-border-border)] bg-white/[0.012] hover:bg-white/[0.03]',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            title={
              pinned
                ? `Unpin ${label} — let the solver redistribute it`
                : `Pin ${label} at ${curPct}% and make every other category absorb the rest`
            }
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
              'focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]',
              pinned
                ? 'border-[var(--c3-style-basic-fg-accent)] text-[var(--c3-style-basic-fg-accent)]'
                : 'border-[var(--c3-style-basic-border-border)] text-[var(--c3-style-basic-fg-secondary)] hover:text-[var(--c3-style-basic-fg-primary)]',
            )}
          >
            {pinned ? <Lock className="size-3" aria-hidden /> : <Unlock className="size-3" aria-hidden />}
            <span className="sr-only">{pinned ? 'Unpin' : 'Pin'} {label}</span>
          </button>
          <label
            htmlFor={sliderId}
            className="truncate text-[13px] font-medium text-[var(--c3-style-basic-fg-primary)]"
          >
            {label}
          </label>
          <span className="shrink-0 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
            {tonnes(baselineTonnes)} baseline
          </span>
        </div>

        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-[15px] font-semibold tabular-nums text-[var(--c3-style-basic-fg-primary)]">
            {curPct.toFixed(1)}%
          </span>
          <span className="text-[11px] tabular-nums text-[var(--c3-style-basic-fg-secondary)]">
            of {maxPct}% possible
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <input
          id={sliderId}
          type="range"
          min={0}
          max={maxPct * 10}
          step={1}
          value={Math.round(valuePct * 1000)}
          onChange={(e) => onChange(Number(e.target.value) / 1000)}
          aria-label={`${label} reduction percentage, maximum ${maxPct}%`}
          aria-valuetext={`${curPct.toFixed(1)} percent, ${tonnes(tonnesCut)} avoided`}
          className={cn(
            'h-[18px] min-w-0 flex-1 cursor-pointer appearance-none bg-transparent',
            'focus-visible:outline-none',
            // track
            '[&::-webkit-slider-runnable-track]:h-[6px] [&::-webkit-slider-runnable-track]:rounded-full',
            '[&::-webkit-slider-runnable-track]:bg-white/[0.09]',
            '[&::-moz-range-track]:h-[6px] [&::-moz-range-track]:rounded-full',
            '[&::-moz-range-track]:bg-white/[0.09]',
            // thumb
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-[14px]',
            '[&::-webkit-slider-thumb]:-mt-[4px] [&::-webkit-slider-thumb]:rounded-full',
            '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--c3-style-basic-bg-primary)]',
            '[&::-moz-range-thumb]:size-[14px] [&::-moz-range-thumb]:rounded-full',
            '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--c3-style-basic-bg-primary)]',
            'focus-visible:[&::-webkit-slider-thumb]:ring-[2px] focus-visible:[&::-webkit-slider-thumb]:ring-[var(--c3-style-basic-fg-accent)]',
          )}
          style={
            {
              // Filled portion drawn through the thumb colour + a linear-gradient
              // on the track, so one element carries value and remainder.
              ['--thumb' as string]: atCeiling ? STATUS.warning : PRIMARY,
              background: `linear-gradient(to right, ${
                atCeiling ? STATUS.warning : PRIMARY
              } 0%, ${atCeiling ? STATUS.warning : PRIMARY} ${
                maxPct > 0 ? (curPct / maxPct) * 100 : 0
              }%, rgba(255,255,255,0.09) ${
                maxPct > 0 ? (curPct / maxPct) * 100 : 0
              }%, rgba(255,255,255,0.09) 100%)`,
              backgroundSize: '100% 6px',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              accentColor: atCeiling ? STATUS.warning : PRIMARY,
            } as React.CSSProperties
          }
        />

        <div className="w-[88px] shrink-0 text-right">
          <p className="text-[12px] font-medium tabular-nums text-[var(--c3-style-basic-fg-primary)]">
            −{tonnes(tonnesCut)}
          </p>
          <p
            className="text-[11px] tabular-nums"
            style={{ color: savesMoney ? STATUS.good : 'var(--c3-style-basic-fg-secondary)' }}
          >
            {savesMoney ? `saves ${usd(Math.abs(cost))}` : usd(cost)}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
        {atCeiling && !pinned ? (
          <span className="font-medium" style={{ color: STATUS.warning }}>
            At ceiling — this category is a binding constraint
          </span>
        ) : null}
        {pinned ? (
          <span className="font-medium text-[var(--c3-style-basic-fg-accent)]">
            Pinned — held fixed, other categories absorb the difference
          </span>
        ) : null}
        <span>{fmtCostPerTonne(costPerTonne)}</span>
        <span>·</span>
        <span>{effortLevel} effort</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`${sliderId}-levers`}
          className="ml-auto flex items-center gap-1 rounded-[3px] hover:text-[var(--c3-style-basic-fg-primary)] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]"
        >
          {levers.length} lever{levers.length === 1 ? '' : 's'}
          <ChevronDown
            className={cn('size-3 transition-transform', expanded && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>

      {expanded ? (
        <ul
          id={`${sliderId}-levers`}
          className="mt-2.5 flex flex-col gap-2 border-t border-[var(--c3-style-basic-border-border)] pt-2.5"
        >
          {levers.map((l) => {
            const use = spent.get(l.id);
            return (
              <li key={l.id} className="text-[11px] leading-relaxed">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-[var(--c3-style-basic-fg-primary)]">
                    {l.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--c3-style-basic-fg-secondary)]">
                    {/*
                      Two different numbers, and the distinction is the point: what
                      this action *could* deliver, and how much of that the current
                      scenario is actually spending. An unspent lever is headroom
                      the plan has not touched yet — which is what a chair wants to
                      know before agreeing to a deeper cut.
                    */}
                    {use ? (
                      <span style={{ color: use.fullyUsed ? STATUS.warning : PRIMARY }}>
                        using {use.cutPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span>unused</span>
                    )}{' '}
                    of {pct(l.maxReductionPct)} · {fmtCostPerTonne(l.costPerTonne ?? 0)} ·{' '}
                    {l.effortLevel ?? 'Medium'} effort
                  </span>
                </div>
                {l.description ? (
                  <p className="text-[var(--c3-style-basic-fg-secondary)]">{l.description}</p>
                ) : null}
                {l.owner ? (
                  <p className="text-[var(--c3-style-basic-fg-secondary)]">
                    Owner: {l.owner}
                    {use ? ` · would deliver ${tonnes(use.cutTonnes)}` : ''}
                  </p>
                ) : null}
              </li>
            );
          })}
          <li className="text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
            Ceiling for <span className="font-mono">{categoryId}</span> is the sum of these levers:{' '}
            {maxPct}%. The split across them is the agent&apos;s, taken cheapest first.
          </li>
        </ul>
      ) : null}
    </div>
  );
}
