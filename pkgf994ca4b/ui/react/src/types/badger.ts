/**
 * TypeScript mirrors of the Badger Footprint C3 entity types in `src/*.c3typ`.
 *
 * Every interface here corresponds 1:1 to a persisted C3 type; nothing in this
 * file is invented UI state. Reference fields are modelled as the partial shape
 * the `include` string actually asks for (usually `{ id }` plus a display name),
 * rather than the full nested entity, so the compiler stops us reading a field we
 * never fetched.
 */

/** A referenced entity narrowed to what our FetchSpecs include. */
export interface Ref {
  id: string;
  name?: string;
}

/**
 * A real EPA Supply Chain GHG Emission Factor row (USEEIO v1.3, NAICS-6, 2022 USD,
 * "with margins"). These 1,016 records are loaded verbatim — they are the one part
 * of the dataset that is not fabricated.
 */
export interface EmissionFactor {
  id: string;
  naicsCode: string;
  naicsTitle: string;
  kgCo2ePerDollar: number;
  ghg?: string;
  unit?: string;
  useeioCode?: string;
}

/** A curated spend category, bridging vendors to exactly one {@link EmissionFactor}. */
export interface ProductCategory {
  id: string;
  name: string;
  description?: string;
  emissionFactor?: EmissionFactor;
}

