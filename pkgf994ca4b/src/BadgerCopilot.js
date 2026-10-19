/*
 * BadgerCopilot — a tool-calling loop over the three deterministic agents.
 *
 * Verified call contract for GenaiCore.Llm.Completion.Client in this environment, each point
 * established by experiment rather than assumption:
 *   - completion(messages, options) must be called POSITIONALLY. Passing a single
 *     {messages, options} object silently drops the options, which then surfaces as the
 *     confusing "can only be called natively from [py-bedrock_litellm_312]" error.
 *   - options.returnJson must be true. It is the runtime gate that lets a JS caller reach the
 *     model at all; it does not force the reply itself to be JSON, so narration comes back as
 *     ordinary prose.
 *   - temperature must NOT be set. claude-sonnet-5 rejects temperature=0 outright.
 *   - message.tool_calls comes back as an object with numeric string keys, not a true array,
 *     so it must be normalised before use (see toArray).
 */

var MODEL_KEY = 'default-completions';
var MAX_ITERS = 4; // tool rounds per question; a confused model degrades to prose, never loops
var MAX_HISTORY = 8; // prior turns replayed
var MAX_TOKENS = 1400;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** Normalise C3/litellm's object-with-numeric-keys into a real JS array. */
function toArray(v) {
  if (v === null || v === undefined) return [];
  if (Object.prototype.toString.call(v) === '[object Array]') return v;
  if (typeof v.length === 'number' && typeof v !== 'string') {
    var byLen = [];
    for (var i = 0; i < v.length; i++) byLen.push(v[i]);
    return byLen;
  }
  var out = [];
  for (var k in v) {
    if (Object.prototype.hasOwnProperty.call(v, k)) out.push(v[k]);
  }
  return out;
}

function num(v, dflt) {
  var n = parseFloat(v);
  return isNaN(n) ? dflt : n;
}

function int(v, dflt) {
  var n = parseInt(v, 10);
  return isNaN(n) ? dflt : n;
}

function str(v, dflt) {
  return v === null || v === undefined || v === '' ? dflt : '' + v;
}

/** Trim an array-ish to the first n entries, mapped through fn. */
function take(v, n, fn) {
  var arr = toArray(v);
  var out = [];
  for (var i = 0; i < arr.length && i < n; i++) out.push(fn ? fn(arr[i]) : arr[i]);
  return out;
}

/**
 * Convert a backend strategy id to the one the React planner uses. The two layers were named
 * independently and both names are load-bearing, so the mapping is explicit rather than inferred.
 */
function uiStrategy(backendStrategy) {
  var map = { equal_pct: 'equal', cheapest_first: 'cheapest', effort_balanced: 'effort' };
  return map[str(backendStrategy, 'equal_pct')] || 'equal';
}

/** Accept either naming from the model and return the backend's spelling. */
function backendStrategy(s) {
  var v = str(s, 'equal_pct');
  var map = {
    equal: 'equal_pct',
    cheapest: 'cheapest_first',
    effort: 'effort_balanced',
    equal_pct: 'equal_pct',
    cheapest_first: 'cheapest_first',
    effort_balanced: 'effort_balanced'
  };
  return map[v] || 'equal_pct';
}

/**
 * Coerce a pins map to the 0-100 contract. Values are passed through untouched — a pin of 0.5
 * really can mean half a percent — but anything at or below 1 is recorded in `suspectFractions`
 * so the caller can see that the model may have sent a fraction where a percent was asked for.
 */
function normalisePins(raw) {
  var pins = {};
  var suspect = [];
  if (!raw) return { pins: pins, suspect: suspect };
  for (var k in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    var v = num(raw[k], null);
    if (v === null) continue;
    pins[k] = v;
    if (v > 0 && v <= 1) suspect.push(k);
  }
  return { pins: pins, suspect: suspect };
}

// ---------------------------------------------------------------------------
// tool registry
//
// Each entry carries its JSON schema (what the model sees), an invoke (what actually runs) and a
// compact (what gets fed back). Compaction is not an optimisation detail: the raw returns include
// every lever behind every category and every building on campus, which would swamp the context
// window and bury the few figures the narration needs.
// ---------------------------------------------------------------------------

