/*
 * What each building buys — two views of the building × category matrix.
 *
 * The matrix from `BadgerAnalytics.buildingMap` is 10 buildings × 13 categories
 * with more than half its cells empty, which is the worst possible input for a
 * heatmap: the eye reads the gaps, not the values, and thirteen rotated column
 * labels say nothing until hovered. Two forms do the job properly:
 *
 * 1. **Stacked bars, one per building** ({@link BuildingStackedBars}). The job is
 *    part-to-whole, so the 13 categories fold into the three validated categorical
 *    slots — lab consumables & gases, equipment & furnishings, operations & admin —
 *    and every bar answers "how much, and what kind" at a glance. Three slots is
 *    both what the palette proves and what the argument needs: a lab-heavy
 *    building and an office building are different problems with different levers.
 *
 * 2. **Small multiples, one ranked list per building** ({@link BuildingBreakdowns}).
 *    Each building shows only the categories it actually buys, in one hue, ranked —
 *    so the sparsity that crippled the matrix never appears. This is the detail
 *    view; the stacked bars are the overview.
 *
 * Nothing is computed here beyond grouping and sorting: every tonnage is a cell
 * the agent returned, and both shares on hover are the agent's own figures.
 */

import React, { useMemo, useState } from 'react';

import RankedBars, { type RankedBarDatum } from '@/components/badger/RankedBars';
import { CATEGORICAL } from '@/lib/badger/palette';
import { pct, tonnes } from '@/lib/badger/format';
import type { BuildingMapCategory, BuildingMapCell, BuildingMapRow } from '@/types/badger';
import { cn } from '@/lib/utils';

/* ------------------------------- the grouping ------------------------------ */

type GroupId = 'lab' | 'equipment' | 'operations';

interface Group {
  id: GroupId;
  label: string;
  /** Fixed slot in the validated categorical order — never reassigned by rank. */
  color: string;
  categoryIds: readonly string[];
}

/**
 * Thirteen categories → three groups, by what kind of lever reduces them.
 *
 * Lab consumables and gases are cut by sharing stock, consolidating orders and
 * recapturing helium; equipment is cut by refurbishment and longer refresh cycles;
 * operations are cut by travel and licensing policy. Grouping by lever type means
 * the colour on a bar already hints at the remedy.
 */
export const GROUPS: readonly Group[] = [
  {
    id: 'lab',
    label: 'Lab consumables & gases',
    color: CATEGORICAL[0],
    categoryIds: ['industrial_gas', 'lab_supplies', 'plastics', 'pharma'],
  },
  {
    id: 'equipment',
    label: 'Equipment & furnishings',
    color: CATEGORICAL[1],
    categoryIds: ['lab_instruments', 'furniture', 'it_hardware', 'industrial_mro'],
  },
  {
    id: 'operations',
    label: 'Operations & admin',
    color: CATEGORICAL[2],
    categoryIds: ['air_travel', 'software', 'paper', 'office_supplies', 'shipping'],
  },
] as const;

const GROUP_OF: ReadonlyMap<string, Group> = new Map(
  GROUPS.flatMap((g) => g.categoryIds.map((c) => [c, g] as const)),
);

/** A category the agent returns that the grouping does not know lands here, visibly. */
const UNGROUPED: Group = {
  id: 'operations',
  label: 'Other',
  color: CATEGORICAL[2],
  categoryIds: [],
};

/* ------------------------------ shared shaping ----------------------------- */

interface Props {
  buildings: BuildingMapRow[];
  categories: BuildingMapCategory[];
  matrix: BuildingMapCell[];
  /** Campus total for the footer share figures. */
  totalTonnes: number;
}

interface BuildingRow {
  id: string;
  name: string;
  total: number;
  /** Tonnes per group, in {@link GROUPS} order. */
  byGroup: number[];
  cells: (BuildingMapCell & { categoryName: string })[];
}

function shape({ buildings, categories, matrix }: Props): BuildingRow[] {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const byBuilding = new Map<string, BuildingMapCell[]>();
  for (const cell of matrix) {
    if (cell.tonnes <= 0) continue;
    const list = byBuilding.get(cell.buildingId) ?? [];
    list.push(cell);
    byBuilding.set(cell.buildingId, list);
  }

  return buildings
    .filter((b) => b.tonnes > 0)
    .map((b) => {
      const cells = (byBuilding.get(b.id) ?? [])
        .map((c) => ({ ...c, categoryName: catName.get(c.categoryId) ?? c.categoryId }))
        .sort((x, y) => y.tonnes - x.tonnes);
      const byGroup = GROUPS.map(() => 0);
      for (const c of cells) {
        const g = GROUP_OF.get(c.categoryId) ?? UNGROUPED;
        byGroup[GROUPS.findIndex((x) => x.id === g.id)] += c.tonnes;
      }
      return { id: b.id, name: b.name, total: b.tonnes, byGroup, cells };
    })
    .sort((x, y) => y.total - x.total);
}

/* ------------------------------- stacked bars ------------------------------ */

/**
 * One horizontal stacked bar per building, longest first, three fixed-hue groups.
 *
 * Bars are 14px, anchored to a shared left baseline, rounded on the data end only,
 * with a 2px surface gap between segments and between rows. Every bar is directly
 * labelled with its total; segment values live in the hover card and the legend
 * is always present because there are three series.
 */
