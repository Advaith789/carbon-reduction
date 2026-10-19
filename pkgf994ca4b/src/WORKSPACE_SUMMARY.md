# Workspace Summary

> Work-to-date map of this workspace. Keep concise; update as meaningful changes land.

## Current state

**Badger Footprint** — spend-based Scope 3 carbon analytics for UW-Madison purchasing (C3 AI
Accelerator Hackathon). **Data layer + full 5-page UI + four deterministic agents + the agentic
copilot over them, all built and verified.**

- **Git:** remote `github.com/Advaith789/carbon-reduction`; only `main` on remote. Working branch `workspace/69e8d6af-...` is local-only.
- **Backend (`src/`):** 13 entity types + 1 plan entity, all seeded & upserted, no Pkg.Issues.
- **Agent layer:** 4 deterministic library types, 14 methods, all smoke-tested server-side (see below).
- **Agentic layer:** `BadgerCopilot` — a tool-calling LLM loop that *orchestrates* those 14 methods.
  **14 declared tools (12 read, 2 confirm-gated writes)**, now including the two `ForecastAgent`
  projections. Smoke-tested (see *The agentic layer*).
- **UI:** 5 pages wired to real `c3Action` calls. **Bucky is a global floating popup** (draggable
  FAB, one transcript shared across routes) rather than a panel per page; the Planner keeps one
  inline panel on purpose and the Method page carries the manifest + FAQ. Dark-default.
  `npm run build` green.
- **Text density:** explanatory prose was moved out of the pages into a **21-entry FAQ/glossary** on
  `/methodology`, reachable from any page via dotted-underline `<Term>` links. See *Terseness, and
  where the prose went*.
- **Every displayed figure is an agent's.** No page computes carbon any more — the last client copy
  (`lib/badger/intercept.ts`, 436 lines) was deleted this pass. See *Page shapes* and the
  "system of record" decision.
- **Basemap:** CARTO dark raster tiles, key read from `VITE_CARTO_BASEMAP_KEY` (never committed;
  degrades to an unkeyed watermarked basemap without it). Google Maps is **not** wired — it needs a
  domain-restricted key created in Settings, and a JS-API migration away from react-leaflet.
- **Page density:** every page cut to max 3 "things" (see *Page shapes* below). Cut content was
  folded into captions, `note` slots and `title` hovers rather than deleted, so no claim was lost.
- **Verification:** every fetch/evaluate the UI sends was replayed server-side via `runJsCode` and returns rows (counts below).

## Packages

- `pkgf994ca4b` (main) — the Badger Footprint package.

## Backend types (`src/`)

| Type | Role | Rows | Data source |
| --- | --- | --- | --- |
| `EmissionFactor` | EPA kg CO₂e/$ per NAICS-6 commodity | 1016 | **REAL** — EPA Supply Chain GHG EF v1.3 |
| `ProductCategory` | classifies vendors → one EmissionFactor | 13 | CURATED |
| `Vendor` | supplier → one ProductCategory | 20 | CURATED |
| `Building` | campus building + approx lat/lon | 10 | FABRICATED (real names) |
| `Department` | dept → building | 16 | FABRICATED |
| `SpendTransaction` | one purchase (NOT `Transaction` — reserved platform name!) | 1049 | FABRICATED |
| `Contract` | UW purchasing contract → vendor | 16 | FABRICATED |
| `ProductFootprint` | per-product mfr carbon lookup | 7 | FABRICATED (Dell figure real) |
| `CarbonBudget` | per-dept per-FY carbon + $ target | 48 | FABRICATED (FY2024/2030/2040 only) |
| `InventoryItem` | department stockroom surplus — powers reuse matching | 20 | FABRICATED |
| `PurchaseRequest` | a request still awaiting approval — the intercept queue | 13 | FABRICATED |
| `ReductionLever` | one abatement action: ceiling %, $/tonne, effort | 35 | FABRICATED |
| `SustainabilityGoal` | published target: 2030 = 20%, 2040 = 45%, 2048 = 95% | 3 | REAL targets, FABRICATED baseline |
| `ReductionPlan` | a saved planner what-if (pins + solved allocation) | 0 | written by `PlannerAgent.savePlan` |

Carbon math: `tonnes CO₂e = amount * productCategory.emissionFactor.kgCo2ePerDollar / 1000`.

**Dataset shape:** $25.57M over FY2019–FY2025 (1,049 txns). FY2024 baseline = **1,414 tCO₂e**.
Top carbon: Industrial & Lab Gases (407 t), Lab Supplies & Reagents (291 t), Plastics & Labware (237 t).

## Agent layer (`src/`, library types — JS implementations)

Four deterministic non-entity types, one per agent, plus `BadgerCopilot` over them. **All 14 agent
methods smoke-tested via `runJsCode`.** Each returns plain `json` ready to render — no client-side
math required.

| Type | Agent | Methods |
| --- | --- | --- |
| `BadgerAnalytics` | 1 — insight | `campusSummary(fy)`, `emissionsBy(dimension, fy)`, `emissionsTrend(dimension, topN)`, `hotspots(fy, limit)`, `buildingMap(fy)` |
| `InterceptAgent` | 2 — purchase intercept | `queue(status, limit)`, `evaluate(requestId)`, `decide(requestId, action, reason)`, `interceptStats(fy)` |
| `PlannerAgent` | 3 — what-if planner | `baseline(fy)`, `solve(spec)`, `savePlan(spec)` |
| `ForecastAgent` | 4 — ML projection | `buildingForecast(buildingId, horizonMonths)`, `allBuildingForecasts(horizonMonths)` |
| `BadgerCopilot` | the agentic layer *over* 1–4 | `ask(spec)`, `confirmAction(action)`, `toolManifest()` |

`emissionsBy` dimensions: `category`, `department`, `building`, `college`, `vendor` (unknown → throws).

