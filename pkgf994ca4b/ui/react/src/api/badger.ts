/**
 * The single data-access layer for Badger Footprint. Every figure the UI renders
 * comes through this module; there is no mock data and no fallback — a failed call
 * propagates so the page can show the error rather than quietly display fiction.
 *
 * Two access patterns are used deliberately:
 *
 * - **`fetch`** for the small reference tables (13 categories, 16 departments,
 *   10 buildings, 13 levers, …). These are bounded by design, so pulling them
 *   whole is cheap and lets the client join locally.
 * - **`evaluate`** for anything derived from the 1,049 {@link SpendTransaction}
 *   rows. Grouping happens **on the server**, so the browser receives ~90 rows
 *   instead of the whole ledger. The carbon factor is then applied client-side
 *   from the already-fetched category table — a 13-row join, not 1,049 round trips.
 */

import { c3Action } from '@/c3Action';
import type {
  AgentSolveResult,
  Building,
  BuildingMap,
  BuildingMapCategory,
  BuildingMapCell,
  BuildingMapRow,
  CampusForecast,
  CampusSummary,
  CarbonBudget,
  CategoryYearSpend,
  ConsolidateOption,
  ConsolidatePeer,
  Contract,
  DecisionAction,
  DeferOption,
  Department,
  EmissionsBy,
  InterceptDecision,
  InterceptEvaluation,
  InterceptOption,
  InterceptQueue,
  InterceptQueueRow,
  InterceptRecommendation,
  InterceptStats,
  InterceptStep,
  InventoryItem,
  MonthCategorySpend,
  ProductCategory,
  ProductFootprint,
  PurchaseRequest,
  ReductionLever,
  ReuseOption,
  SubstituteOption,
  SustainabilityGoal,
  Vendor,
  VendorSpend,
} from '@/types/badger';

/** The fiscal year all baseline figures are measured against. */
export const BASELINE_FY = 2024;

/* ------------------------------ fetch helpers ------------------------------ */

interface FetchResult<T> {
  objs?: T[];
  count?: number;
}

/** FetchSpec passed straight through as the third `c3Action` argument (never wrapped). */
interface FetchSpec {
  limit?: number;
  offset?: number;
  include?: string;
  filter?: string;
  order?: string;
}

async function fetchAll<T>(typeName: string, spec: FetchSpec): Promise<T[]> {
  const res: FetchResult<T> = await c3Action(typeName, 'fetch', spec);
  return res?.objs ?? [];
}

/* ---------------------------- evaluate helpers ----------------------------- */

/**
 * A single cell of an `evaluate` tuple. The platform tags the value by its SQL
 * type, so exactly one of these keys is present per cell.
 */
interface EvalCell {
  str?: string;
  number?: number;
  int?: number;
  double?: number;
  long?: number;
}

/**
 * One tuple of an `evaluate` result. `cells` arrives as a JSON object keyed by
 * stringified index (`{"0": …, "1": …}`) rather than a JSON array, which is why
 * it is typed as a record and read by numeric index — `cells[0]` resolves
 * `cells["0"]` correctly either way.
 */
interface EvalTuple {
  cells: Record<number, EvalCell>;
}

interface EvalResult {
  tuples?: EvalTuple[];
  count?: number;
}

interface EvalSpec {
  projection: string;
  group?: string;
  filter?: string;
  order?: string;
  limit?: number;
}

/** Reads a cell as text, whichever type tag the platform used. */
function cellStr(cell?: EvalCell): string {
  if (!cell) return '';
  if (typeof cell.str === 'string') return cell.str;
  const n = cell.number ?? cell.int ?? cell.double ?? cell.long;
  return n === undefined ? '' : String(n);
}