export function BuildingStackedBars(props: Props) {
  const rows = useMemo(() => shape(props), [props]);
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.total), 0) || 1;

  return (
    <div className="min-w-0">
      {/* legend — three series, so it is mandatory and sits above the plot */}
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Legend">
        {GROUPS.map((g) => (
          <li
            key={g.id}
            className="flex items-center gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]"
          >
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-[2px]"
              style={{ backgroundColor: g.color }}
            />
            {g.label}
          </li>
        ))}
      </ul>

      <div role="group" aria-label="Emissions by building, split by category group" className="flex flex-col gap-[6px]">
        {rows.map((r) => {
          const active = hover === r.id;
          return (
            <div key={r.id} className="relative">
              {/* A button rather than a focusable div: it is the keyboard route to
                  the hover card, and buttons are the interactive element a11y
                  tooling expects to carry focus. */}
              <button
                type="button"
                aria-label={`${r.name}: ${tonnes(r.total)}. ${GROUPS.map(
                  (g, i) => `${g.label} ${tonnes(r.byGroup[i])}`,
                ).join(', ')}`}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(r.id)}
                onBlur={() => setHover(null)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[4px] px-1.5 py-[4px] text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--c3-style-basic-fg-accent)]',
                  active && 'bg-white/[0.045]',
                )}
              >
                <span
                  className="w-[190px] shrink-0 truncate text-[12px] leading-tight text-[var(--c3-style-basic-fg-secondary)]"
                  title={r.name}
                >
                  {r.name}
                </span>

                {/* the bar: flex track scaled to the campus max, 2px gaps */}
                <span className="relative h-[14px] min-w-0 flex-1">
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 flex gap-[2px] overflow-hidden rounded-r-[4px]"
                    style={{ width: `${Math.max(0.8, (r.total / max) * 100)}%` }}
                  >
                    {GROUPS.map((g, i) =>
                      r.byGroup[i] > 0 ? (
                        <span
                          key={g.id}
                          className="h-full"
                          style={{
                            width: `${(r.byGroup[i] / r.total) * 100}%`,
                            backgroundColor: g.color,
                            opacity: active ? 1 : 0.82,
                          }}
                        />
                      ) : null,
                    )}
                  </span>
                </span>

                <span className="w-[56px] shrink-0 text-right text-[12px] font-medium tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                  {tonnes(r.total)}
                </span>
              </button>

              {active ? (
                <div
                  role="tooltip"
                  className={cn(
                    'pointer-events-none absolute right-[64px] top-full z-20 mt-1 w-max max-w-[320px]',
                    'rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)]',
                    'bg-[var(--c3-style-basic-bg-secondary)] px-3 py-2 shadow-lg',
                  )}
                >
                  <p className="mb-1 text-[12px] font-semibold text-[var(--c3-style-basic-fg-primary)]">
                    {r.name} · {tonnes(r.total)}
                  </p>
                  <dl className="flex flex-col gap-0.5">
                    {GROUPS.map((g, i) =>
                      r.byGroup[i] > 0 ? (
                        <div key={g.id} className="flex items-baseline justify-between gap-4">
                          <dt className="flex items-center gap-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                            <span
                              aria-hidden
                              className="inline-block size-2 rounded-[2px]"
                              style={{ backgroundColor: g.color }}
                            />
                            {g.label}
                          </dt>
                          <dd className="text-[11px] font-medium tabular-nums text-[var(--c3-style-basic-fg-primary)]">
                            {tonnes(r.byGroup[i])}{' '}
                            <span className="font-normal text-[var(--c3-style-basic-fg-secondary)]">
                              ({pct(r.byGroup[i] / r.total, 0)})
                            </span>
                          </dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                  <p className="mt-1.5 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">
                    Top line: {r.cells[0]?.categoryName ?? '—'}
                    {r.cells[0] ? ` · ${tonnes(r.cells[0].tonnes)}` : ''}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-2 px-1.5 text-[10px] text-[var(--c3-style-basic-fg-secondary)]">
        0 t ← bar length is tonnes CO₂e, to a common scale → {tonnes(max)}
      </p>
    </div>
  );
}

/* ------------------------------ small multiples ---------------------------- */

/**
 * One ranked, single-hue bar list per building — only the categories it buys.
 *
 * The hover card carries the two shares the agent computes for every cell: how much
 * of *this building's* carbon the category is (read across) and how much of *all
 * campus carbon in that category* sits at this one address (read down). The second
 * is the figure that decides whether a visit here moves a campus-wide lever.
 */
export function BuildingBreakdowns(props: Props & { maxRows?: number }) {
  const { maxRows = 5, totalTonnes } = props;
  const rows = useMemo(() => shape(props), [props]);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => {
        const data: RankedBarDatum[] = r.cells.map((c) => ({
          id: c.categoryId,
          label: c.categoryName,
          value: c.tonnes,
          display: tonnes(c.tonnes),
          emphasis: c === r.cells[0],
          tooltip: [
            { label: 'Share of this building', value: pct(c.buildingSharePct / 100, 0) },
            { label: 'Share of campus total in this category', value: pct(c.categorySharePct / 100, 0) },
            { label: 'Group', value: (GROUP_OF.get(c.categoryId) ?? UNGROUPED).label },
          ],
        }));
        return (
          <div
            key={r.id}
            className="min-w-0 rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)] bg-white/[0.015] px-3 pt-2.5 pb-3"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h4 className="min-w-0 truncate text-[12px] font-semibold text-[var(--c3-style-basic-fg-primary)]" title={r.name}>
                {r.name}
              </h4>
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--c3-style-basic-fg-secondary)]">
                {tonnes(r.total)} · {pct(totalTonnes > 0 ? r.total / totalTonnes : 0, 0)} of campus
              </span>
            </div>
            <RankedBars
              data={data}
              ariaLabel={`${r.name}: emissions by category`}
              labelWidth={128}
              maxRows={maxRows}
            />
          </div>
        );
      })}
    </div>
  );
}