**Units contract — the one thing to get right at the boundary.** `SustainabilityGoal.reductionPct`
and `ReductionLever.maxReductionPct` are stored as **fractions (0–1)**, but every agent method
**emits and accepts percentages (0–100)**. Callers never deal in fractions. Tonnes are rounded to
1 dp except in `InterceptAgent` (3 dp — a single purchase is small enough that 1 dp erases it).

### Agent 2 — the intervention ladder

`evaluate` returns each rung as a self-contained option (avoided tonnes + dollars, units covered,
named counterparty, a ready-to-send sentence) **plus a stacked `recommendation`**: reuse covers
what it can, substitution takes the remainder, consolidation covers whatever still ships, and the
residual carbon of the order that survives is reported honestly.

- **Reuse** proximity ladder: `same_building` → `same_department` → `nearby` (<400 m great-circle
  on `Building.latitude`/`longitude`) → `campus`. **All four rungs fire on the seeded queue**
  (5 / 1 / 2 / 3), plus 2 deliberate no-match rows.
- **Substitute** requires *evidence* it is cleaner: a circularity word in the `Contract` line, or a
  `ProductFootprint` showing strictly lower embodied carbon. Hero: `ct_dell_refurb` at 39 kg vs
  121 kg for new → 20 units = 1.64 tCO₂e + $12,000.
- **Consolidate**: other `Pending` requests, same building + same category.
- **Defer**: May/June only, and only when `quantity >= 2` (a single capital instrument is not
  "use it or lose it" over-ordering — advising deferral there would discredit the rest).
- Every estimate carries `method` ∈ `product_footprint` / `spend_based` / `estimated_logistics` /
  `year_end_excess_share` and the `basis` string it came from. Nothing in the UI is unattributable.
- `decide` records the human choice and **keeps a refusal as signal** (`barrierSignal` with the
  forgone tonnes) — the intercept suggests, never blocks.
- **`reuseGap`** (on `evaluate`, null when reuse found something): one sentence saying *why* rung 1
  is empty, derived from the `InventoryItem` rows actually searched — nothing declared surplus in
  the category / everything declared already committed / a near-miss on the name with the closest
  holder named. Replaced a hardcoded `REUSE_EXCLUSIONS` table in the browser. Verified: `pr_0011`
  → near-miss naming Biochemistry's pipette tips; `pr_0012` → "no department has declared any
  surplus in Lab & Analytical Instruments"; `pr_0001` → null.
- **`reset` → `Pending`** is a sixth `decide` action and the only one that moves a request
  backwards. It exists because the other five are real writes: without it a mis-click is permanent
  and a demo queue worked end to end can never be worked again. It credits nothing and **appends**
  its stamp rather than erasing the decision it withdraws.
- **`interceptStats.realised`** separates the offer from the achievement: `avoidableTonnes` is what
  the queue is worth if every top recommendation were taken, `realised.tonnes` counts only requests
  whose status shows a suggestion was accepted. Re-derived from the current ladder, so it survives a
  page reload — which a total accumulated in browser state did not. Verified: `decide('pr_0001',
  'reuse')` → 9.393 t / $9,300 / 38.4% of avoidable, counterparty "Department of Biochemistry";
  `reset` → back to all zeros. `goal.interceptSharePct` stays 8.7 throughout (it measures the
  offer, not the achievement).

**Seeded queue result:** 13 requests, $78,280, 30.294 tCO₂e → **24.464 t (80.8%) and $48,958
avoidable**, 12 of 13 with an opportunity. Biggest single win is pipette tips at **9.393 t** — vs
the 24-laptop refresh at 1.969 t. That ordering is the whole argument; see the hero-examples
decision below.

### Agent 3 — the deterministic solver

`solve(spec)` takes `{targetYear, pins: {categoryId: pct0to100}, strategy, fiscalYear}`.
Strategies: `equal_pct` (weighted water-filling), `cheapest_first` (true MACC at **lever**
granularity), `effort_balanced` (Low 1.0 / Medium 0.6 / High 0.3). Pins above a ceiling are
**clamped and flagged** in `pinNotes`; unknown category ids are ignored with a note. Each category
comes back **decomposed into the specific levers composing its cut**, with an owner — so a slider
at 12% can answer "which 12%?". `savePlan` **re-solves from the spec** before writing, so a stored
`ReductionPlan` can never disagree with the solver.

**`ReductionLever.horizonYear` is what makes both goals solvable honestly.** A plan for year Y may
only use levers with `horizonYear <= Y`. Near-term procurement levers give **345.1 t (24.4%)**;
structural 2040 levers (helium recapture, supplier decarbonisation, green-chemistry redesign) add
**373.8 t** for **718.9 t (50.8%)** total. Hence: 2030 (20% = 282.8 t) is comfortable, 2040 (45% =
636.3 t) is reachable *only* with structural action, 2048 (95%) is infeasible by 44 points.

Verified pin walks (FY2024 baseline 1,414.1 t): 2030 unpinned → feasible, 62 t slack · lab supplies
pinned @5% → still feasible · **+ industrial gas @5% → infeasible, 36.7 t short** · 2040 unpinned →
feasible, 83 t slack · **industrial gas pinned @20% → infeasible, 80.3 t short**. Infeasibility
returns `maxAchievableTonnes` plus ranked remedies ("release the pin on X to recover up to N t").

### Agent 4 — the only thing that extrapolates

`ForecastAgent` fits a **13-parameter OLS regression per building**, in Rhino, by hand:
`tonnes(t) = b0 + b1*t + sum(bm * 1[month=m] for m in Feb..Dec) + e`. **January is the omitted
reference level.** Normal equations `(X'X)b = X'y` solved by Gauss-Jordan with partial pivoting;
a singular design matrix (a building that never bought anything in some calendar month) **degrades
to a trend-only fit** rather than returning nonsense, and under 6 observations returns
`fittable: false`. Reports `rSquared`, `residualSigmaTonnes`, `degreesOfFreedom` and a 95%
prediction interval (`± 1.96σ`, lower bound clamped at 0).