function buildTools() {
  return [
    {
      name: 'analytics_campusSummary',
      write: false,
      description:
        'Headline Scope 3 purchased-goods figures for one fiscal year: total tonnes CO2e and spend, carbon intensity, prior-year comparison, top categories, progress against every sustainability goal, and the fiscal-year-end spend spike. Use for "how are we doing" and "what is our total".',
      params: {
        type: 'object',
        properties: { fiscalYear: { type: 'integer', description: 'Fiscal year, e.g. 2024. Defaults to 2024.' } },
        required: []
      },
      invoke: function (a) {
        return BadgerAnalytics.campusSummary(int(a.fiscalYear, 2024));
      },
      compact: function (r) {
        return {
          fiscalYear: r.fiscalYear,
          totalTonnes: r.totalTonnes,
          totalSpend: r.totalSpend,
          kgPerDollar: r.kgCo2ePerDollar,
          transactionCount: r.transactionCount,
          priorYear: r.priorYear,
          topCategories: take(r.topCategories, 5, function (c) {
            return { name: c.name, tonnes: c.tonnes, sharePct: c.sharePct };
          }),
          goals: take(r.goals, 4),
          yearEndSpike: r.yearEndSpike
        };
      }
    },
    {
      name: 'analytics_emissionsBy',
      write: false,
      description:
        'Emissions ranked along one rollup dimension, with tonnes, spend, carbon intensity and share of campus total for each row. This is how you find out WHO or WHAT is responsible for emissions.',
      params: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            enum: ['category', 'department', 'building', 'college', 'vendor'],
            description: 'Which axis to roll up by. Defaults to category.'
          },
          fiscalYear: { type: 'integer', description: 'Fiscal year. Defaults to 2024.' }
        },
        required: ['dimension']
      },
      invoke: function (a) {
        return BadgerAnalytics.emissionsBy(str(a.dimension, 'category'), int(a.fiscalYear, 2024));
      },
      compact: function (r) {
        return {
          dimension: r.dimension,
          fiscalYear: r.fiscalYear,
          totalTonnes: r.totalTonnes,
          rows: take(r.rows, 15, function (x) {
            return {
              name: x.name,
              tonnes: x.tonnes,
              spend: x.spend,
              kgPerDollar: x.kgCo2ePerDollar,
              sharePct: x.sharePct
            };
          })
        };
      }
    },
    {
      name: 'analytics_emissionsTrend',
      write: false,
      description:
        'Multi-year emissions and spend history, optionally split into one series per member of a dimension. Use for "is it going up or down" and "how has X changed over time".',
      params: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            enum: ['category', 'department', 'building', 'college'],
            description: 'Optional split. Omit for the campus total only.'
          },
          topN: { type: 'integer', description: 'How many series to break out. Defaults to 5.' }
        },
        required: []
      },
      invoke: function (a) {
        return BadgerAnalytics.emissionsTrend(a.dimension ? str(a.dimension, null) : null, int(a.topN, 5));
      },
      compact: function (r) {
        return {
          campus: take(r.campus || r.points, 12),
          series: take(r.series, 6, function (s) {
            return { name: s.name, points: take(s.points, 12) };
          }),
          cagrPct: r.cagrPct
        };
      }
    },
    {
      name: 'analytics_hotspots',
      write: false,
      description:
        'The department-by-category cells where carbon is most concentrated, each annotated with its share of that department\'s footprint, its carbonVsSpendLeverage (how much more a dollar redirected here is worth than the department average) and any reduction lever that applies. Use for "where should we start" and "what should I do first".',
      params: {
        type: 'object',
        properties: {
          fiscalYear: { type: 'integer', description: 'Fiscal year. Defaults to 2024.' },
          limit: { type: 'integer', description: 'Max cells to return. Defaults to 10.' }
        },
        required: []
      },
      invoke: function (a) {
        return BadgerAnalytics.hotspots(int(a.fiscalYear, 2024), int(a.limit, 10));
      },
      compact: function (r) {
        return {
          fiscalYear: r.fiscalYear,
          hotspots: take(r.hotspots || r.rows, 10, function (h) {
            return {
              department: h.department,
              category: h.category,
              tonnes: h.tonnes,
              spend: h.spend,
              shareOfDeptPct: h.shareOfDepartmentPct,
              shareOfCategoryPct: h.shareOfCategoryPct,
              carbonVsSpendLeverage: h.carbonVsSpendLeverage,
              lever: h.lever ? h.lever.name : null,
              leverOwner: h.lever ? h.lever.owner : null
            };
          })
        };
      }
    },
    {
      name: 'analytics_buildingMap',
      write: false,
      description:
        'Per-building emissions with coordinates, the departments each building houses and its dominant category. Note these are embodied emissions released at suppliers; the building is where the buying decision is made.',
      params: {
        type: 'object',
        properties: { fiscalYear: { type: 'integer', description: 'Fiscal year. Defaults to 2024.' } },
        required: []
      },
      invoke: function (a) {
        return BadgerAnalytics.buildingMap(int(a.fiscalYear, 2024));
      },
      compact: function (r) {
        return {
          fiscalYear: r.fiscalYear,
          buildings: take(r.buildings, 12, function (b) {
            return {
              name: b.name,
              tonnes: b.tonnes,
              spend: b.spend,
              departments: take(b.departments, 4),
              dominantCategory: b.dominantCategory
            };
          })
        };
      }
    },
    {
      name: 'planner_baseline',
      write: false,
      description:
        'The planner starting position: per-category baseline tonnes, each category\'s feasibility ceiling, total available headroom, and every sustainability goal with the tonnes it requires. Call this before reasoning about what is achievable.',
      params: {
        type: 'object',
        properties: { fiscalYear: { type: 'integer', description: 'Baseline fiscal year. Defaults to 2024.' } },
        required: []
      },
      invoke: function (a) {
        return PlannerAgent.baseline(int(a.fiscalYear, 2024));
      },
      compact: function (r) {
        return {
          baselineFiscalYear: r.baselineFiscalYear,
          baselineTonnes: r.baselineTonnes,
          categories: take(r.categories, 20, function (c) {
            return { id: c.id, name: c.name, baselineTonnes: c.baselineTonnes, ceilingPct: c.ceilingPct };
          }),
          goals: take(r.goals, 4, function (g) {
            return {
              targetYear: g.targetYear,
              reductionPct: g.reductionPct,
              needTonnes: g.needTonnes,
              headroomTonnes: g.headroomTonnes,
              feasibleWithoutPins: g.feasibleWithoutPins,
              slackTonnes: g.slackTonnes
            };
          }),
          headroom: r.headroom
        };
      }
    },
    {
      name: 'planner_solve',
      write: false,
      description:
        'THE WHAT-IF SOLVER. Deterministically allocates the reduction needed to hit a target year across all categories, holding any pinned categories at a fixed cut and water-filling the rest without exceeding any ceiling. Returns feasible/infeasible with the exact shortfall. ALWAYS use this for any question of the form "if we can only cut X by N%, what happens" or "can we still hit the target". Never estimate an allocation yourself.',
      params: {
        type: 'object',
        properties: {
          targetYear: { type: 'integer', description: 'Goal year to aim at: 2030, 2040 or 2048.' },
          pins: {
            type: 'object',
            description:
              'Map of category id to the percentage cut to hold it at, as a number from 0 to 100 where 4 means four percent. Use the exact category ids listed in your instructions. Example: {"it_hardware": 4}.',
            additionalProperties: { type: 'number' }
          },
          strategy: {
            type: 'string',
            enum: ['equal_pct', 'cheapest_first', 'effort_balanced'],
            description:
              'How to spread the remaining need. equal_pct spreads evenly, cheapest_first follows the marginal abatement cost curve, effort_balanced favours low-effort levers. Defaults to equal_pct.'
          },
          fiscalYear: { type: 'integer', description: 'Baseline fiscal year. Defaults to 2024.' }
        },
        required: ['targetYear']
      },
      invoke: function (a) {
        var p = normalisePins(a.pins);
        return PlannerAgent.solve({
          targetYear: int(a.targetYear, 2030),
          pins: p.pins,
          strategy: backendStrategy(a.strategy),
          fiscalYear: int(a.fiscalYear, 2024)
        });
      },
      compact: function (r) {
        return {
          targetYear: r.targetYear,
          strategy: r.strategy,
          baselineTonnes: r.baselineTonnes,
          goal: r.goal,
          feasible: r.feasible,
          achievedTonnes: r.achievedTonnes,
          achievedPct: r.achievedPct,
          shortfallTonnes: r.shortfallTonnes,
          resultingTonnes: r.resultingTonnes,
          pinnedCategoryCount: r.pinnedCategoryCount,
          freeCapacityTonnes: r.freeCapacityTonnes,
          cost: r.cost,
          pinNotes: r.pinNotes,
          infeasibility: r.infeasibility,
          narrative: r.narrative,
          categories: take(r.categories, 20, function (c) {
            return {
              id: c.id,
              name: c.name,
              baselineTonnes: c.baselineTonnes,
              pinned: c.pinned,
              cutPct: c.cutPct,
              cutTonnes: c.cutTonnes,
              ceilingPct: c.ceilingPct,
              atCeiling: c.atCeiling,
              costUsd: c.costUsd,
              topAction: (function () {
                var acts = toArray(c.actions);
                return acts.length ? acts[0].name : null;
              })()
            };
          })
        };
      }
    },
    {
      name: 'intercept_queue',
      write: false,
      description:
        'The purchase-intercept work queue: pending purchase requests, each scored with its estimated embodied carbon and its single best intervention (reuse existing campus stock, substitute a lower-carbon line, consolidate with another order, defer, or just proceed).',
      params: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Request status to list, typically "Pending". Use "all" for every request.' },
          limit: { type: 'integer', description: 'Max rows, highest avoidable carbon first. Defaults to 50.' }
        },
        required: []
      },
      invoke: function (a) {
        return InterceptAgent.queue(str(a.status, 'Pending'), int(a.limit, 50));
      },
      compact: function (r) {
        return {
          status: r.status,
          count: r.count,
          rows: take(r.rows || r.requests, 15, function (x) {
            return {
              requestId: x.requestId || x.id,
              description: x.description,
              department: x.department,
              building: x.building,
              category: x.category,
              amount: x.amount,
              estimatedTonnes: x.estimatedTonnes,
              topAction: x.topAction,
              avoidableTonnes: x.avoidableTonnes,
              avoidableUsd: x.avoidableUsd
            };
          })
        };
      }
    },
    {
      name: 'intercept_evaluate',
      write: false,
      description:
        'Full evaluation of one purchase request: its embodied carbon and every applicable rung of the intervention ladder, each with avoided tonnes and dollars, the named counterparty holding the surplus stock or contract, the method used, and a ready-to-send sentence.',
      params: {
        type: 'object',
        properties: { requestId: { type: 'string', description: 'The purchase request id, e.g. "pr_0002".' } },
        required: ['requestId']
      },
      invoke: function (a) {
        return InterceptAgent.evaluate(str(a.requestId, null));
      },
      compact: function (r) {
        return {
          request: r.request,
          estimatedTonnes: r.estimatedTonnes,
          recommendation: r.recommendation,
          options: take(r.options, 6, function (o) {
            return {
              action: o.action,
              label: o.label,
              avoidedTonnes: o.avoidedTonnes,
              avoidedUsd: o.avoidedUsd,
              units: o.units,
              method: o.method,
              basis: o.basis,
              counterparty: o.counterparty,
              proximity: o.proximity,
              distanceMetres: o.distanceMetres,
              message: o.message
            };
          })
        };
      }
    },
    {
      name: 'intercept_interceptStats',
      write: false,
      description:
        'Portfolio view of the intercept: total requests and value, the opportunity mix, avoided tonnes and dollars if every top recommendation were accepted, decisions recorded so far with declined reasons, and the avoided carbon expressed as a share of the fiscal year total and of the gap to the 2030 goal.',
      params: {
        type: 'object',
        properties: { fiscalYear: { type: 'integer', description: 'Fiscal year. Defaults to 2024.' } },
        required: []
      },
      invoke: function (a) {
        return InterceptAgent.interceptStats(int(a.fiscalYear, 2024));
      },
      compact: function (r) {
        return r;
      }
    },

    // ----- Agent 4: the only tools here that return projected rather than measured figures.
    // Kept deliberately separate, and their descriptions shout it, because the application's
    // central claim is that no model computes any *measured* number. See ForecastAgent. -----
    {
      name: 'forecast_allBuildingForecasts',
      write: false,
      description:
        'PROJECTED, NOT MEASURED. Fitted next-twelve-month purchase emissions for every building, from an ordinary-least-squares trend-plus-monthly-seasonality model over FY2019-FY2025 history. Returns each building\'s projected total, its direction (rising/falling/flat), the 95% confidence band, the peak calendar month, and the fit quality as rSquared. Use for "what happens next year", "which buildings are trending up" and "when does the year-end spike land". Every figure from this tool MUST be presented as a projection with its band, never as a measurement.',
      params: {
        type: 'object',
        properties: {
          horizonMonths: {
            type: 'integer',
            description: 'Months to project past the end of the ledger. Defaults to 12, capped at 36.'
          }
        },
        required: []
      },
      invoke: function (a) {
        return ForecastAgent.allBuildingForecasts(int(a.horizonMonths, 12));
      },
      compact: function (r) {
        return {
          projected: true,
          method: r.method,
          disclaimer: r.disclaimer,
          ledgerThroughYear: r.ledgerThroughYear,
          ledgerThroughMonth: r.ledgerThroughMonth,
          buildingCount: r.buildingCount,
          fittableCount: r.fittableCount,
          campusFittedTrailing12MonthsTonnes: r.campusFittedTrailing12MonthsTonnes,
          campusActualTrailing12MonthsTonnes: r.campusActualTrailing12MonthsTonnes,
          campusNext12MonthsTonnes: r.campusNext12MonthsTonnes,
          campusChangePct: r.campusChangePct,
          rows: take(r.rows, 12, function (b) {
            return {
              // buildingId is carried so a follow-up forecast_buildingForecast call has a valid
              // id to use; nothing else in the manifest exposes one.
              buildingId: b.buildingId,
              buildingName: b.buildingName,
              fittable: b.fittable,
              next12MonthsTonnes: b.next12MonthsTonnes,
              confidenceBandTonnes: b.confidenceBandTonnes,
              changePct: b.changePct,
              direction: b.direction,
              peakMonth: b.peakMonth,
              rSquared: b.rSquared,
              modelVsActualPct: b.modelVsActualPct
            };
          })
        };
      }
    },
    {
      name: 'forecast_buildingForecast',
      write: false,
      description:
        'PROJECTED, NOT MEASURED. The same fit for ONE named building, with the month-by-month projection and the fitted seasonal profile. Use when the user asks about one building\'s future or which month it peaks in. Pass a buildingId taken from forecast_allBuildingForecasts. Report the confidence band alongside the point estimate, never the point estimate alone, and report a low rSquared plainly rather than hiding it.',
      params: {
        type: 'object',
        properties: {
          buildingId: {
            type: 'string',
            description: 'Building id, e.g. "chemistry_building". Call forecast_allBuildingForecasts first if you do not have one.'
          },
          horizonMonths: { type: 'integer', description: 'Months to project. Defaults to 12, capped at 36.' }
        },
        required: ['buildingId']
      },
      invoke: function (a) {
        return ForecastAgent.buildingForecast(str(a.buildingId, null), int(a.horizonMonths, 12));
      },
      compact: function (r) {
        return {
          projected: true,
          buildingId: r.buildingId,
          buildingName: r.buildingName,
          method: r.method,
          disclaimer: r.disclaimer,
          fit: r.fit,
          outlook: r.outlook,
          trend: r.trend,
          projection: take(r.projection, 12),
          seasonalProfile: take(r.seasonalProfile, 12)
        };
      }
    },

    // ----- write tools: declared to the model, never executed by ask() -----
    {
      name: 'intercept_decide',
      write: true,
      description:
        'Record a human decision on a purchase request and move it to the matching status. THIS WRITES TO THE DATABASE: it will be held for human confirmation rather than executed, so call it only when the user has clearly asked to commit a decision.',
      params: {
        type: 'object',
        properties: {
          requestId: { type: 'string', description: 'The purchase request id.' },
          action: {
            type: 'string',
            enum: ['reuse', 'substitute', 'consolidate', 'approve', 'decline'],
            description: 'The decision taken.'
          },
          reason: { type: 'string', description: 'Why. This is the data - a refusal tells you which barrier to fix next.' }
        },
        required: ['requestId', 'action', 'reason']
      },
      invoke: function (a) {
        return InterceptAgent.decide(str(a.requestId, null), str(a.action, null), str(a.reason, ''));
      },
      compact: function (r) {
        return r;
      }
    },
    {
      name: 'planner_savePlan',
      write: true,
      description:
        'Persist a solved reduction plan so it can be shared or revisited. THIS WRITES TO THE DATABASE: it will be held for human confirmation rather than executed.',
      params: {
        type: 'object',
        properties: {
          targetYear: { type: 'integer', description: 'Goal year.' },
          pins: { type: 'object', description: 'Map of category id to percent 0-100.', additionalProperties: { type: 'number' } },
          strategy: { type: 'string', enum: ['equal_pct', 'cheapest_first', 'effort_balanced'] },
          name: { type: 'string', description: 'Display name for the plan.' },
          notes: { type: 'string', description: 'Free-text rationale.' }
        },
        required: ['targetYear']
      },
      invoke: function (a) {
        var p = normalisePins(a.pins);
        return PlannerAgent.savePlan({
          targetYear: int(a.targetYear, 2030),
          pins: p.pins,
          strategy: backendStrategy(a.strategy),
          fiscalYear: int(a.fiscalYear, 2024),
          name: str(a.name, null),
          notes: str(a.notes, null),
          createdBy: 'BadgerCopilot'
        });
      },
      compact: function (r) {
        return r;
      }
    }
  ];
}