/** Reads a cell as a number, defaulting to 0 so a missing group never renders NaN. */
function cellNum(cell?: EvalCell): number {
  if (!cell) return 0;
  const n = cell.number ?? cell.double ?? cell.int ?? cell.long;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

async function evaluate(typeName: string, spec: EvalSpec): Promise<EvalTuple[]> {
  const res: EvalResult = await c3Action(typeName, 'evaluate', spec);
  return res?.tuples ?? [];
}

/* --------------------------- reference tables ------------------------------ */

/**
 * The 13 curated spend categories **with their real EPA factor joined in**. This
 * is the lookup every carbon number in the app depends on, so it is fetched once
 * and shared.
 */
export function fetchCategories(): Promise<ProductCategory[]> {
  return fetchAll<ProductCategory>('ProductCategory', {
    limit: -1,
    include:
      'this, emissionFactor.id, emissionFactor.naicsCode, emissionFactor.naicsTitle, emissionFactor.kgCo2ePerDollar',
    order: 'name',
  });
}

export function fetchDepartments(): Promise<Department[]> {
  return fetchAll<Department>('Department', {
    limit: -1,
    include: 'this, building.id, building.name, building.latitude, building.longitude',
    order: 'name',
  });
}

export function fetchBuildings(): Promise<Building[]> {
  return fetchAll<Building>('Building', { limit: -1, include: 'this', order: 'name' });
}

export function fetchVendors(): Promise<Vendor[]> {
  return fetchAll<Vendor>('Vendor', {
    limit: -1,
    include: 'this, productCategory.id',
    order: 'name',
  });
}

export function fetchLevers(): Promise<ReductionLever[]> {
  return fetchAll<ReductionLever>('ReductionLever', {
    limit: -1,
    include: 'this, productCategory.id, productCategory.name',
  });
}

export function fetchGoals(): Promise<SustainabilityGoal[]> {
  return fetchAll<SustainabilityGoal>('SustainabilityGoal', {
    limit: -1,
    include: 'this',
    order: 'targetYear',
  });
}

export function fetchInventory(): Promise<InventoryItem[]> {
  return fetchAll<InventoryItem>('InventoryItem', {
    limit: -1,
    include:
      'this, productCategory.id, productCategory.name, department.id, department.name, building.id, building.name',
  });
}

/** Requests still awaiting a decision — the intercept queue. */
export function fetchPendingRequests(): Promise<PurchaseRequest[]> {
  return fetchAll<PurchaseRequest>('PurchaseRequest', {
    limit: -1,
    include:
      'this, productCategory.id, productCategory.name, department.id, department.name, building.id, building.name, vendor.id, vendor.name',
    order: 'requestDate',
  });
}

export function fetchContracts(): Promise<Contract[]> {
  return fetchAll<Contract>('Contract', {
    limit: -1,
    include: 'this, vendor.id, vendor.name',
  });
}

export function fetchFootprints(): Promise<ProductFootprint[]> {
  return fetchAll<ProductFootprint>('ProductFootprint', { limit: -1, include: 'this' });
}

export function fetchBudgets(fiscalYear: number): Promise<CarbonBudget[]> {
  return fetchAll<CarbonBudget>('CarbonBudget', {
    limit: -1,
    include: 'this, department.id, department.name',
    filter: `fiscalYear == ${fiscalYear}`,
  });
}

/* ------------------------------- aggregates -------------------------------- */

/**
 * Spend grouped by category × fiscal year — 91 rows covering FY2019–FY2025.
 * One call powers the whole trend chart, the category ranking, and the baseline.
 */
export async function spendByCategoryAndYear(): Promise<CategoryYearSpend[]> {
  const tuples = await evaluate('SpendTransaction', {
    projection: 'productCategory.id, fiscalYear, sum(amount)',
    group: 'productCategory.id, fiscalYear',
    order: 'fiscalYear',
  });
  return tuples.map((t) => ({
    categoryId: cellStr(t.cells[0]),
    fiscalYear: cellNum(t.cells[1]),
    amount: cellNum(t.cells[2]),
  }));
}

/*
 * `spendByDeptAndCategory()` used to live here. It was the one raw cut the browser
 * still rolled up itself — into department totals, building totals and the
 * building × category heatmap. All three now come from
 * {@link fetchBuildingMap} and `emissionsBy('department')`, so the call is gone
 * rather than left fetching ~82 rows nothing reads.
 */

/**
 * Spend grouped by calendar month × category for one fiscal year — the shape that
 * exposes the June year-end spike.
 */
export async function spendByMonthAndCategory(fiscalYear: number): Promise<MonthCategorySpend[]> {
  const tuples = await evaluate('SpendTransaction', {
    projection: 'month(transactionDate), productCategory.id, sum(amount)',
    group: 'month(transactionDate), productCategory.id',
    filter: `fiscalYear == ${fiscalYear}`,
  });
  return tuples.map((t) => ({
    month: cellNum(t.cells[0]),
    categoryId: cellStr(t.cells[1]),
    amount: cellNum(t.cells[2]),
  }));
}

/** Spend grouped by vendor for one fiscal year (20 rows). */
export async function spendByVendor(fiscalYear: number): Promise<VendorSpend[]> {
  const tuples = await evaluate('SpendTransaction', {
    projection: 'vendor.id, sum(amount)',
    group: 'vendor.id',
    filter: `fiscalYear == ${fiscalYear}`,
  });
  return tuples.map((t) => ({
    vendorId: cellStr(t.cells[0]),
    amount: cellNum(t.cells[1]),
  }));
}

/**
 * Every building's twelve-month emissions projection, fitted on the server.
 *
 * One call covers all ten buildings because the campus map needs a projection on
 * hover and hovering must not cost a round trip per marker. The regression itself
 * runs in {@link ForecastAgent} — the browser does no model fitting, which is the
 * same division of labour as every other figure in this app.
 */
export function fetchBuildingForecasts(horizonMonths = 12): Promise<CampusForecast> {
  return c3Action('ForecastAgent', 'allBuildingForecasts', [horizonMonths]);
}

/* ------------------------------ agent calls -------------------------------- *
 * Everything below reaches a backend agent rather than a table. The agents own
 * the arithmetic, so the browser receives figures it only has to format — which
 * is the point: there is exactly one implementation of the carbon math and it is
 * the one the Method page describes.
 * --------------------------------------------------------------------------- */

/** Every headline figure for one fiscal year, computed server-side. */
export function fetchCampusSummary(fiscalYear = BASELINE_FY): Promise<CampusSummary> {
  return c3Action('BadgerAnalytics', 'campusSummary', [fiscalYear]);
}

/**
 * Emissions ranked along one dimension.
 *
 * `dimension` must be one of `category`, `department`, `building`, `college` or
 * `vendor` — the agent throws on anything else rather than returning an empty
 * ranking, which is the behaviour we want: a typo should be loud.
 */
export function fetchEmissionsBy(
  dimension: 'category' | 'department' | 'building' | 'college' | 'vendor',
  fiscalYear = BASELINE_FY,
): Promise<EmissionsBy> {
  return c3Action('BadgerAnalytics', 'emissionsBy', [dimension, fiscalYear]);
}

/**
 * A collection inside an agent's `json` return, as it actually arrives on the wire.
 *
 * The platform serialises a nested JS array as an index-keyed object — `{}` when
 * empty, `{"0": …, "1": …}` when populated — so it is neither reliably an array
 * nor reliably an object. Normalising it is this module's job: pages downstream
 * get real arrays and never have to know.
 */
type Indexed<T> = T[] | Record<string, T>;

function asArray<T>(v: Indexed<T> | null | undefined): T[] {
  if (Array.isArray(v)) return v;
  return v ? Object.values(v) : [];
}

/** The `buildingMap` envelope before normalisation. */
interface WireBuildingMap extends Omit<BuildingMap, 'buildings' | 'categories' | 'matrix'> {
  buildings: Indexed<Omit<BuildingMapRow, 'departments'> & { departments: Indexed<string> }>;
  categories: Indexed<BuildingMapCategory>;
  matrix: Indexed<BuildingMapCell>;
}

/**
 * Everything the campus map draws: per-building emissions with coordinates, the
 * building × category matrix underneath them, and the category axis.
 *
 * One call, because the alternative is the browser re-deriving the matrix from the
 * raw ledger — applying the spend-based emission factor a second time, in a second
 * language. Two implementations of the same arithmetic is one edit away from a
 * heatmap that disagrees with the totals printed beside it.
 */
export async function fetchBuildingMap(fiscalYear = BASELINE_FY): Promise<BuildingMap> {
  const res: WireBuildingMap = await c3Action('BadgerAnalytics', 'buildingMap', [fiscalYear]);
  return {
    ...res,
    buildings: asArray(res.buildings).map((b) => ({
      ...b,
      departments: asArray(b.departments),
    })),
    categories: asArray(res.categories),
    matrix: asArray(res.matrix),
  };
}

/* ------------------------------ intercept agent ---------------------------- */

/** One rung as it arrives: a consolidation's `peers` list is index-keyed. */
type WireOption =
  | ReuseOption
  | SubstituteOption
  | DeferOption
  | (Omit<ConsolidateOption, 'peers'> & { peers: Indexed<ConsolidatePeer> });

function normaliseOption(o: WireOption): InterceptOption {
  return o.action === 'consolidate' ? { ...o, peers: asArray(o.peers) } : o;
}

/** The {@link InterceptAgent#evaluate} envelope before normalisation. */
type WireEvaluation = Omit<
  InterceptEvaluation,
  'options' | 'reuse' | 'substitute' | 'consolidate' | 'recommendation'
> & {
  options: Indexed<WireOption>;
  reuse: Indexed<ReuseOption>;
  substitute: Indexed<SubstituteOption>;
  consolidate: (Omit<ConsolidateOption, 'peers'> & { peers: Indexed<ConsolidatePeer> }) | null;
  recommendation: Omit<InterceptRecommendation, 'steps'> & { steps: Indexed<InterceptStep> };
};

/**
 * The review queue: every request with what it would emit and the best way out.
 *
 * `status` is a {@link PurchaseRequest#status} to filter on, or `'all'`. The page
 * asks for `'all'` on purpose — {@link decideRequest} is a real write, so a
 * decided request would otherwise vanish from the list the moment it was decided,
 * taking its own receipt with it.
 */
export async function fetchInterceptQueue(status = 'all', limit = 50): Promise<InterceptQueue> {
  const res: Omit<InterceptQueue, 'rows'> & { rows: Indexed<InterceptQueueRow> } = await c3Action(
    'InterceptAgent',
    'queue',
    [status, limit],
  );
  return { ...res, rows: asArray(res.rows) };
}

/**
 * Everything the agent can say about one request: its estimated carbon, each rung
 * of the ladder with its own evidence, and the stacked plan across them.
 *
 * Fetched per selection rather than for the whole queue up front. The evaluation
 * is heavy — it scans the surplus list, the contract catalogue and every other
 * pending request — and only one request is ever open.
 */
export async function fetchInterceptEvaluation(requestId: string): Promise<InterceptEvaluation> {
  const res: WireEvaluation = await c3Action('InterceptAgent', 'evaluate', [requestId]);
  return {
    ...res,
    options: asArray(res.options).map(normaliseOption),
    reuse: asArray(res.reuse),
    substitute: asArray(res.substitute),
    consolidate: res.consolidate ? { ...res.consolidate, peers: asArray(res.consolidate.peers) } : null,
    recommendation: { ...res.recommendation, steps: asArray(res.recommendation.steps) },
  };
}

/**
 * Record a human decision. **This is the app's only write.**
 *
 * It changes {@link PurchaseRequest#status} and appends `reason` to the
 * justification, so it is not idempotent and not undoable by refetching — which
 * is why `reset` exists as an action, and why the page refetches the queue
 * afterwards instead of patching its own copy of the row.
 */
export function decideRequest(
  requestId: string,
  action: DecisionAction,
  reason: string,
): Promise<InterceptDecision> {
  return c3Action('InterceptAgent', 'decide', [requestId, action, reason]);
}

/**
 * The portfolio view: what the queue is worth, what has been decided, and what
 * that is worth against the 2030 goal.
 *
 * Separate from {@link fetchInterceptQueue} because it reads every request
 * regardless of the queue's limit, and because it carries the two figures the
 * scoreboard exists to contrast — `avoidableTonnes` (the offer) and
 * `realised.tonnes` (what has actually been accepted).
 */
export async function fetchInterceptStats(fiscalYear = BASELINE_FY): Promise<InterceptStats> {
  const res: Omit<
    InterceptStats,
    'partialMatches' | 'topOpportunities' | 'statusCounts' | 'decisionsAgainstAdvice'
  > & {
    partialMatches: Indexed<InterceptStats['partialMatches'][number]>;
    topOpportunities: Indexed<InterceptStats['topOpportunities'][number]>;
    statusCounts: Indexed<InterceptStats['statusCounts'][number]>;
    decisionsAgainstAdvice: Indexed<InterceptStats['decisionsAgainstAdvice'][number]>;
  } = await c3Action('InterceptAgent', 'interceptStats', [fiscalYear]);
  return {
    ...res,
    partialMatches: asArray(res.partialMatches),
    topOpportunities: asArray(res.topOpportunities),
    statusCounts: asArray(res.statusCounts),
    decisionsAgainstAdvice: asArray(res.decisionsAgainstAdvice),
  };
}

/** The strategy names the backend solver speaks. The UI's own names are shorter. */
export type AgentStrategy = 'equal_pct' | 'cheapest_first' | 'effort_balanced';

/** One scenario request for {@link PlannerAgent#solve}. */
export interface SolveSpec {
  targetYear: number;
  strategy: AgentStrategy;
  /** Category id → held cut, as a percentage 0–100. */
  pins: Record<string, number>;
  /**
   * Depth of cut to solve against, 0–100. Omit to use the published goal for
   * `targetYear`. Supplied by the page's target slider.
   */
  targetPct?: number;
  fiscalYear?: number;
}

/**
 * Solve one reduction scenario on the server.
 *
 * This is the call that answers the question the whole Planner page exists to ask,
 * and it runs on every slider change (debounced). The browser does not solve
 * anything: it collects pins and sends them.
 */
export function solveScenario(spec: SolveSpec): Promise<AgentSolveResult> {
  return c3Action('PlannerAgent', 'solve', [spec]);
}