**Smoke-tested:** 10/10 buildings fittable, 84 monthly observations each, ledger through 2025-06.
Campus fitted trailing-12 1362.9 t → projected next-12 **1399.9 t (+2.7%)**. R² runs **0.12–0.39**.
**The model independently recovered the fiscal-year-end spike** — peak month is May or June in all
ten buildings, which is the one seasonal fact a procurement office can act on.

**Three traps found and fixed during the smoke test** (all were my own bugs, all would have shipped
discreditable numbers):

1. **Headline change was comparing *actual* trailing-12 against *fitted* next-12.** At R²≈0.2 the
   fitted line sits near the long-run mean, so this measured mean reversion, not trend — Engineering
   Hall read **"+209.6%"**, i.e. "about to triple". Now both sides come off the regression line
   (`fittedTrailing12MonthsTonnes` → `next12MonthsTonnes`, Engineering Hall **+2.1%**). The measured
   figure survives as `actualTrailing12MonthsTonnes`, and the gap as `modelVsActualPct` — the
   plainest available statement of fit quality.
2. **`direction` contradicted `changePct` in sign** (Chemistry: `rising` beside `-17.5%`), because
   the two used different baselines and an absolute ±0.5 t/yr threshold. `direction` is now
   `changePct`'s own ratio thresholded at ±1%, so **the two can never disagree** — asserted by a
   smoke test that scans all ten rows for sign conflicts.
3. **`tonnesPerYear: 2.8` sat beside a +33 t annual change** and looked like a third contradiction.
   Both were right — `b1*12` is how much *one month* gains per year; a *twelve-month total* gains
   12× that — so only the second is emitted, as `annualTotalDeltaTonnes`.

**Nothing from this type is ever summed into a reported total**, which is what keeps the Method
page's "no model computes any measured number" claim true. Every response carries `method` and
`disclaimer` strings so a caller cannot render a projection as a measurement.

> **There is no `van_hise` building.** Seeded ids: `biochemistry`, `chamberlin_hall`,
> `chemistry_building`, `computer_sciences`, `engineering_hall`, `grainger_hall`,
> `medical_sciences`, `microbial_sciences`, `van_vleck`, `wid`. Use `chemistry_building`
> (largest, 303.4 t projected) as the demo hover example.

## The agentic layer — `BadgerCopilot`

**What makes it an agent and not a lambda:** Agents 1–3 each execute a control flow a human wrote
in advance. `BadgerCopilot` **composes** that control flow at runtime — a question arrives in
English and the model decides which methods to call, in what order, and how to feed one's output
into the next. Proven live: *"which building emits the most, and is there spare stock there?"*
chains `analytics_emissionsBy` → `intercept_queue` → `intercept_evaluate`, **a route nobody coded
as a report.** That chain is the single best demo moment in the app.

**Why tool calling and not RAG.** No document contains "the 2030 shortfall if IT hardware is capped
at 4%", so a retrieval system has nothing to find and would invent the figure. A tool call computes
it. RAG would only ever be appropriate on the Methodology page (static prose), and even there the
manifest table is the stronger artifact.

**The grounding rule, absolute:** every number reaching the user originates from a tool result. The
model routes and narrates; it never does arithmetic. `ask` returns every executed call in
`toolCalls` (name, args, elapsed ms, summary) so the UI renders provenance beside the answer, and
`grounded: false` whenever the model answered without calling anything — which the UI labels
*unverified*.

**Measured and projected are kept apart.** 12 of the 14 tools are read-only, and **10 of those 12
return measured arithmetic over purchase orders that exist.** The 2 `forecast_*` tools
(`forecast_allBuildingForecasts`, `forecast_buildingForecast`) wrap `ForecastAgent` and are a
different epistemic category — a regression over months with no transactions. Their descriptions
open with "PROJECTED, NOT MEASURED", the system prompt carries a `## Measured versus projected`
block requiring a confidence band on every quoted projection and forbidding adding one to a
measured total, and `summarise()` prefixes their provenance strip with `PROJECTED`. Tool names
match the real method names because the manifest table composes the backing call as
`{backs}.{name after the first underscore}()` — rename a tool and the Method page starts lying.
`forecast_allBuildingForecasts` carries `buildingId` in its compacted rows because nothing else in
the manifest exposes one, so a follow-up `forecast_buildingForecast` has a valid id to use.

**Reads run automatically; writes are confirm-gated.** The 12 read tools execute unattended. The 2
writes (`intercept_decide`, `planner_savePlan`) are **declared to the model but never executed by
`ask`** — the intended call comes back as `pendingAction` for a human to approve via
`confirmAction`, which **re-validates** rather than trusts (unknown name, read-only tool, missing
required arg, and `decide.action` against its 5-value enum all rejected). This enforces the
intercept's own "suggests, never blocks" contract in code rather than asserting it in a paragraph.

### ⚠️ Verified `GenaiCore.Llm.Completion.Client` API contract — four traps, all hit the hard way

Established by experiment. **Do not "fix" these back.**

1. **Call `completion(messages, options)` POSITIONALLY.** The single named-arg object
   `completion({messages, options})` **silently drops `options`** — which then surfaces as the
   confusing runtime-gate error below, even when `returnJson` *is* set.
2. **`options.returnJson: true` is MANDATORY.** Without it: *"can only be called natively from
   [py-bedrock_litellm_312] … please set `options['returnJson']` true"*.
3. **Never pass `temperature`.** `global.anthropic.claude-sonnet-5` rejects it outright
   (`litellm.UnsupportedParamsError … does not support temperature=0.0`).
4. **`tool_calls` arrives as an object keyed by stringified index** (`{"0": {...}}`), not a JSON
   array. Everything crossing this boundary goes through a `toArray()` normalizer — server-side in
   `BadgerCopilot.js` and again client-side in `api/copilot.ts`. `toolManifest().tools[].params`
   and each param's `enumValues` are the same shape.