function toolByName(tools, name) {
  for (var i = 0; i < tools.length; i++) {
    if (tools[i].name === name) return tools[i];
  }
  return null;
}

/**
 * Which deterministic type a tool's prefix says it dispatches to. The manifest table in the UI
 * composes the backing call as `<backs>.<name after the first underscore>()`, which is why every
 * tool here is named for the method it actually invokes - a prefix with no case returns 'unknown'
 * rather than silently attributing the call to the wrong agent.
 */
function backingType(name) {
  var n = '' + name;
  if (n.indexOf('analytics_') === 0) return 'BadgerAnalytics';
  if (n.indexOf('planner_') === 0) return 'PlannerAgent';
  if (n.indexOf('intercept_') === 0) return 'InterceptAgent';
  if (n.indexOf('forecast_') === 0) return 'ForecastAgent';
  return 'unknown';
}

/** The OpenAI-style schema array handed to the model. */
function toolSchemas(tools) {
  var out = [];
  for (var i = 0; i < tools.length; i++) {
    out.push({
      type: 'function',
      function: { name: tools[i].name, description: tools[i].description, parameters: tools[i].params }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the system prompt. The category identifiers are injected from live baseline output
 * because a model asked to guess one will invent "IT_hardware" where the data says "it_hardware",
 * and the resulting pin then matches nothing.
 */
function systemPrompt(page, scenario) {
  var lines = [];
  lines.push(
    'You are the Badger Footprint copilot for UW-Madison. You help staff understand and reduce ' +
      'Scope 3 Category 1 emissions - the carbon embodied in what the university buys.'
  );
  lines.push('');
  lines.push('## The one absolute rule');
  lines.push(
    'You NEVER calculate, estimate, interpolate or guess a number. Every figure in your answer ' +
      'must come from a tool result in this conversation. If you need a number you do not have, ' +
      'call a tool. If no tool can supply it, say plainly that it is not available. Do not do ' +
      'arithmetic on tool results either - if the user wants a difference or a share, there is ' +
      'almost always a tool argument that produces it directly.'
  );
  lines.push('');
  lines.push('## Units');
  lines.push(
    'Emissions are tonnes CO2e. Money is US dollars. Percentages are ALWAYS numbers from 0 to 100, ' +
      'never fractions: four percent is 4, not 0.04.'
  );
  lines.push('');
  lines.push('## Measured versus projected');
  lines.push(
    'The analytics_, planner_ and intercept_ tools return MEASURED arithmetic over purchase orders ' +
      'that actually exist. The two forecast_ tools are different in kind: they return a fitted ' +
      'statistical projection for months that have no transactions yet. When you quote a forecast_ ' +
      'figure you MUST say it is a projection and give its confidence band - "about 410 tCO2e, give ' +
      'or take 48" - never a bare point estimate. Never add a projected figure to a measured total, ' +
      'and if the fit is weak (low rSquared) say so rather than quietly implying precision.'
  );
  lines.push('');

  // live category ids
  var cats = [];
  var goalYears = [];
  try {
    var base = PlannerAgent.baseline(2024);
    var arr = toArray(base.categories);
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      cats.push('- ' + c.id + ' ("' + c.name + '") baseline ' + c.baselineTonnes + ' tCO2e, ceiling ' + c.ceilingPct + '%');
    }
    var gs = toArray(base.goals);
    for (var j = 0; j < gs.length; j++) goalYears.push(gs[j].targetYear);
    lines.push('## Baseline (FY' + base.baselineFiscalYear + ', total ' + base.baselineTonnes + ' tCO2e)');
  } catch (e) {
    lines.push('## Categories');
  }
  if (cats.length) {
    lines.push('Valid category ids - use these EXACT strings, never a variation:');
    lines.push(cats.join('\n'));
    lines.push('');
  }
  if (goalYears.length) {
    lines.push('Valid target years: ' + goalYears.join(', ') + '.');
    lines.push('');
  }

  lines.push('## How to work');
  lines.push(
    '1. Identify what the user is really asking. 2. Call the tools that compute it - several if ' +
      'the answer needs chaining, for example find the worst building with analytics_emissionsBy, ' +
      'then look for reusable stock there with intercept_queue. 3. Answer in at most roughly 120 ' +
      'words of plain prose, leading with the direct answer and quoting the specific figures.'
  );
  lines.push(
    'For any "what if we can only cut X by N%" question, call planner_solve with a pin on X. ' +
      'Report feasibility honestly - if the plan cannot reach the goal, say so and give the ' +
      'shortfall in tonnes. An infeasible answer is a real finding, not a failure.'
  );
  lines.push('Be direct. No preamble, no "great question", no bullet lists unless comparing items.');

  // page + live screen state
  var pageNote = {
    overview: 'The user is on the campus Overview page (totals, trends, rankings).',
    planner: 'The user is on the Reduction Planner page, which has a slider per category, a target-year selector and a gap meter. Prefer planner_solve and planner_baseline.',
    intercept: 'The user is on the Purchase Intercept page (the pending-request queue). Prefer intercept_queue and intercept_evaluate.',
    map: 'The user is on the Campus Map page. Prefer analytics_buildingMap for measured figures per building, and forecast_allBuildingForecasts when the question is about where things are heading.',
    methodology: 'The user is on the Methodology page and is likely asking how a number is derived.'
  };
  var p = str(page, null);
  if (p && pageNote[p]) {
    lines.push('');
    lines.push('## Context');
    lines.push(pageNote[p]);
  }
  if (scenario) {
    var sc;
    try {
      sc = JSON.stringify(scenario);
    } catch (e) {
      sc = null;
    }
    if (sc && sc !== '{}' && sc !== 'null') {
      lines.push(
        'The controls on screen are currently set to: ' +
          sc +
          '. Resolve words like "also", "instead" and "that" against this state.'
      );
    }
  }
  if (p === 'planner') {
    lines.push('');
    lines.push(
      'When you call planner_solve, the sliders on screen will automatically move to match the ' +
        'pins you passed. So pin exactly what the user asked for and nothing else.'
    );
  }
  return lines.join('\n');
}

function buildMessages(message, page, scenario, history) {
  var msgs = [{ role: 'system', content: systemPrompt(page, scenario) }];
  var hist = toArray(history);
  var start = Math.max(0, hist.length - MAX_HISTORY);
  for (var i = start; i < hist.length; i++) {
    var h = hist[i];
    var role = str(h.role, null);
    var content = str(h.content, null);
    if ((role === 'user' || role === 'assistant') && content) {
      msgs.push({ role: role, content: content });
    }
  }
  msgs.push({ role: 'user', content: str(message, '') });
  return msgs;
}

// ---------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------

function ask(spec) {
  var envelope = {
    reply: '',
    toolCalls: [],
    uiAction: null,
    pendingAction: null,
    grounded: false,
    model: MODEL_KEY,
    error: null
  };

  // One json argument rather than four positional ones, so the shape matches what the frontend's
  // c3Action helper already sends successfully for fetch/evaluate. A bare string is accepted too,
  // which keeps one-liner calls from a code runner terse.
  var req = spec && typeof spec === 'object' ? spec : { message: str(spec, '') };
  var message = str(req.message, null);
  var page = str(req.page, null);
  var scenario = req.scenario || null;
  var history = req.history || null;

  if (!str(message, null)) {
    envelope.error = 'Ask me something about campus purchasing emissions.';
    envelope.reply = envelope.error;
    return envelope;
  }

  var tools, schemas, client, msgs;
  try {
    tools = buildTools();
    schemas = toolSchemas(tools);
    client = GenaiCore.Llm.Completion.Client.forConfigKey(MODEL_KEY);
    msgs = buildMessages(message, page, scenario, history);
  } catch (e) {
    envelope.error = 'Copilot unavailable: ' + e;
    envelope.reply = 'I could not reach the language model, so I have not answered. The dashboards on this page are unaffected.';
    return envelope;
  }

  var lastSolveArgs = null;

  for (var iter = 0; iter < MAX_ITERS; iter++) {
    var resp;
    try {
      // POSITIONAL args, returnJson true, no temperature. See header note.
      resp = client.completion(msgs, { returnJson: true, max_tokens: MAX_TOKENS, tools: schemas });
    } catch (e) {
      envelope.error = 'Model call failed: ' + e;
      envelope.reply =
        envelope.toolCalls.length > 0
          ? 'I computed the figures but could not finish writing them up. The tool results are listed below.'
          : 'I could not reach the language model. The dashboards on this page are unaffected.';
      return envelope;
    }

    var choice = toArray(resp.choices)[0];
    if (!choice) {
      envelope.error = 'Empty model response.';
      envelope.reply = 'I did not get a usable answer back. Please try rephrasing.';
      return envelope;
    }
    var msg = choice.message;
    var calls = toArray(msg.tool_calls);

    // No tool calls: this is the final narration.
    if (calls.length === 0) {
      envelope.reply = str(msg.content, '').replace(/^\s+|\s+$/g, '');
      if (!envelope.reply) envelope.reply = 'I was not able to put together an answer for that.';
      break;
    }

    // Replay the assistant turn verbatim so the model sees its own call.
    msgs.push({ role: 'assistant', content: str(msg.content, ''), tool_calls: calls });

    for (var ci = 0; ci < calls.length; ci++) {
      var call = calls[ci];
      var fname = call.function ? str(call.function.name, '') : '';
      var tool = toolByName(tools, fname);
      var args = {};
      try {
        var rawArgs = call.function ? call.function.arguments : null;
        if (rawArgs) args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      } catch (e) {
        args = {};
      }

      if (!tool) {
        msgs.push({
          role: 'tool',
          tool_call_id: call.id,
          name: fname,
          content: JSON.stringify({ error: 'No such tool: ' + fname })
        });
        continue;
      }

      // Write tools are never executed here. Hand the intent back for approval.
      if (tool.write) {
        envelope.pendingAction = { name: fname, args: args, description: tool.description };
        msgs.push({
          role: 'tool',
          tool_call_id: call.id,
          name: fname,
          content: JSON.stringify({
            status: 'awaiting_human_confirmation',
            note:
              'This write was NOT executed. It is queued for the user to approve. Tell the user ' +
              'exactly what you are proposing and that it needs their confirmation.'
          })
        });
        continue;
      }

      var started = Date.now();
      var result, errText = null;
      try {
        result = tool.invoke(args);
      } catch (e) {
        errText = '' + e;
      }
      var elapsed = Date.now() - started;

      if (errText !== null) {
        envelope.toolCalls.push({ name: fname, args: args, ms: elapsed, summary: 'failed', error: errText });
        msgs.push({
          role: 'tool',
          tool_call_id: call.id,
          name: fname,
          content: JSON.stringify({ error: errText })
        });
        continue;
      }

      var compacted;
      try {
        compacted = tool.compact(result);
      } catch (e) {
        compacted = result;
      }

      envelope.grounded = true;
      envelope.toolCalls.push({
        name: fname,
        args: args,
        ms: elapsed,
        summary: summarise(fname, args, compacted)
      });

      if (fname === 'planner_solve') lastSolveArgs = args;

      msgs.push({
        role: 'tool',
        tool_call_id: call.id,
        name: fname,
        content: JSON.stringify(compacted)
      });
    }

    // Exhausted the loop without a narration: ask for one in plain prose.
    if (iter === MAX_ITERS - 1) {
      try {
        var finalResp = client.completion(
          msgs.concat([
            {
              role: 'user',
              content: 'Now answer my original question in plain prose using only the figures above. Do not call any more tools.'
            }
          ]),
          { returnJson: true, max_tokens: MAX_TOKENS }
        );
        envelope.reply = str(toArray(finalResp.choices)[0].message.content, '').replace(/^\s+|\s+$/g, '');
      } catch (e) {
        envelope.reply = 'I gathered the figures below but ran out of steps before summarising them.';
      }
    }
  }

  // Derive the UI action from the arguments the solver was ACTUALLY called with, so the sliders
  // and the narration cannot disagree. The model never restates these.
  if (lastSolveArgs && str(page, null) === 'planner') {
    var p = normalisePins(lastSolveArgs.pins);
    var pinCount = 0;
    for (var k in p.pins) {
      if (Object.prototype.hasOwnProperty.call(p.pins, k)) pinCount++;
    }
    if (pinCount > 0) {
      envelope.uiAction = {
        type: 'planner.applyPins',
        // percentages 0-100, matching the backend contract; the React layer divides by 100
        pins: p.pins,
        targetYear: int(lastSolveArgs.targetYear, 2030),
        strategy: uiStrategy(backendStrategy(lastSolveArgs.strategy)),
        suspectFractions: p.suspect
      };
    }
  }

  return envelope;
}

/** A one-line, human-readable gloss of what a call returned, for the provenance strip. */
function summarise(name, args, r) {
  try {
    if (name === 'planner_solve') {
      return r.feasible
        ? 'feasible - cuts ' + r.achievedTonnes + ' tCO2e of the ' + r.goal.needTonnes + ' needed for ' + r.targetYear
        : 'INFEASIBLE - short by ' + r.shortfallTonnes + ' tCO2e for ' + r.targetYear;
    }
    if (name === 'planner_baseline') return 'baseline ' + r.baselineTonnes + ' tCO2e across ' + toArray(r.categories).length + ' categories';
    if (name === 'analytics_campusSummary') return 'FY' + r.fiscalYear + ': ' + r.totalTonnes + ' tCO2e on $' + r.totalSpend;
    if (name === 'analytics_emissionsBy') return toArray(r.rows).length + ' rows by ' + r.dimension + ', total ' + r.totalTonnes + ' tCO2e';
    if (name === 'analytics_hotspots') return toArray(r.hotspots).length + ' hotspot cells';
    if (name === 'analytics_buildingMap') return toArray(r.buildings).length + ' buildings';
    if (name === 'analytics_emissionsTrend') return toArray(r.campus).length + ' years of history';
    if (name === 'intercept_queue') return (r.count || toArray(r.rows).length) + ' requests in queue';
    if (name === 'intercept_evaluate') return 'evaluated ' + str(args.requestId, 'request');
    if (name === 'intercept_interceptStats') return 'intercept portfolio stats';
    if (name === 'forecast_allBuildingForecasts')
      return 'PROJECTED ' + r.campusNext12MonthsTonnes + ' tCO2e next 12mo (' + r.fittableCount + ' of ' + r.buildingCount + ' buildings fitted)';
    if (name === 'forecast_buildingForecast') {
      return r.fit && r.fit.fittable
        ? 'PROJECTED ' + r.outlook.next12MonthsTonnes + ' +/- ' + r.outlook.confidenceBandTonnes + ' tCO2e for ' + str(r.buildingName, str(args.buildingId, 'building')) + ' (R2 ' + r.fit.rSquared + ')'
        : 'no fit possible for ' + str(args.buildingId, 'building');
    }
  } catch (e) {
    /* fall through */
  }
  return 'ok';
}

// ---------------------------------------------------------------------------
// confirmAction
// ---------------------------------------------------------------------------

function confirmAction(action) {
  var out = { ok: false, result: null, summary: null, error: null };
  if (!action) {
    out.error = 'No action supplied.';
    return out;
  }

  var name = str(action.name, null);
  var args = action.args || {};
  var tools = buildTools();
  var tool = toolByName(tools, name);

  if (!tool) {
    out.error = 'Unknown action: ' + name;
    return out;
  }
  if (!tool.write) {
    out.error = name + ' is a read-only tool and does not need confirmation.';
    return out;
  }

  // Re-validate rather than trust: a malformed suggestion must not become a write.
  var required = toArray(tool.params.required);
  for (var i = 0; i < required.length; i++) {
    var key = '' + required[i];
    if (args[key] === null || args[key] === undefined || args[key] === '') {
      out.error = 'Missing required argument "' + key + '" for ' + name + '.';
      return out;
    }
  }
  if (name === 'intercept_decide') {
    var allowed = { reuse: 1, substitute: 1, consolidate: 1, approve: 1, decline: 1 };
    if (!allowed[str(args.action, '')]) {
      out.error = 'Invalid decision "' + str(args.action, '') + '". Expected one of reuse, substitute, consolidate, approve, decline.';
      return out;
    }
  }

  try {
    out.result = tool.invoke(args);
    out.ok = true;
    out.summary =
      name === 'intercept_decide'
        ? 'Recorded "' + str(args.action, '') + '" on ' + str(args.requestId, '') + '.'
        : 'Saved the plan for ' + str(args.targetYear, '') + '.';
  } catch (e) {
    out.error = '' + e;
  }
  return out;
}

// ---------------------------------------------------------------------------
// toolManifest
// ---------------------------------------------------------------------------

function toolManifest() {
  var tools = buildTools();
  var rows = [];
  for (var i = 0; i < tools.length; i++) {
    var t = tools[i];
    var params = [];
    var props = t.params.properties || {};
    var req = toArray(t.params.required);
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      var isReq = false;
      for (var j = 0; j < req.length; j++) {
        if ('' + req[j] === k) isReq = true;
      }
      params.push({
        name: k,
        type: str(props[k].type, 'string'),
        required: isReq,
        enumValues: props[k]['enum'] ? toArray(props[k]['enum']) : null,
        description: str(props[k].description, null)
      });
    }
    rows.push({
      name: t.name,
      backs: backingType(t.name),
      write: !!t.write,
      confirmGated: !!t.write,
      description: t.description,
      params: params
    });
  }
  return {
    model: MODEL_KEY,
    maxToolRounds: MAX_ITERS,
    readOnlyCount: (function () {
      var n = 0;
      for (var i = 0; i < rows.length; i++) if (!rows[i].write) n++;
      return n;
    })(),
    writeCount: (function () {
      var n = 0;
      for (var i = 0; i < rows.length; i++) if (rows[i].write) n++;
      return n;
    })(),
    groundingRule:
      'The model selects and sequences calls; it never computes a figure. Every number in an answer originates from one of these deterministic methods.',
    tools: rows
  };
}
