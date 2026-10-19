/*
 * The planner page's connection to the server-side solver.
 *
 * The page used to compute its own answers in the browser. It no longer does:
 * every figure comes from `PlannerAgent.solve`. That turns a synchronous `useMemo`
 * into a network round trip on every slider movement, and a slider dragged across
 * its range fires change events at roughly the frame rate. Three problems follow,
 * and this hook exists to solve all three in one place rather than scattering
 * their fixes through the page.
 *
 *   1. **Volume.** A drag from 0% to 40% would issue ~60 requests, of which only
 *      the last matters. A 200 ms trailing debounce collapses the drag into one
 *      solve on release (and, for a slow drag, one every 200 ms — which keeps the
 *      page feeling live).
 *
 *   2. **Ordering.** Debouncing reduces the count but does not guarantee the
 *      replies arrive in the order the requests left. A slower earlier solve
 *      landing after a faster later one would paint a stale allocation and leave
 *      it there. Every batch carries a sequence number and anything that is not
 *      the newest is dropped on arrival.
 *
 *   3. **Flicker.** Clearing the result while a new one is in flight would blank
 *      the sliders mid-drag. The previous answer stays on screen and `solving`
 *      goes true, so the page can mark itself as one step behind instead of
 *      emptying out.
 *
 * One batch is 1 + N requests: the live scenario, plus every published milestone
 * re-solved under the same pins. They go out together in a single `Promise.all`
 * so the whole page updates in one render rather than tearing across four.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { solveScenario, type AgentStrategy } from '@/api/badger';
import {
  adaptSolve,
  type CategoryPlanInput,
  type PlanResult,
  type Strategy,
} from '@/lib/badger/planner';
import type { SustainabilityGoal } from '@/types/badger';

/** Trailing debounce on slider and pin changes, in milliseconds. */
const DEBOUNCE_MS = 200;

/** This page's strategy names, in the vocabulary the agent speaks. */
const AGENT_STRATEGY: Record<Strategy, AgentStrategy> = {
  equal: 'equal_pct',
  cheapest: 'cheapest_first',
  effort: 'effort_balanced',
};

/** What the page controls, in the page's own units. */
export interface PlannerScenario {
  targetYear: number;
  /**
   * Depth of cut as a fraction in `[0,1]`, or `null` to solve against whatever
   * the published goal for `targetYear` says. Null is not the same as sending
   * the goal's own figure back: it keeps `targetOverridden` false, so the verdict
   * can distinguish "the university's commitment" from "a number I dragged to".
   */
  targetPct: number | null;
  strategy: Strategy;
  /** Category ids held fixed, with their reduction as a fraction in `[0,1]`. */
  pins: Map<string, number>;
}

/** One published milestone re-solved under the current pins. */
export interface GoalVerdict {
  goal: SustainabilityGoal;
  result: PlanResult;
}

export interface PlannerSolveState {
  /** The live scenario's answer. Null only before the first solve returns. */
  result: PlanResult | null;
  /** Every published milestone under the same pins; empty until the first solve. */
  goalComparison: GoalVerdict[];
  /** True while a newer answer is in flight and the displayed one is stale. */
  solving: boolean;
  /** Set when the solve failed. The page shows this instead of inventing numbers. */
  solveError: string | null;
}

/**
 * Solves `scenario` on the server, plus one solve per published goal, debounced
 * and ordered.
 *
 * @param inputs  per-category lever rows, for the lever lists the response omits.
 *                Pass `null` until the page's data has loaded.
 * @param goals   published milestones to re-solve under the same pins.
 * @param scenario the live control state.
 */
export function usePlannerSolve(
  inputs: CategoryPlanInput[] | null,
  goals: SustainabilityGoal[],
  scenario: PlannerScenario,
): PlannerSolveState {
  const [result, setResult] = useState<PlanResult | null>(null);
  const [goalComparison, setGoalComparison] = useState<GoalVerdict[]>([]);
  const [solving, setSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);

  /** Newest batch issued. A reply with a lower number is stale and discarded. */
  const seq = useRef(0);

  /*
   * The effect's dependency list has to be made of primitives. `scenario` holds a
   * Map and is rebuilt on every render, and `goals` is an array — depending on
   * either by identity would re-solve on every keystroke anywhere on the page.
   * Serialising the request is both the dependency key and the thing sent, so
   * they cannot drift apart: if the key is unchanged, the request is byte-identical
   * and re-running would return exactly what is already on screen.
   */
  const requestKey = useMemo(() => {
    const pins: Record<string, number> = {};
    // Sorted, so two identical pin sets built in different orders produce the
    // same key and do not trigger a redundant solve.
    for (const id of [...scenario.pins.keys()].sort()) {
      pins[id] = Math.round((scenario.pins.get(id) ?? 0) * 1000) / 10;
    }
    return JSON.stringify({
      targetYear: scenario.targetYear,
      strategy: AGENT_STRATEGY[scenario.strategy],
      pins,
      // The agent clamps and rounds to 1 dp; rounding here too means dragging
      // within a tenth of a percent does not issue a request that changes nothing.
      targetPct:
        scenario.targetPct === null ? null : Math.round(scenario.targetPct * 1000) / 10,
      goalYears: goals.map((g) => g.targetYear),
    });
  }, [scenario, goals]);

  useEffect(() => {
    if (!inputs) return;

    const req = JSON.parse(requestKey) as {
      targetYear: number;
      strategy: AgentStrategy;
      pins: Record<string, number>;
      targetPct: number | null;
      goalYears: number[];
    };

    const mine = ++seq.current;
    setSolving(true);

    const timer = window.setTimeout(() => {
      const base = { strategy: req.strategy, pins: req.pins };

      Promise.all([
        solveScenario({
          ...base,
          targetYear: req.targetYear,
          // Omitted rather than sent as null: the agent treats absent as "use the
          // published goal", and an explicit null would be a 0% target.
          ...(req.targetPct === null ? {} : { targetPct: req.targetPct }),
        }),
        // Each milestone is solved at *its own* published depth, by asking for its
        // year and sending no override. The page's target slider does not leak
        // into this row — the comparison is "same pins, every real commitment".
        ...goals.map((g) => solveScenario({ ...base, targetYear: g.targetYear })),
      ])
        .then(([live, ...perGoal]) => {
          if (seq.current !== mine) return;
          setResult(adaptSolve(live, inputs));
          setGoalComparison(
            goals.map((g, i) => ({ goal: g, result: adaptSolve(perGoal[i], inputs) })),
          );
          setSolveError(null);
          setSolving(false);
        })
        .catch((e: unknown) => {
          if (seq.current !== mine) return;
          setSolveError(e instanceof Error ? e.message : 'The planner agent did not respond.');
          setSolving(false);
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // `goals` and `inputs` are stable for the life of the page (both come from the
    // one data load); `requestKey` is the real trigger and already encodes every
    // part of the request that can change.
  }, [requestKey, inputs, goals]);

  return { result, goalComparison, solving, solveError };
}