### Prompt construction — why the category ids are injected live

The model **hallucinated both the id and the units**, emitting `{"IT_hardware": 0.04}` where the
truth is `{"it_hardware": 4}`. Fixed by injecting live category ids, labels, baselines and ceilings
into the system prompt from `PlannerAgent.baseline(2024)`, restating the 0–100 rule in *both* the
system prompt and the `pins` schema description ("as a number from 0 to 100 where 4 means four
percent"), and flagging — never silently correcting — values where `0 < v <= 1` as
`suspectFractions`. **Verified fixed.** Never hardcode the id list; a model asked to guess an
identifier invents one, and the call then fails or silently matches nothing.

### One solver, two renderings (the old two-solver note is obsolete)

`ask` calls `PlannerAgent.solve` for narration **and** emits `uiAction.planner.applyPins`. The
Planner page then moves its sliders, which re-solves **the same backend method** — there is no
client solver any more (`lib/badger/planner.ts` keeps `buildPlanInputs` for slider *inputs*,
`adaptSolve` to reshape the agent's response, and `glidePath`; it computes no allocation). So the
narration and the controls are the same computation run twice, not two implementations that agree
by luck. The pins in `uiAction` are read off **the args the solver was actually invoked with**,
never restated by the model, so prose and sliders cannot drift.

**Two impedance mismatches remain, converted in exactly one place each**
(`Planner.tsx#copilotScenario` outbound, `#applyCopilotAction` inbound):

| | Planner page vocabulary | Backend agents |
| --- | --- | --- |
| Strategy ids | `'equal'` / `'cheapest'` / `'effort'` | `"equal_pct"` / `"cheapest_first"` / `"effort_balanced"` |
| Percentages | fractions **0–1** | doubles **0–100** |

`toStrategy()` in `Planner.tsx` accepts **either** vocabulary and falls back rather than throwing,
because the copilot already translates on the way out and a defensive second pass is cheaper than
a crash on a third spelling.

### REST transport — why `ask` takes one `json` spec

`c3Action` **prepends the type name** to the argument array (`["BadgerCopilot", …]`), which would
shift positional parameters by one. So `ask(spec: json)` takes a **single object** — the same
one-argument shape `fetch`/`evaluate` already use successfully throughout `api/badger.ts` — making
the wire shape unambiguous. `toolManifest()` is called with `[]` (→ `["BadgerCopilot"]`, a
well-formed zero-arg envelope) rather than no third argument at all.

### Smoke tests — all passing

Manifest (**12 read / 2 write / 14 tools**, both `forecast_*` correctly mapped to `ForecastAgent`
by `backingType()`) · hero what-if (correct id, correct units, grounded,
`uiAction` emitted) · **multi-turn** ("now *also* cap plastics at 10%" correctly carried
`it_hardware: 4` forward from on-screen scenario state and added `plastics: 10`) · infeasibility
narrated honestly ("short by 37.3 tCO2e for 2040") · **cross-agent chain** (3 methods) · write gate
(`pendingAction` returned, `pr_0001` verified still `Pending` with justification unchanged) · all 4
`confirmAction` validation guards reject correctly.

> **Agentix was abandoned deliberately, and not because of the missing `appId`.**
> `Microservice.Config.forName('Nexus')` returns a URL but no appId, and the studio-scoped config is
> absent — but the decisive reason is architectural: an Agentix-hosted agent lives in its own chat
> surface and **could never call `setPinned` inside the Planner page**. The hero interaction is
> chat-moves-the-sliders, so the agent has to be ours.

## UI pages / routes

Nav order **is** the argument: past → present → future. Do not reorder (`config/navigation.ts`).

| Route | Page | Job |
| --- | --- | --- |
| `/` | `pages/Overview` | **Footprint.** Where the carbon is. 3 tiles, ranked category bars, spend-vs-carbon scatter (decoupling). The FY trend moved to the map/planner and the June FY-end spike to the Intercept, where it motivates the "defer" lever instead of being a fact with nowhere to go. |
| `/map` | `pages/CampusMap` | **Campus map.** Same footprint on the ground, two views behind a toggle: **3D columns (default)** — `Campus3D.tsx`, MapLibre GL (`maplibre-gl` dep, lazy-loaded) over OpenFreeMap vector tiles (keyless, OSM), one extruded column per building with height **and** colour ∝ tonnes, OSM building footprints extruded in grey underneath, hover popup; auto-falls back to 2D with a note if the style can't load. **2D** — react-leaflet over **Esri** basemaps (satellite + labels default; streets/topo in the layer switcher; keyless, no CARTO). Hover card trimmed to tonnes · campus share · dominant category (+ its campus-wide reach) · dept count · 12-month range + direction; `CampusMap.css` overrides Leaflet's `white-space: nowrap` so it wraps. Below: **"What each building buys"** — a 3-group stacked bar per building (`BuildingStackedBars`) over per-building ranked breakdowns (`BuildingBreakdowns`). Replaced the 10×13 heatmap (>50% empty cells). |
| `/intercept` | `pages/Intercept` | **Intercept (THE HERO).** Pending requests scored at decision time by `InterceptAgent`; lever ladder reuse → substitute → consolidate → defer, with the stacked plan above the alternatives. Suggest, never block. **The app's only write** (`decide`), so the page refetches after every decision instead of patching local state, keeps decided rows listed with their new status, and offers `reset` as the only honest undo. |
| `/planner` | `pages/Planner` | **Planner.** Deterministic goal-seeking: copilot → sliders, pin-and-redistribute, strategy toggle, feasibility banner, glide path. (The MACC curve was cut — `cheapest_first` *is* the MACC, applied rather than drawn.) |
| `/methodology` | `pages/Methodology` | **Method & FAQ.** Factor table w/ provenance, worked example, real vs modelled vs assumed, scope boundary, 4 named weaknesses, **the 21-entry FAQ/glossary** (the link target for every `<Term>` in the app, deep-linked by hash), and the tool manifest. |

Shared: `components/badger/` — `PageShell`, `Section`, `Panel`, `StatTile`, `LeverSlider`,
`MatrixGrid` (no longer mounted — superseded on the map page by
**`BuildingComposition.tsx`**, whose `GROUPS` folds the 13 categories into the 3 validated
categorical slots *by lever type*: lab consumables & gases / equipment & furnishings / operations
& admin; the grouping is the colour and the colour hints the remedy), `Charts.tsx`,
**`CopilotPanel.tsx`** (the inline chat surface), **`CopilotTurn.tsx`** (the shared turn/provenance
renderer), **`BuckyDock.tsx`** (the floating popup), **`CopilotManifest.tsx`** (the manifest table),
**`Term.tsx`** + **`FaqList.tsx`** (the glossary surfaces).
Data: `contexts/BadgerDataProvider` fetches once above the router, with
**`contexts/BuckyProvider`** nested inside it holding the one chat transcript; `api/badger.ts`
holds every deterministic call; **`api/copilot.ts`** holds the three copilot calls.

**All five pages now read their figures from the agents** (`BadgerAnalytics`, `ForecastAgent`,
`InterceptAgent`, `PlannerAgent`). What is left in `lib/badger/` is formatting and two time-axis
rollups, *not* a second carbon implementation:

| File | What remains | Why it is still client-side |
| --- | --- | --- |
| `carbon.ts` | `yearTotals`, `monthTotalsFiscalOrder`, `emissionsCagr`, `factorMap`, `nameMap` | the FY/month axes the Overview charts plot; candidates for `BadgerAnalytics.emissionsTrend` next |
| `planner.ts` | `buildPlanInputs` | shapes slider *inputs* (ceilings, names); solves nothing |
| `format.ts`, `palette.ts` | formatters + validated palette | presentation |
| ~~`intercept.ts`~~ | **deleted (436 lines)** | was a full second ladder — and it disagreed (it never stacked the rungs) |

The EPA factor map is **no longer exposed** on `BadgerData`: a page holding the factors could only
use them to compute a second, disagreeing answer. It is still built privately for the two rollups.

### Page shapes — max 3 things per page

Each page states **one claim** and carries at most three things that support it. Bucky is not
counted as a "thing" (it floats over every page). Nothing was deleted to get here — displaced
sentences moved into `StatTile` captions, `Panel` `note` slots, `title=` hovers and, as of the
terseness pass, the FAQ, so every provenance claim is still reachable, just not competing for
attention.

| Page | Thing 1 | Thing 2 | Thing 3 |
| --- | --- | --- | --- |
| Overview | 3 tiles (carbon, addressable spend, intensity) | "Dollars are a bad proxy for carbon" — ranked bars beside the spend-vs-carbon scatter | *(the scatter is the second half of one argument, so this page runs on two)* |
| Campus map | the leaflet map, with the **rich hover card** per building | buildings × categories matrix | — |
| Intercept | 3 tiles (in the queue / avoided so far / share of the 2030 gap) | the queue list | the lever ladder for the selected request |
| Planner | "Set the scenario" (target + burden share) | "Pull the levers" | "Where this scenario lands" (gap meter + glide path) |
| Method & FAQ | "The calculation" (formula + where the arithmetic happens) | the factor table in full | "Real, modelled, assumed" + the FAQ + the tool manifest |

**The campus-map hover card is the densest surface in the app, on purpose.** Hovering a building
gives measured FY2024 carbon, spend, intensity, share of campus, department count, dominant
category — then the `ForecastAgent` projection: direction, 12-month change, R² band, confidence
band, peak month. Density is fine *on demand*; it is only bad as the resting state of a page.
Note the seeded building ids are `biochemistry`, `chamberlin_hall`, `chemistry_building`,
`computer_sciences`, `engineering_hall`, `grainger_hall`, `medical_sciences`, `microbial_sciences`,
`van_vleck`, `wid` — **there is no `van_hise`** (it is administration, not a purchasing hotspot);
`chemistry_building` is the demo hover.

### Bucky — one agent, one transcript, a floating dock

**Copilot placement — one agent with the full manifest, given page context.** Not five siloed
per-page bots: siloing would structurally prevent the cross-agent chain that is the best demo
moment. `page` only *biases* tool choice and decides whether a `uiAction` applies.

A chat you have to navigate to find is a panel, not an assistant — so the conversation was hoisted
**above the router** and the surface became a draggable popup reachable from every route.

| File | Role |
| --- | --- |
| `contexts/BuckyProvider.tsx` | The single transcript, mounted inside `BadgerDataProvider` and **above `<Routes>`**. Owns `turns`, `busy`, `open`, `send`, `openAndAsk`, `clear`; derives `page` from `useLocation()`; holds per-page `SUGGESTIONS`. |
| `components/badger/BuckyDock.tsx` | The FAB + popup. Drag/click disambiguated by a 5 px threshold with `setPointerCapture`; position persisted to `localStorage` as `{right, bottom}` offsets so a window resize can never strand the button; the panel is clamped into the viewport independently of the FAB. Escape closes; a pulsing dot marks work in flight while closed. |
| `components/badger/CopilotTurn.tsx` | `Provenance`, `PendingAction`, `TurnBubble` — extracted so the dock and the inline panel render **identical** provenance. Two renderers would let one of them quietly emit a bare paragraph. |
| `components/badger/CopilotPanel.tsx` | Now a thin consumer of the provider. **Public props deliberately unchanged** so `Planner.tsx` and the other agent's `CampusMap.tsx` compile untouched. |

**The page→dock binding is a ref, not state.** `useBuckyBinding({scenario, onUiAction,
onWriteCommitted})` writes one mutable slot *during render* and clears it on unmount. A
`useEffect` registration loops forever on the identity of a freshly-closured `onUiAction`, and
passing the closure down as a prop re-renders the provider subtree on every keystroke. Reading the
handler at **resolution** time also makes "navigate away mid-request" correct for free — the
`uiAction` is simply dropped.

| Page | Surface | Why |
| --- | --- | --- |
| Overview | dock only | inline section deleted; the cross-agent chain still lands here, just in the popup |
| Campus map | dock + the other agent's own inline panel | that file belongs to another agent — left untouched, the two coexist |
| Intercept | dock + `useBuckyBinding({scenario, onWriteCommitted})` | **the only page that can propose a write**, so the confirm gate earns its keep; the binding is what refetches the queue after a confirmed `intercept_decide` |
| Planner | dock **+ a deliberate inline panel** with `onUiAction` → **moves the sliders** | the hero moment is the *causality*: a sentence, then the sliders below physically move. Behind a popup that has to be narrated rather than watched. |
| Methodology | dock + manifest table, no inline chat | a page for auditing our working should not answer in generated prose |

`applyCopilotAction` surfaces the two honest failure modes rather than swallowing them:
`suspectFractions` (possible units slip) and a `targetYear` with no matching published milestone.

**Every page remains fully usable with Bucky untouched** (stage safety) — the panels are
independent of it, and a failure renders an error inside the dock rather than taking the page down.

### Terseness, and where the prose went

The pages were too text-dense to read on stage. Explanations were **moved, not deleted**:

| File | Role |
| --- | --- |
| `lib/badger/glossary.ts` | 21 `GlossaryEntry` rows — `{id, term, gloss, question, answer[], askable?}`. **Hard rule: no figures anywhere in this file.** A number typed here is a second source of truth that goes stale; entries say what a figure *means*, the panels compute what it *is*. `askable` entries offer to hand the question to Bucky instead. |
| `components/badger/Term.tsx` | `<Term id="scope-3">Scope 3</Term>` → a real `<Link to="/methodology#scope-3">` with the gloss as `title`. A real link (shareable, tab-openable, keyboard-reachable), not a popover. An **unknown id degrades to plain text** so a typo cannot blank a page heading. |
| `components/badger/FaqList.tsx` | A **lookup, not an essay**: collapsed by default, text filter across term/question/gloss/answers, and the entry named by the hash auto-opens and scrolls into view. Reads **`useLocation().hash`** (react-router), never `window.location.hash` — the app is a HashRouter, so the real URL is `#/methodology#spend-based` and only react-router gives you the inner fragment. `openIds` is a `Set` that accumulates, so following a second `Term` link from inside the FAQ opens that one too without closing the first. |

**The FAQ renders even when the backend is down**, and that is deliberate. `Methodology.tsx`
defines the FAQ as a local `FaqSection()` component and renders it in **all three** branches —
error, loading, and loaded — because the factor table genuinely needs the ledger but the glossary
reads no backend data at all. This page is the link target for *every* `<Term>` in the
application, so without that, one failed fetch would turn every explanatory link in the app into
a dead end showing a retry button. The error banner still shows honestly, with the definitions
readable underneath. (Found by browser-testing during the Okta outage, which is the only reason
the failure mode was visible at all.)

`PageShell`'s `standfirst` and `Section`'s `description` were widened from `string` to
`React.ReactNode` — that was the structural blocker for inline terms (`Panel.note` already was).

Nav label is **"Method & FAQ"**. The FAQ is deliberately **not** a sixth nav item: it is a
reference surface, not a step in the past→present→future argument, and a sixth entry would read as
"and then, finally, some definitions".

## Seed / data

- All under `data/<Type>/<Type>.json`. Regenerate via `.attachments/gen_data.py` (deterministic, seed=42). Re-run `upsertSeedData` after changes.
- EPA source CSV at `.attachments/epa/` (not in package).

## Key decisions

- **Fabrication strategy (Path B):** keep the two scrutinized numbers real (spend $ shape + EPA kg CO₂e/$); fabricate attribution/enrichment. Real OpenBook export swappable later with no model change.
- **`Transaction` is a reserved C3 platform type** — our spend record is `SpendTransaction`. Do not reintroduce `Transaction`.
- `EmissionFactor.kgCo2ePerDollar` = EPA **"with margins"** column (correct for spend-based, retail prices).
- **No LLM computes any number shown in the app.** All arithmetic is in `lib/badger/` and the
  agent types; both solvers are deterministic. **This claim survives the copilot** because the
  copilot only ever *routes* — it picks a method, passes args, and narrates the returned payload.
  The claim is printed on the Method page, so it must stay true: if anything is ever added that
  lets the model produce a figure directly, that sentence has to change first.
  - Consequently the Planner standfirst was rewritten. It used to end "…and no language model is
    anywhere near the numbers", which the chat panel made false as written. It now says the chat
    "only sets the sliders: the solver still computes every number on this page."
- **Infeasibility is a first-class output.** Lever ceilings cap the portfolio at **50.8%** of the
  FY2024 baseline (718.9 t), so 2040 (45%) is tight and **2048 (95%) is infeasible by 44.2 points**
  — the planner says so in red instead of inventing a path. This is the demo's strongest moment.
  - **The ceiling is horizon-aware, which the old client copy was not.** `ReductionLever.horizonYear`
    gates which levers can be counted, so by **2030 only 345.1 t (24.4%)** is available — the
    published 20% goal clears it with 4.4 points to spare, but **drag the target slider to 30% and
    2030 goes infeasible by 79.1 t.** Verified live at all three horizons. That is a *better* demo
    than the old flat 50.8%: the planner's answer now depends on *when* you ask.
- **Dragging a Planner slider pins that category** (no separate pin step); the pin button only unpins. A slider's max *is* its feasibility ceiling, so the UI cannot express an impossible per-category ask.
- **Dark is the default, not a preference** (`useTheme` initial state + `class="dark"` in `index.html` to kill the first-paint flash). Every colour was contrast-validated against `#171717`.
- **Campus map basemap is Esri, not CARTO — no API key, no extra package.** `CampusMap.tsx` uses
  public ArcGIS Online tile services via `react-leaflet`'s `LayersControl`: **Satellite** (World
  Imagery, default) with **Roads** + **Place names** reference overlays, plus **Topographic** and
  **Streets** base layers. Esri attribution is passed to Leaflet's attribution control (required
  by their terms). Markers use `palette.ts#MAP_RAMP` (warm yellow→red, `mapRampColor`, dark
  `MAP_STROKE`) because `SEQUENTIAL_BLUE` was tuned for the dark panels and vanishes on imagery;
  the matrix keeps the blue ramp. A legend overlay sits bottom-left (`z-[1001]`,
  `pointer-events-none`). The CARTO key, `VITE_CARTO_BASEMAP_KEY` typing and `TILE_URL` were
  removed per the user's instruction; `vite.config.mts#envDir` (workspace-root `.env`) remains
  and is harmless. **Do not reintroduce CARTO.**
