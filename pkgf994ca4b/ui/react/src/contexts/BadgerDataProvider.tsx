/*
 * Loads the Badger Footprint dataset once and shares it across every page.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  BASELINE_FY,
  fetchBuildingForecasts,
  fetchBuildingMap,
  fetchBuildings,
  fetchCampusSummary,
  fetchCategories,
  fetchContracts,
  fetchDepartments,
  fetchEmissionsBy,
  fetchFootprints,
  fetchGoals,
  fetchInventory,
  fetchLevers,
  fetchPendingRequests,
  spendByCategoryAndYear,
  spendByMonthAndCategory,
} from '@/api/badger';
import {
  emissionsCagr,
  factorMap,
  monthTotalsFiscalOrder,
  nameMap,
  yearTotals,
  type CategoryTotal,
  type MonthTotal,
  type YearTotal,
} from '@/lib/badger/carbon';
import { buildPlanInputs, type CategoryPlanInput } from '@/lib/badger/planner';
import type {
  Building,
  BuildingMap,
  CampusForecast,
  CampusSummary,
  CategoryYearSpend,
  Contract,
  Department,
  EmissionsBy,
  InventoryItem,
  MonthCategorySpend,
  ProductCategory,
  ProductFootprint,
  PurchaseRequest,
  ReductionLever,
  SustainabilityGoal,
} from '@/types/badger';

/** Everything the app needs, already fetched and already rolled up. */
export interface BadgerData {
  /* raw reference tables */
  categories: ProductCategory[];
  departments: Department[];
  buildings: Building[];
  levers: ReductionLever[];
  goals: SustainabilityGoal[];
  inventory: InventoryItem[];
  contracts: Contract[];
  footprints: ProductFootprint[];
  requests: PurchaseRequest[];

  /* lookups. The EPA factor map is deliberately **not** exposed: every carbon
     figure in the app now comes from an agent, so a page holding the factors
     could only use them to compute a second, disagreeing answer. It is still
     built here, privately, for the two time-axis rollups below. */
  categoryNames: Map<string, string>;

  /* raw server-side aggregates, kept so a page can take its own cut of the
     time axis without re-querying */
  categoryYearSpend: CategoryYearSpend[];
  monthCategorySpend: MonthCategorySpend[];

  /* rollups for the baseline fiscal year */
  baselineFy: number;
  categoryTotals: CategoryTotal[];
  monthTotals: MonthTotal[];
  yearTotals: YearTotal[];

  /* Geography, rolled up by BadgerAnalytics.buildingMap — per-building totals
     with coordinates plus the building × category matrix. The browser used to
     derive all of this from the department × category ledger; it no longer
     holds a second copy of the carbon math to do it with. */
  buildingMap: BuildingMap;

  /* Headline figures — all four sourced from BadgerAnalytics.campusSummary, not
     recomputed here. The agent is the single implementation of the carbon math. */
  baselineTonnes: number;
  baselineSpend: number;
  baselineIntensity: number;
  cagr: number;
  /** The raw agent envelope, for pages that want its prose (`concentration.note`). */
  summary: CampusSummary;

  /* planner inputs */
  planInputs: CategoryPlanInput[];

  /* The only projected figures in the app — fitted by ForecastAgent, never summed
     into a measured total. Null if the forecast call failed, so the map can drop
     the projection rows from its hover card and still render everything measured. */
  forecast: CampusForecast | null;
}

interface BadgerDataState {
  data: BadgerData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const BadgerDataContext = createContext<BadgerDataState | null>(null);

export function BadgerDataProvider({ children }: { children: React.ReactNode }) {
  const [raw, setRaw] = useState<Omit<
    BadgerData,
    | 'categoryNames'
    | 'categoryYearSpend'
    | 'monthCategorySpend'
    | 'categoryTotals'
    | 'monthTotals'
    | 'yearTotals'
    | 'buildingMap'
    | 'baselineTonnes'
    | 'baselineSpend'
    | 'baselineIntensity'
    | 'cagr'
    | 'planInputs'
    | 'forecast'
    | 'summary'
  > | null>(null);
  const [categoryYear, setCategoryYear] = useState<
    { categoryId: string; fiscalYear: number; amount: number }[]
  >([]);
  const [monthCategory, setMonthCategory] = useState<
    { month: number; categoryId: string; amount: number }[]
  >([]);
  const [buildingMap, setBuildingMap] = useState<BuildingMap | null>(null);
  const [forecast, setForecast] = useState<CampusForecast | null>(null);
  const [summary, setSummary] = useState<CampusSummary | null>(null);
  const [categoryRanking, setCategoryRanking] = useState<EmissionsBy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        categories,
        departments,
        buildings,
        levers,
        goals,
        inventory,
        contracts,
        footprints,
        requests,
        catYear,
        monthCat,
        forecastResult,
        summaryResult,
        categoryRankingResult,
        buildingMapResult,
      ] = await Promise.all([
        fetchCategories(),
        fetchDepartments(),
        fetchBuildings(),
        fetchLevers(),
        fetchGoals(),
        fetchInventory(),
        fetchContracts(),
        fetchFootprints(),
        fetchPendingRequests(),
        spendByCategoryAndYear(),
        spendByMonthAndCategory(BASELINE_FY),
        // A projection is a nice-to-have, not load-bearing: if the regression
        // fails the rest of the page is still entirely valid, so this one call
        // is allowed to resolve to null instead of failing the whole load.
        fetchBuildingForecasts(12).catch(() => null),
        // These three are load-bearing: every headline figure, the category
        // ranking and the whole campus map come from them, so a failure here
        // must surface as an error rather than silently fall back to a second
        // implementation of the same arithmetic.
        fetchCampusSummary(BASELINE_FY),
        fetchEmissionsBy('category', BASELINE_FY),
        fetchBuildingMap(BASELINE_FY),
      ]);