/** A campus building, with coordinates for the carbon map. */
export interface Building {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** An academic department — the unit that owns a budget and makes purchases. */
export interface Department {
  id: string;
  name: string;
  college?: string;
  building?: Building;
}

/** A supplier, classified into one {@link ProductCategory}. */
export interface Vendor {
  id: string;
  name: string;
  productCategory?: Ref;
}

/** One line of historical purchasing — the raw material of the spend-based estimate. */
export interface SpendTransaction {
  id: string;
  amount: number;
  fiscalYear: number;
  transactionDate?: string;
  description?: string;
  vendor?: Ref;
  department?: Ref;
  productCategory?: Ref;
}

/** A catalogue line item available on an existing campus contract. */
export interface Contract {
  id: string;
  productName: string;
  unitPrice?: number;
  description?: string;
  vendor?: Ref;
}

/** A manufacturer-published product carbon footprint, in kg CO2e per unit. */
export interface ProductFootprint {
  id: string;
  productName: string;
  manufacturer?: string;
  kgCo2e: number;
  lifespanYears?: number;
  pctManufacturing?: number;
  source?: string;
}

/** A department's emissions/dollar allowance for a fiscal year. */
export interface CarbonBudget {
  id: string;
  fiscalYear: number;
  targetTonnesCo2e: number;
  dollarBudget?: number;
  department?: Ref;
}

/** Surplus stock a department is willing to share — the supply side of reuse. */
export interface InventoryItem {
  id: string;
  productName: string;
  quantityOnHand: number;
  quantityExcess: number;
  unitPrice?: number;
  unitLabel?: string;
  lastUpdated?: string;
  notes?: string;
  productCategory?: Ref;
  department?: Ref;
  building?: Ref;
}

/** Workflow states a {@link PurchaseRequest} can be in. */
export type RequestStatus =
  | 'Pending'
  | 'Approved'
  | 'Reused'
  | 'Substituted'
  | 'Consolidated'
  | 'Declined';

/** An incoming request, evaluated *before* it becomes a {@link SpendTransaction}. */
export interface PurchaseRequest {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  requestedBy?: string;
  requestDate?: string;
  status: RequestStatus;
  justification?: string;
  productCategory?: Ref;
  department?: Ref;
  building?: Ref;
  vendor?: Ref;
}

/** A category's feasibility ceiling and abatement cost — one named action. */
export interface ReductionLever {
  id: string;
  name: string;
  maxReductionPct: number;
  costPerTonne?: number;
  effortLevel?: 'Low' | 'Medium' | 'High' | string;
  owner?: string;
  description?: string;
  /**
   * The earliest year this action could be in place. `PlannerAgent.solve` only
   * spends levers with `horizonYear <= targetYear`, which is why a 2030 plan has
   * a genuinely lower ceiling than a 2040 one rather than the same ceiling with
   * more time to reach it.
   */
  horizonYear?: number;
  productCategory?: Ref;
}

/** A published reduction milestone the planner aims at. */
export interface SustainabilityGoal {
  id: string;
  name: string;
  targetYear: number;
  baselineYear: number;
  reductionPct: number;
  scope?: string;
  description?: string;
}

/* ------------------------------ aggregate rows ----------------------------- */

/** One row of a server-side `evaluate` grouped by category and fiscal year. */
export interface CategoryYearSpend {
  categoryId: string;
  fiscalYear: number;
  amount: number;
}

/*
 * `DeptCategorySpend` used to sit here — the department × category cut the browser
 * rolled up into building totals and the campus heatmap. Both now arrive from
 * `BadgerAnalytics.buildingMap`, so the shape has no consumer and is gone rather
 * than left as a type that documents an architecture the app no longer has.
 */

/** One row grouped by calendar month and category, for a single fiscal year. */
export interface MonthCategorySpend {
  month: number;
  categoryId: string;
  amount: number;
}

/** One row grouped by vendor. */
export interface VendorSpend {
  vendorId: string;
  amount: number;
}

/**
 * One building's row from {@link ForecastAgent#allBuildingForecasts} — a fitted
 * OLS projection, not a measurement.
 *
 * The field names mirror the agent's response exactly so there is no translation
 * layer to drift. Two trailing-twelve-month baselines are returned on purpose:
 * `fittedTrailing12MonthsTonnes` is what the model says the last year was, and is
 * the baseline `changePct` is measured against so that both sides of the comparison
 * come off the same regression line; `actualTrailing12MonthsTonnes` is what was
 * really spent, and `modelVsActualPct` is the gap between them — the plainest
 * available statement of how much to trust the projection.
 *
 * Every numeric field is `null` when `fittable` is false, which happens for a
 * building with too little purchase history to fit thirteen parameters against.
 */
export interface BuildingForecast {
  buildingId: string;
  buildingName: string | null;
  fittable: boolean;
  /** Share of month-to-month variation the fit explains. Runs ~0.12–0.39 here. */
  rSquared: number | null;
  observationCount: number;
  seasonalTermsFitted: boolean;
  fittedTrailing12MonthsTonnes: number | null;
  actualTrailing12MonthsTonnes: number | null;
  next12MonthsTonnes: number | null;
  changeTonnes: number | null;
  changePct: number | null;
  modelVsActualPct: number | null;
  direction: 'rising' | 'falling' | 'flat' | null;
  /** Year-on-year change in a twelve-month total implied by the trend coefficient. */
  trendAnnualTotalDeltaTonnes: number | null;
  /** Half-width of the 95% prediction interval for a single month, in tonnes. */
  confidenceBandTonnes: number | null;
  residualSigmaTonnes: number | null;
  peakMonth: string | null;
  note: string;
}

/** The full {@link ForecastAgent#allBuildingForecasts} envelope. */
export interface CampusForecast {
  horizonMonths: number;
  buildingCount: number;
  fittableCount: number;
  ledgerThroughYear: number;
  ledgerThroughMonth: number;
  campusFittedTrailing12MonthsTonnes: number;
  campusActualTrailing12MonthsTonnes: number;
  campusNext12MonthsTonnes: number;
  campusChangePct: number;
  rows: BuildingForecast[];
  /** Estimator name, e.g. `ols_linear_trend_plus_monthly_seasonality`. */
  method: string;
  /** Prose the UI must surface rather than hide — says this is a projection. */
  disclaimer: string;
}

/* --------------------------- agent response shapes -------------------------- *
 * These mirror the backend agents' `json` returns field-for-field. Two contracts
 * hold across all four agents and are the only things to be careful about at this
 * boundary: tonnes arrive rounded to 1 dp, and **every percentage is a 0–100
 * double, never a 0–1 fraction** — so they want `signedPct`/`.toFixed`, not the
 * `pct()` helper, which multiplies by 100.
 * --------------------------------------------------------------------------- */

/** One ranked row from {@link BadgerAnalytics#emissionsBy}. */
export interface EmissionsByRow {
  rank: number;
  id: string;
  name: string;
  tonnes: number;
  spend: number;
  transactionCount: number;
  /** Share of total carbon, 0–100. */
  sharePct: number;
  /** Share of total spend, 0–100. */
  spendSharePct: number;
  kgPerDollar: number;
}

/** The {@link BadgerAnalytics#emissionsBy} envelope. */
export interface EmissionsBy {
  dimension: string;
  fiscalYear: number;
  totalTonnes: number;
  totalSpend: number;
  rows: EmissionsByRow[];
}

/** How concentrated the footprint is — the case for targeting a few categories. */
export interface Concentration {
  top3SharePct: number;
  categoryCount: number;
  note: string;
}

/** The {@link BadgerAnalytics#campusSummary} envelope — every headline figure. */
export interface CampusSummary {
  fiscalYear: number;
  totalTonnes: number;
  totalSpend: number;
  /** Weighted basket intensity, kg CO₂e per dollar. */
  kgPerDollar: number;
  transactionCount: number;
  departmentCount: number;
  buildingCount: number;
  concentration: Concentration;
}

/**
 * One building's row from {@link BadgerAnalytics#buildingMap} — measured, not
 * modelled. The campus map draws these directly.
 */
export interface BuildingMapRow {
  id: string;
  name: string;
  /** Null for a building seeded without coordinates; such rows are not drawn. */
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  tonnes: number;
  spend: number;
  /** Share of campus purchasing carbon, 0–100. */
  sharePct: number;
  /** Intensity of this building's basket, kg CO₂e per dollar. */
  kgPerDollar: number;
  /** How many departments order independently from this address. */
  departmentCount: number;
  departments: string[];
  /**
   * The category dominating this building's mix. A building's total says *how
   * much* carbon it buys; this says *what kind*, which is what decides whether a
   * given {@link ReductionLever} applies to it at all.
   */
  dominantCategoryId: string | null;
  dominantCategoryName: string | null;
  dominantCategoryTonnes: number;
  /** The dominant category's share of this building's own footprint, 0–100. */
  dominantCategorySharePct: number;
}

/** The matrix's column axis, ordered by campus carbon descending. */
export interface BuildingMapCategory {
  id: string;
  name: string;
  tonnes: number;
}

/**
 * One populated cell of the building × category matrix.
 *
 * The two shares answer two different questions, which is why both are carried.
 * `buildingSharePct` is what kind of carbon this building buys — read across a
 * row. `categorySharePct` is how much of one lever's campus-wide reach sits at
 * this single address — read down a column, and the figure that decides whether
 * a visit is worth the trip.
 */
export interface BuildingMapCell {
  buildingId: string;
  categoryId: string;
  tonnes: number;
  /** Share of this building's footprint, 0–100. */
  buildingSharePct: number;
  /** Share of all campus carbon in this category, 0–100. */
  categorySharePct: number;
}

/** The {@link BadgerAnalytics#buildingMap} envelope — the whole campus map. */
export interface BuildingMap {
  fiscalYear: number;
  totalTonnes: number;
  buildings: BuildingMapRow[];
  categories: BuildingMapCategory[];
  matrix: BuildingMapCell[];
  /** Prose the map must surface: these emissions happen at suppliers, not here. */
  interpretation: string;
}

/* ------------------------------ intercept agent ---------------------------- *
 * {@link InterceptAgent} is the only agent whose methods are not all read-only,
 * so its shapes are mirrored here in full: the queue row the list renders, the
 * four option kinds as a discriminated union on `action`, the stacked plan, and
 * the decision receipt that comes back from a real write.
 * --------------------------------------------------------------------------- */

/** The four rungs of the ladder, in the order the agent climbs them. */
export type LeverKind = 'reuse' | 'substitute' | 'consolidate' | 'defer';

/** What the agent advises for one request — a rung, or "this one should just be bought". */
export type TopAction = LeverKind | 'proceed';

/**
 * What {@link InterceptAgent#decide} accepts. **`defer` is deliberately absent:**
 * a deferral is a risk estimate rather than a booked saving, so it is recorded as
 * `decline` (the request is withdrawn and re-raised when the need is confirmed)
 * and is never credited as realised carbon.
 */
export type DecisionAction =
  | 'reuse'
  | 'substitute'
  | 'consolidate'
  | 'approve'
  | 'decline'
  | 'reset';

/** How close the surplus is. Reuse options are ranked by this before tonnage. */
export type ReuseProximity = 'same_department' | 'same_building' | 'nearby' | 'campus';

/** Fields every rung carries, whatever its evidence. */
interface InterceptOptionBase {
  /** Rank within this rung, 1-based. */
  rank: number;
  coversUnits: number;
  /** Share of the requested units this option covers, 0–100. */
  coversPct: number;
  avoidedTonnes: number;
  avoidedUsd: number;
  /** How the carbon was derived: `product_footprint`, `spend_based`, `estimated_logistics`, … */
  method: string;
  /** The arithmetic spelled out. Printed beside the figure, never instead of it. */
  basis: string;
  /** A ready-to-send sentence. The UI renders this rather than composing its own. */
  message: string;
}

/** Rung 1: surplus stock that already exists somewhere on campus. */
export interface ReuseOption extends InterceptOptionBase {
  action: 'reuse';
  proximity: ReuseProximity;
  proximityRank: number;
  /** Metres from holder to requester; null when either address lacks coordinates. */
  distanceMeters: number | null;
  /** True when the surplus covers the whole request, not just part of it. */
  full: boolean;
  sourceInventoryId: string;
  sourceProductName: string;
  sourceDepartmentId: string | null;
  sourceDepartmentName: string | null;
  sourceBuildingId: string | null;
  sourceBuildingName: string | null;
  unitsAvailable: number;
  unitLabel: string | null;
  /** Whatever the holding department wrote about the stock. Often the deciding detail. */
  ownerNotes: string | null;
}

/** Rung 2: a cheaper, cleaner line on a contract that already exists. */
export interface SubstituteOption extends InterceptOptionBase {
  action: 'substitute';
  contractId: string;
  contractProductName: string;
  contractUnitPrice: number;
  requestUnitPrice: number;
  /** How much cheaper per unit, 0–100. */
  unitPriceDeltaPct: number;
  vendorName: string | null;
  /** Why this line is believed cleaner — a published footprint or a circular flag. */
  evidence: string;
}

/** Another pending request this one could ship with. */
export interface ConsolidatePeer {
  id: string;
  productName: string;
  departmentName: string | null;
  quantity: number;
  amount: number;
  requestedBy: string | null;
  vendorName: string | null;
}

/** Rung 3: one delivery instead of several to the same address. */
export interface ConsolidateOption extends InterceptOptionBase {
  action: 'consolidate';
  ordersAvoided: number;
  combinedUsd: number;
  peers: ConsolidatePeer[];
}

/** Rung 4: the fiscal-year-end rush, where some of the spend is above real demand. */
export interface DeferOption extends InterceptOptionBase {
  action: 'defer';
  /** Share of this order the year-end analysis puts above baseline demand, 0–100. */
  riskSharePct: number;
  /** Why this rung is the weakest claim on the ladder. Always rendered with it. */
  caveat: string;
}

/** One rung of the ladder, narrowable by its `action`. */
export type InterceptOption = ReuseOption | SubstituteOption | ConsolidateOption | DeferOption;

/** One step of the stacked plan. */
export interface InterceptStep {
  order: number;
  action: LeverKind;
  units: number;
  avoidedTonnes: number;
  avoidedUsd: number;
  detail: string;
}

/**
 * The agent's actual advice, which is **not** the same as its option list.
 *
 * Options are alternatives — take one and the others no longer apply. These steps
 * are stacked: claim the surplus that exists, substitute only the units it could
 * not cover, consolidate whatever still ships. That is why the plan's avoided
 * total can exceed any single option's, and why a UI must never sum the options.
 */
export interface InterceptRecommendation {
  topAction: TopAction;
  steps: InterceptStep[];
  avoidedTonnes: number;
  avoidedUsd: number;
  /** Share of this request's own carbon, 0–100, capped at 100. */
  avoidedPct: number;
  residualTonnes: number;
  unitsStillOrdered: number;
  summary: string;
}

/** The request as the agent flattened it, with every reference resolved to a name. */
export interface InterceptRequest {
  id: string;
  productName: string;
  categoryId: string | null;
  categoryName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  buildingId: string | null;
  buildingName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  requestedBy: string | null;
  requestDate: string | null;
  /** Calendar month 1–12 — what the deferral rung tests against. */
  month: number;
  status: RequestStatus;
  justification: string | null;
}

/** The {@link InterceptAgent#evaluate} envelope — the detail view behind a queue row. */
export interface InterceptEvaluation {
  request: InterceptRequest;
  estimated: {
    tonnes: number;
    method: string;
    basis: string;
    footprintId: string | null;
  };
  options: InterceptOption[];
  optionCount: number;
  reuse: ReuseOption[];
  substitute: SubstituteOption[];
  consolidate: ConsolidateOption | null;
  defer: DeferOption | null;
  /**
   * Why the reuse rung came back empty, in one sentence derived from the surplus
   * list that was actually searched. Null when reuse found something. Three
   * different problems hide behind "no suggestions" — nothing declared surplus,
   * everything declared already committed, or a near-miss on the product name —
   * and they belong to three different people.
   */
  reuseGap: string | null;
  recommendation: InterceptRecommendation;
  /** The radius, in metres, below which a different building still counts as "nearby". */
  nearbyMeters: number;
  yearEndContext: {
    fiscalYear: number;
    juneMultiple: number;
    excessSharePct: number;
  };
}

/** One row of {@link InterceptAgent#queue} — the list view, pre-flattened for rendering. */
export interface InterceptQueueRow {
  requestId: string;
  productName: string;
  categoryId: string | null;
  categoryName: string | null;
  departmentName: string | null;
  buildingName: string | null;
  vendorName: string | null;
  quantity: number;
  amount: number;
  requestedBy: string | null;
  requestDate: string | null;
  status: RequestStatus;
  estimatedTonnes: number;
  carbonMethod: string;
  topAction: TopAction;
  optionCount: number;
  avoidedTonnes: number;
  avoidedUsd: number;
  /** Share of this request's carbon the plan avoids, 0–100. */
  avoidedPct: number;
  residualTonnes: number;
  reuseProximity: ReuseProximity | null;
  reuseDistanceMeters: number | null;
  reuseSourceDepartment: string | null;
  /** How much of the request the best surplus match covers, 0–100. */
  reuseCoversPct: number;
  hasSubstitute: boolean;
  hasConsolidation: boolean;
  /** True for a May/June request — the year-end window. */
  yearEndFlag: boolean;
  headline: string;
}

/** The {@link InterceptAgent#queue} envelope. */
export interface InterceptQueue {
  /** The status filter that was applied, echoed back. */
  status: string;
  requestCount: number;
  returned: number;
  totalValueUsd: number;
  totalEstimatedTonnes: number;
  requestsWithOpportunity: number;
  /** Share of the queue with at least one option, 0–100. */
  opportunityRatePct: number;
  avoidableTonnes: number;
  avoidableUsd: number;
  /** Share of the queue's carbon the plans avoid, 0–100. */
  avoidablePct: number;
  nearbyMeters: number;
  rows: InterceptQueueRow[];
}

/** The receipt from {@link InterceptAgent#decide} — a real write, already committed. */
export interface InterceptDecision {
  requestId: string;
  action: DecisionAction;
  status: RequestStatus;
  reason: string | null;
  accepted: boolean;
  /** Credited from a fresh evaluation of the rung taken, not from the caller. */
  realisedTonnes: number;
  realisedUsd: number;
  /** Who or what the saving came from: a department, a contract line, the peer count. */
  counterparty: string | null;
  residualTonnes: number;
  justification: string;
  /**
   * Present only when an option existed and was not taken. This is the most
   * useful thing the tool collects: it names the barrier rather than the failure.
   */
  barrierSignal: {
    note: string;
    forgoneTonnes: number;
    forgoneUsd: number;
    reason: string | null;
  } | null;
}

/** The {@link InterceptAgent#interceptStats} envelope — the portfolio view. */
export interface InterceptStats {
  fiscalYear: number;
  requestCount: number;
  totalValueUsd: number;
  totalEstimatedTonnes: number;
  /** What the queue is worth if every top recommendation were accepted. An offer. */
  avoidableTonnes: number;
  avoidableUsd: number;
  avoidablePct: number;
  /** What has actually been credited by the decisions on record. An achievement. */
  realised: {
    pendingCount: number;
    decidedCount: number;
    acceptedCount: number;
    tonnes: number;
    usd: number;
    /** Realised as a share of avoidable, 0–100. */
    shareOfAvoidablePct: number;
    note: string;
  };
  topActionMix: Record<TopAction, number>;
  reuseProximityMix: Record<ReuseProximity | 'none', number>;
  nearbyMeters: number;
  partialMatches: {
    requestId: string;
    productName: string;
    requestedUnits: number;
    availableUnits: number;
    coversPct: number;
    sourceDepartmentName: string | null;
    note: string;
  }[];
  topOpportunities: {
    requestId: string;
    productName: string;
    categoryName: string | null;
    departmentName: string | null;
    topAction: TopAction;
    avoidedTonnes: number;
    avoidedUsd: number;
  }[];
  statusCounts: { status: RequestStatus; count: number }[];
  decisionsAgainstAdvice: {
    requestId: string;
    productName: string;
    status: RequestStatus;
    forgoneTonnes: number;
    forgoneUsd: number;
    reason: string | null;
  }[];
  campusContext: {
    fiscalYear: number;
    campusTonnes: number;
    campusSpendUsd: number;
    /** The whole queue as a share of the year's purchasing carbon, 0–100. */
    queueShareOfCampusTonnesPct: number;
    juneMultiple: number;
    yearEndExcessSharePct: number;
  };
  /**
   * The loop back to {@link PlannerAgent}: this queue expressed as a share of the
   * gap to the 2030 goal. Null if no 2030 goal is seeded.
   */
  goal: {
    id: string;
    name: string;
    targetYear: number;
    reductionPct: number;
    gapTonnes: number;
    /** Avoidable carbon as a share of that gap, 0–100. */
    interceptSharePct: number;
    note: string;
  } | null;
  interpretation: string;
}

/** One category's allocation from {@link PlannerAgent#solve}. */
export interface AgentSolveCategory {
  id: string;
  name: string;
  baselineTonnes: number;
  pinned: boolean;
  /** Assigned cut, 0–100. */
  cutPct: number;
  cutTonnes: number;
  residualTonnes: number;
  /** Feasibility ceiling on this plan's horizon, 0–100. */
  ceilingPct: number;
  headroomRemainingPct: number;
  atCeiling: boolean;
  costUsd: number;
  costPerTonne: number;
  actions: AgentSolveAction[];
}

/** One lever composing a category's cut — what makes a slider answer "which 12%?". */
export interface AgentSolveAction {
  leverId: string;
  name: string;
  owner: string | null;
  effortLevel: 'Low' | 'Medium' | 'High';
  horizonYear: number;
  cutPct: number;
  cutTonnes: number;
  ceilingPct: number;
  fullyUsed: boolean;
  costPerTonne: number;
  costUsd: number;
  description: string | null;
}

/** The {@link PlannerAgent#solve} envelope. */
export interface AgentSolveResult {
  targetYear: number;
  strategy: string;
  baselineFiscalYear: number;
  baselineTonnes: number;
  goal: {
    id: string;
    name: string;
    /** The depth actually solved against, 0–100. */
    reductionPct: number;
    /** The university's published figure, 0–100 — shown even when overridden. */
    publishedReductionPct: number;
    targetOverridden: boolean;
    targetTonnes: number;
    needTonnes: number;
    scope: string | null;
  };
  feasible: boolean;
  achievedTonnes: number;
  /** Achieved cut as a percentage of baseline, 0–100. */
  achievedPct: number;
  shortfallTonnes: number;
  resultingTonnes: number;
  pinnedTonnes: number;
  pinnedCategoryCount: number;
  freeCategoryCount: number;
  freeCapacityTonnes: number;
  cost: {
    netUsd: number;
    savingsUsd: number;
    spendUsd: number;
    avgCostPerTonne: number;
  };
  categories: AgentSolveCategory[];
  /** Clamped pins and ignored inputs, reported rather than swallowed. */
  pinNotes: Record<string, string> | string[];
  /** Present only when `feasible` is false. */
  infeasibility?: {
    shortfallTonnes: number;
    shortfallPctOfBaseline: number;
    maxAchievableTonnes: number;
    maxAchievablePct: number;
    message: string;
    suggestions: string[];
  };
  narrative: string;
}