- **Lever kinds are encoded by icon + word, never a 4th hue** — the dataviz palette allows ≤3 categorical slots, and status colours are reserved for feasible/infeasible.
- **Matrix is buildings × categories, not departments × categories** — the dept-level grid was too sparse to read (71 populated cells over 16 × 13).
- **Safety boundary:** opened chemicals and biologics are deliberately excluded from reuse (EHS/compliance). Stated in the UI, not hidden.
- **Hero examples are lab consumables/gases/plastics, never laptops** — IT hardware is the *lowest* EPA factor (0.058 kg/$) and a tiny carbon share, so a laptop example would undercut the whole argument.
- **The surplus-inventory feed does not exist** at UW today. The Method page names this as an assumed dependency rather than implying the integration is real.
- **Backend agents are the system of record for every number — and as of this pass, the only
  implementation.** Every page is wired to `c3Action`; the matching TS math was deleted rather than
  left as a second source of truth. The "no LLM computes any number" claim on the Method page stays
  true — the agent methods are plain deterministic JS, and an LLM's only job is to translate a
  sentence into a `solve()` spec and narrate the result it gets back.
  - **Two client copies had already drifted when they were deleted, which is the argument for doing
    it.** `lib/badger/intercept.ts` never *stacked* the ladder, so a request the agent fully covers
    (claim surplus, merge the remainder) read as only partly avoidable in the browser. And the
    Planner's client ceiling ignored `ReductionLever.horizonYear`. Numbers on both pages changed —
    because they were wrong before. If a figure in a screenshot disagrees with the app, the app is
    now right.