      if (!categories.length) {
        throw new Error(
          'No ProductCategory records returned. The backend is reachable but has no seeded data.',
        );
      }

      setRaw({
        categories,
        departments,
        buildings,
        levers,
        goals,
        inventory,
        contracts,
        footprints,
        requests,
        baselineFy: BASELINE_FY,
      });
      setForecast(forecastResult);
      setSummary(summaryResult);
      setCategoryRanking(categoryRankingResult);
      setBuildingMap(buildingMapResult);
      setCategoryYear(catYear);
      setMonthCategory(monthCat);
    } catch (e) {
      // No fallback data: a failed load must be visible, not papered over.
      setError(e instanceof Error ? e.message : String(e));
      setRaw(null);
      setForecast(null);
      setSummary(null);
      setCategoryRanking(null);
      setBuildingMap(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const data = useMemo<BadgerData | null>(() => {
    if (!raw || !summary || !categoryRanking || !buildingMap) return null;
    const factors = factorMap(raw.categories);
    const categoryNames = nameMap(raw.categories);
    const years = yearTotals(categoryYear, factors);

    // The agent's ranking, adapted to the shape the pages already render.
    //
    // Two deliberate conversions happen here and nowhere else. The agent states
    // shares as 0-100 doubles while the UI's `pct()` helper takes a 0-1 fraction,
    // so they are divided once, at this boundary, rather than at each call site
    // where a missed division would render 28.8% as "2880%". And `naicsTitle` is
    // joined from the already-fetched 13-row category table, because it is a label
    // the agent has no reason to carry — a lookup, not a recomputation.
    const naicsById = new Map(
      raw.categories.map((c) => [c.id, c.emissionFactor?.naicsTitle ?? '—']),
    );
    const catTotals: CategoryTotal[] = categoryRanking.rows.map((r) => ({
      categoryId: r.id,
      name: r.name,
      naicsTitle: naicsById.get(r.id) ?? '—',
      spend: r.spend,
      tonnes: r.tonnes,
      kgPerDollar: r.kgPerDollar,
      carbonShare: r.sharePct / 100,
      spendShare: r.spendSharePct / 100,
    }));

    const baselineByCategory = new Map(catTotals.map((c) => [c.categoryId, c.tonnes]));

    return {
      ...raw,
      categoryNames,
      categoryYearSpend: categoryYear,
      monthCategorySpend: monthCategory,
      categoryTotals: catTotals,
      monthTotals: monthTotalsFiscalOrder(monthCategory, factors),
      yearTotals: years,
      buildingMap,
      baselineTonnes: summary.totalTonnes,
      baselineSpend: summary.totalSpend,
      baselineIntensity: summary.kgPerDollar,
      cagr: emissionsCagr(years),
      summary,
      planInputs: buildPlanInputs(raw.levers, baselineByCategory, categoryNames),
      forecast,
    };
  }, [raw, categoryYear, monthCategory, forecast, summary, categoryRanking, buildingMap]);

  const value = useMemo<BadgerDataState>(
    () => ({ data, loading, error, reload: () => void load() }),
    [data, loading, error, load],
  );

  return <BadgerDataContext.Provider value={value}>{children}</BadgerDataContext.Provider>;
}

/** Access the shared dataset. Throws if used outside the provider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useBadgerData(): BadgerDataState {
  const ctx = useContext(BadgerDataContext);
  if (!ctx) throw new Error('useBadgerData must be used within a BadgerDataProvider');
  return ctx;
}