- **A category's intensity can never differ from its category average** (one EPA factor per
  category), so `hotspots` compares a cell against **the department's own blended intensity** and
  reports `carbonVsSpendLeverage` = carbon share ÷ spend share. That ratio does vary and it is the
  sharpest line in the app: Physics industrial gas is **16% of its spend but 72% of its carbon
  (4.5×)**.
- **Rhino gotchas** (backend JS): no `let`/`const`/arrows/template literals; C3 fetch collections
  are not JS arrays (copy via a `_toArr` helper before `.sort()`); avoid `Object.keys`; `DateTime`
  has no `.month()` (use `String(dt).substring(5,7)`); `merge()` and `get()` are **member**
  actions — `Type.make({...}).merge()`, not `Type.merge({...})`; lookup tables keyed by arbitrary
  strings are `'#'`-prefixed so a product called "constructor" cannot hit `Object.prototype`.
- **React is 18.3.1, NOT 19.** Function components do **not** accept `ref` as a prop, and the
  design-system `Input`/`Textarea` are plain function components with no `forwardRef` — TypeScript
  accepts `ref={...}` via `ComponentProps<"textarea">` and then React leaves it `null` at runtime.
  Focus by id instead (`document.getElementById(...)` + an `instanceof` guard), as `BuckyDock` does.
- **`vite-plugin-eslint2` runs with `lintOnStart: true`, so a lint error can abort Vite startup**
  and blank the preview. That — not a config edit — was the cause of the earlier outage.
  **`vite.config.mts` must not be modified.**
- **After editing a `.c3typ` or an implementation, `clearCaches(workspaceId)` before re-testing.**
  The app service caches compiled types and implementations; stale caches produce both phantom
  "Type X does not declare field Y" errors and — worse — silently *old* method behaviour that
  looks like a logic bug. Workspace id `69e8d6af-3982-484e-b0db-e4db74fbe3cd`.
- `upsertSeedData()` takes **no arguments** (a `pkg` kwarg is rejected).

## Standalone prep dataset (`/usr/workspace/dataset/`)

A **source-of-truth CSV/Excel dataset** built from user-provided real files, separate from the
seeded C3 `data/` above (prep/analysis layer). Files: `naics_emission_factors.csv`, `products.csv`,
`uw_departments.csv`, `vendors.csv`, `transactions.csv`, `department_inventory.csv`, plus
`DATA_SOURCES.md` (data dictionary) and bundles `UW_BuyBetter_dataset.xlsx` + `.zip`.

Every value tagged **REAL vs REPRESENTATIVE**:

- **REAL:** EPA USEEIO v1.3 factors (12 industries, combined from the by-gas file via AR5 GWP-100:
  CO2=1, CH4=28, N2O=265 + the dataset's F-gas CO2e row); **Apple product carbon footprints**
  (15 devices, cradle-to-grave, Apple Environmental Progress Report 2026); UW building lat/lng;
  UW totals (22,560 staff FTE, 2025 Data Digest).
- **REPRESENTATIVE:** product prices, department budgets/FTE, vendor list, transactions
  (OpenBook schema), inventory.

**Key finding (from the real data):** price→carbon elasticity for **laptops β = 0.76 (R² = 0.97)**
→ 10× price = 5.75× carbon, so spend-based **over-counts premium laptops ~74%**. Elasticity is
**category-specific**: across all Macs incl. the $6,999 Mac Pro (1,572 kg) β = 1.17 — "buy better"
holds for laptops, not workstations. EPA factors span ~20× (computers 0.057 vs chemicals 1.0–1.18).

> Note: this dataset uses real **Apple** PCFs (β fit) — richer than the seeded `ProductFootprint`
> (7 rows, only Dell real). Reconcile the two product sources when wiring the quality-adjusted footprint.

## Known gaps / next

- `api/badger.ts#fetchBudgets` is an unused export; `CarbonBudget` rows exist for FY2024/2030/2040 only (`targetTonnesCo2e` is null), so no page reads them yet.
- ~~The three agent types are built and verified but the UI still calls `lib/badger/` instead.~~
  **Done — all five pages are agent-backed.** Remaining client rollups are the FY/month axes in
  `carbon.ts` (`yearTotals`, `monthTotalsFiscalOrder`, `emissionsCagr`); `BadgerAnalytics` could
  absorb them next, but they re-shape an axis rather than re-derive carbon, so they are not a
  second source of truth.
- ~~No natural-language front door yet.~~ **Done** — `BadgerCopilot` + `CopilotPanel`. "We can
  only cut laptops by 4%" now becomes a real `solve()` call *and* moves the sliders.
- ~~`ForecastAgent` is unreachable from chat.~~ **Done** — two `forecast_*` tools, labelled
  PROJECTED and governed by a dedicated system-prompt block.
- ~~The UI is too text-dense.~~ **Done** — FAQ/glossary + `<Term>` links; the inline copilot
  sections on Overview and Intercept were deleted in favour of the global dock.
- **`CampusMap.tsx` is owned by another agent and was left untouched** on purpose. Its inline
  `CopilotPanel` coexists with the dock (same transcript, so it is one conversation). When that
  agent is done, the inline panel there can be dropped the same way Overview's and Intercept's
  were — and `Term` links can be added to its prose.
- ~~The dock has not been clicked in a real browser yet.~~ **Done — the whole chrome is browser-
  verified** (Playwright, viewport 1280×720). What was confirmed, and the measured evidence:
  | Behaviour | Evidence |
  | --- | --- |
  | FAB renders globally | a `button[aria-label="Ask Bucky"]` sibling of the app shell, present on every route |
  | Drag moves it | 200 px left / 160 px up ⇒ `right: 20→220`, `bottom: 20→180` — the bottom-right-origin negation is right |
  | Drag ≠ click | after a drag the panel stayed shut; the 5 px `DRAG_THRESHOLD_PX` classifies correctly |
  | Position persists | `localStorage['badger.bucky.launcher'] = {"right":220,"bottom":180}`, survives a reload |
  | Click still toggles | a zero-movement click opens the panel |
  | Panel clamps on-screen | FAB at `bottom:180` ⇒ panel would land at `y:-76`; `panelPos` clamped it to `y:12` (`EDGE_PAD`) |
  | Escape closes | from inside the textarea |
  | Autofocus works | the textarea reports `[active]` on open — the `getElementById` workaround for React 18's null ref holds |
  | One transcript, page-aware | **the decisive test:** with the dock open, navigating `/`→`/planner` kept it open *and* kept an in-progress draft verbatim (so it is not remounted), while the badge flipped `overview`→`planner` and the suggestions swapped to the planner's three |
  | `Term`→FAQ deep-link | `#/methodology#spend-based` auto-opened **exactly one** entry, rendered 849 chars of answer, and scrolled it into view |
  | HashRouter safety | the app is a **HashRouter**, so a `Term` link is `#/methodology#spend-based` — a nested hash. It works because `FaqList` reads react-router's `useLocation().hash` (the inner hash), **not** `window.location.hash`. Do not "simplify" that to `window.location.hash` — it would read `#/methodology#spend-based` whole and match nothing. |

  Still unverified in a browser: **an actual answered question**, because `BadgerCopilot.ask` needs
  the backend (Okta gap below). The send path is verified only by `runJsCode`.
- **Browser-based verification is currently unavailable.** Every API call in the Playwright session
  returns **302 → `c3energy.okta.com/oauth2/v1/authorize` → `net::ERR_FAILED`**, including the
  app's own pre-existing `fetch` calls; `document.cookie` is empty in that context. This is an
  environmental auth gap in the Playwright session, uniform across all endpoints — **not** an app
  bug. Verify server-side via `runJsCode` instead, as everything above was.
- `InterceptAgent.decide` mutates `PurchaseRequest.status`, so a demo run leaves the queue dirty.
  **Reset from the UI now**: a decided request keeps a "Return to the queue" button
  (`decide(id, 'reset', …)`), so no console step is needed before presenting. `reset` deliberately
  **appends** its stamp rather than erasing the withdrawn decision, so `justification` accumulates a
  `[Status] reason` trail across a demo; `upsertSeedData()` is the bulk reset that also restores the
  original justification text. Current state: **13 Pending, 0 saved plans.**
- `index.js` is 975 kB (leaflet + recharts). Fine for the demo; code-split if it ever matters.
- **Google Maps instead of / alongside CARTO is still open.** It would mean a Maps JavaScript API
  key restricted to the demo domain (created in Settings — never pasted into chat) and swapping
  react-leaflet for `@vis.gl/react-google-maps`, which rewrites the marker + hover-card layer that
  is currently the map's best feature. CARTO already gives a dark basemap that matches the theme,
  so this is a cosmetic upgrade with a real regression risk — do it last, if at all.
- **The intercept queue is 13 requests.** Wide enough to show all four rungs and two no-match rows,
  narrow enough that a reviewer can work it on stage. If a bigger queue is ever wanted, generate it
  in `.attachments/gen_data.py` — not in the browser.
