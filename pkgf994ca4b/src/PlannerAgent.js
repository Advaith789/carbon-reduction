/*
 * Agent 3 implementation — the deterministic what-if reduction planner.
 * See PlannerAgent.c3typ for the method contracts and the units policy.
 *
 * All arithmetic is plain floating point over two inputs:
 *   catT[c]  = baseline tonnes CO2e for category c (from SpendTransaction x EPA factor)
 *   ceil[c]  = sum of maxReductionPct across c's levers available on the plan's horizon
 * A plan is feasible iff the goal's tonnage need can be met without any category exceeding
 * its ceiling. Nothing here is probabilistic, and no LLM is consulted.
 */

var BASELINE_FY = 2024;
var EPS = 1e-9;
var DEFAULT_STRATEGY = 'equal_pct';
var STRATEGIES = { equal_pct: 1, cheapest_first: 1, effort_balanced: 1 };

/* Effort weights for the effort_balanced strategy: Low-effort categories absorb more of the
 * remaining need, so the resulting plan is easier to actually get agreement on. */
var EFFORT_WEIGHT = { Low: 1.0, Medium: 0.6, High: 0.3 };
var MIN_WEIGHT = 0.05;

function _toArr(coll) {
  var out = [];
  if (!coll) return out;
  var n = coll.length;
  for (var i = 0; i < n; i++) out.push(coll.get ? coll.get(i) : coll[i]);
  return out;
}

function _round1(x) { return Math.round(x * 10) / 10; }
function _round0(x) { return Math.round(x); }
function _pct1(x) { return Math.round(x * 1000) / 10; }   // fraction -> 0-100, 1dp

/** Count an object's own keys without relying on Object.keys (absent in some Rhino builds). */
function _countKeys(obj) {
  var n = 0;
  for (var k in obj) n++;
  return n;
}

/** Normalise a json/map/string argument into a plain JS object. */
function _plain(x) {
  if (x === null || x === undefined) return {};
  if (typeof x === 'string') {
    try { return JSON.parse(x); } catch (e) { return {}; }
  }
  if (typeof x.toJson === 'function') {
    try { x = x.toJson(); } catch (e2) { /* fall through */ }
  }
  return x;
}

/** Baseline tonnes per category for a fiscal year, plus category display metadata. */
function _baseline(fy) {
  var txns = _toArr(SpendTransaction.fetch({
    filter: Filter.eq('fiscalYear', fy),
    include: 'amount, productCategory.id, productCategory.name, ' +
             'productCategory.emissionFactor.kgCo2ePerDollar',
    limit: -1
  }).objs);

  var catT = {}, catUsd = {}, meta = {}, total = 0, totalUsd = 0;
  for (var i = 0; i < txns.length; i++) {
    var t = txns[i];
    if (!t.productCategory) continue;
    var c = t.productCategory.id;
    var ef = t.productCategory.emissionFactor ? t.productCategory.emissionFactor.kgCo2ePerDollar : 0;
    var tonnes = t.amount * ef / 1000.0;
    catT[c] = (catT[c] || 0) + tonnes;
    catUsd[c] = (catUsd[c] || 0) + t.amount;
    meta[c] = { id: c, name: t.productCategory.name, kgPerDollar: ef };
    total += tonnes;
    totalUsd += t.amount;
  }
  return { catT: catT, catUsd: catUsd, meta: meta, total: total, totalUsd: totalUsd };
}

/**
 * Levers grouped by category, filtered to a horizon and sorted cheapest-first, with each
 * category's summed ceiling and its capacity-weighted average effort weight.
 */
function _levers(targetYear) {
  var rows = _toArr(ReductionLever.fetch({
    include: 'id, name, maxReductionPct, costPerTonne, effortLevel, owner, horizonYear, ' +
             'description, productCategory.id',
    limit: -1
  }).objs);

  var byCat = {}, ceil = {}, weight = {}, wAcc = {};
  for (var i = 0; i < rows.length; i++) {
    var L = rows[i];
    if (!L.productCategory) continue;
    var hz = L.horizonYear || 2030;
    if (hz > targetYear) continue;             // not available on this horizon
    var c = L.productCategory.id;
    if (!byCat[c]) { byCat[c] = []; }
    byCat[c].push({
      id: L.id, name: L.name, maxFrac: L.maxReductionPct,
      costPerTonne: L.costPerTonne || 0, effortLevel: L.effortLevel || 'Medium',
      owner: L.owner || null, horizonYear: hz, description: L.description || null
    });
    ceil[c] = (ceil[c] || 0) + L.maxReductionPct;
    var w = EFFORT_WEIGHT[L.effortLevel] !== undefined ? EFFORT_WEIGHT[L.effortLevel] : 0.6;
    wAcc[c] = (wAcc[c] || 0) + w * L.maxReductionPct;
  }
  for (var c2 in byCat) {
    byCat[c2].sort(function (a, b) { return a.costPerTonne - b.costPerTonne; });
    weight[c2] = ceil[c2] > 0 ? Math.max(MIN_WEIGHT, wAcc[c2] / ceil[c2]) : MIN_WEIGHT;
  }
  return { byCat: byCat, ceil: ceil, weight: weight };
}

/**
 * Break a category's total cut fraction into the specific levers that compose it, taking
 * cheapest levers first. This is what lets a slider at 12% answer "which 12%?".
 */
function _decompose(cutFrac, levers, catTonnes) {
  var remaining = cutFrac, actions = [], cost = 0;
  for (var i = 0; i < levers.length && remaining > EPS; i++) {
    var L = levers[i];
    var take = Math.min(remaining, L.maxFrac);
    if (take <= EPS) continue;
    var tonnes = catTonnes * take;
    var c = tonnes * L.costPerTonne;
    actions.push({
      leverId: L.id, name: L.name, owner: L.owner, effortLevel: L.effortLevel,
      horizonYear: L.horizonYear,
      cutPct: _pct1(take), cutTonnes: _round1(tonnes),
      ceilingPct: _pct1(L.maxFrac), fullyUsed: take >= L.maxFrac - EPS,
      costPerTonne: L.costPerTonne, costUsd: _round0(c),
      description: L.description
    });
    cost += c;
    remaining -= take;
  }
  return { actions: actions, cost: cost };
}

/**
 * Weighted water-filling: find the largest uniform pressure `p` such that allocating
 * `min(p * weight_c, ceil_c)` to every free category meets `need` tonnes. Categories whose
 * ceiling binds first are saturated and removed, then the pressure is recomputed on the rest.
 */
function _waterFill(free, need) {
  var alloc = {}, active = [], R = need;
  for (var i = 0; i < free.length; i++) { alloc[free[i].id] = 0; active.push(free[i]); }

  var guard = 0;
  while (R > EPS && active.length > 0 && guard++ < 500) {
    var sumTW = 0;
    for (var a = 0; a < active.length; a++) sumTW += active[a].tonnes * active[a].weight;
    if (sumTW <= EPS) break;

    var p = R / sumTW;
    var minIdx = -1, minRatio = -1;
    for (var b = 0; b < active.length; b++) {
      var ratio = active[b].ceil / active[b].weight;
      if (minIdx < 0 || ratio < minRatio) { minRatio = ratio; minIdx = b; }
    }
    if (p <= minRatio + EPS) {
      for (var d = 0; d < active.length; d++) alloc[active[d].id] = p * active[d].weight;
      R = 0;
      break;
    }
    var sat = active[minIdx];
    alloc[sat.id] = sat.ceil;
    R -= sat.tonnes * sat.ceil;
    active.splice(minIdx, 1);
  }
  return { alloc: alloc, residual: Math.max(0, R) };
}

/**
 * A true marginal abatement cost curve: take individual levers across all free categories in
 * ascending cost order until the need is met, so money-saving actions are exhausted first.
 */
function _cheapestFirst(free, byCat, need) {
  var items = [], alloc = {};
  for (var i = 0; i < free.length; i++) {
    alloc[free[i].id] = 0;
    var lv = byCat[free[i].id] || [];
    for (var j = 0; j < lv.length; j++) {
      items.push({ cat: free[i].id, catTonnes: free[i].tonnes, maxFrac: lv[j].maxFrac, cost: lv[j].costPerTonne });
    }
  }
  items.sort(function (a, b) { return a.cost - b.cost; });

  var R = need;
  for (var k = 0; k < items.length && R > EPS; k++) {
    var it = items[k];
    if (it.catTonnes <= EPS) continue;
    var availT = it.catTonnes * it.maxFrac;
    var takeT = Math.min(R, availT);
    alloc[it.cat] += takeT / it.catTonnes;
    R -= takeT;
  }
  return { alloc: alloc, residual: Math.max(0, R) };
}

function baseline(fiscalYear) {
  var fy = fiscalYear || BASELINE_FY;
  var b = _baseline(fy);
  var near = _levers(2030);
  var far = _levers(2040);

  var rows = [];
  for (var c in b.catT) {
    var lv2030 = near.byCat[c] || [], lv2040 = far.byCat[c] || [];
    var actions = [];
    for (var i = 0; i < lv2040.length; i++) {
      actions.push({
        leverId: lv2040[i].id, name: lv2040[i].name, owner: lv2040[i].owner,
        effortLevel: lv2040[i].effortLevel, horizonYear: lv2040[i].horizonYear,
        maxReductionPct: _pct1(lv2040[i].maxFrac), costPerTonne: lv2040[i].costPerTonne,
        description: lv2040[i].description
      });
    }
    rows.push({
      id: c,
      name: b.meta[c] ? b.meta[c].name : c,
      baselineTonnes: _round1(b.catT[c]),
      baselineSpend: _round0(b.catUsd[c] || 0),
      sharePct: b.total > 0 ? _pct1(b.catT[c] / b.total) : 0,
      kgPerDollar: b.meta[c] ? b.meta[c].kgPerDollar : 0,
      ceilingPct2030: _pct1(near.ceil[c] || 0),
      ceilingPct2040: _pct1(far.ceil[c] || 0),
      maxTonnes2030: _round1(b.catT[c] * (near.ceil[c] || 0)),
      maxTonnes2040: _round1(b.catT[c] * (far.ceil[c] || 0)),
      nearTermLeverCount: lv2030.length,
      leverCount: lv2040.length,
      levers: actions
    });
  }
  rows.sort(function (a, b2) { return b2.baselineTonnes - a.baselineTonnes; });

  // Campus-wide headroom on each horizon, and what each goal requires.
  var head2030 = 0, head2040 = 0;
  for (var c3 in b.catT) {
    head2030 += b.catT[c3] * (near.ceil[c3] || 0);
    head2040 += b.catT[c3] * (far.ceil[c3] || 0);
  }
  var goals = [];
  var gRows = _toArr(SustainabilityGoal.fetch({
    include: 'id, name, targetYear, reductionPct, description', limit: -1
  }).objs);
  gRows.sort(function (a, b2) { return a.targetYear - b2.targetYear; });
  for (var g = 0; g < gRows.length; g++) {
    var need = b.total * gRows[g].reductionPct;
    var head = gRows[g].targetYear >= 2040 ? head2040 : head2030;
    goals.push({
      id: gRows[g].id, name: gRows[g].name, targetYear: gRows[g].targetYear,
      reductionPct: _pct1(gRows[g].reductionPct),
      needTonnes: _round1(need),
      headroomTonnes: _round1(head),
      headroomPct: b.total > 0 ? _pct1(head / b.total) : 0,
      feasibleWithoutPins: head >= need - EPS,
      slackTonnes: _round1(head - need),
      description: gRows[g].description
    });
  }

  return {
    baselineFiscalYear: fy,
    baselineTonnes: _round1(b.total),
    baselineSpend: _round0(b.totalUsd),
    categories: rows,
    goals: goals,
    headroom: {
      nearTermTonnes: _round1(head2030),
      nearTermPct: b.total > 0 ? _pct1(head2030 / b.total) : 0,
      withStructuralTonnes: _round1(head2040),
      withStructuralPct: b.total > 0 ? _pct1(head2040 / b.total) : 0,
      structuralContributionTonnes: _round1(head2040 - head2030),
      note: 'Near-term levers are procurement actions available immediately. Structural ' +
            'levers need capital and supplier lead time, so they only count toward 2040.'
    },
    strategies: [
      { id: 'equal_pct', name: 'Equal percentage',
        description: 'Every unpinned category takes a similar percentage cut, water-filled so none exceeds its ceiling.' },
      { id: 'cheapest_first', name: 'Cheapest first (MACC)',
        description: 'Levers are taken in ascending cost per tonne, so money-saving actions are exhausted before costly ones.' },
      { id: 'effort_balanced', name: 'Effort balanced',
        description: 'Allocation is weighted toward low-effort levers, trading some cost efficiency for achievability.' }
    ]
  };
}

function solve(spec) {
  var s = _plain(spec);
  var fy = s.fiscalYear || BASELINE_FY;
  var targetYear = s.targetYear;
  if (!targetYear) throw 'PlannerAgent.solve requires spec.targetYear (e.g. 2030).';
  var strategy = s.strategy || DEFAULT_STRATEGY;
  if (!STRATEGIES[strategy]) {
    throw 'Unknown strategy "' + strategy + '". Expected equal_pct, cheapest_first or effort_balanced.';
  }

  var b = _baseline(fy);
  var lv = _levers(targetYear);
  if (b.total <= EPS) throw 'No baseline emissions found for fiscal year ' + fy + '.';

  // Resolve the goal for this target year.
  var gRows = _toArr(SustainabilityGoal.fetch({
    filter: Filter.eq('targetYear', targetYear),
    include: 'id, name, targetYear, reductionPct, scope, description', limit: 1
  }).objs);
  if (gRows.length === 0) throw 'No SustainabilityGoal defined for target year ' + targetYear + '.';
  var goal = gRows[0];

  // Declared here rather than with the pin loop below because the target-override
  // check also needs somewhere to record a rejected value.
  var pinNotes = [];

  // The published goal sets the default depth of cut, but a caller may ask a
  // different question — "what if we aimed for 37%?" — and the planner UI has a
  // target slider that does exactly that. `spec.targetPct` (0-100) overrides the
  // goal's own reductionPct so that an arbitrary ambition can be tested without
  // inventing a SustainabilityGoal record for it. The goal block in the response
  // still reports which published target was displaced, so a reader can always
  // see that the figure being solved against is not the official one.
  var targetFrac = goal.reductionPct;
  var targetOverridden = false;
  if (s.targetPct !== null && s.targetPct !== undefined && s.targetPct !== '') {
    var tp = Number(s.targetPct);
    if (isNaN(tp)) {
      pinNotes.push('Ignored non-numeric targetPct "' + s.targetPct + '".');
    } else {
      if (tp < 0) tp = 0;
      if (tp > 100) tp = 100;
      targetFrac = tp / 100.0;
      targetOverridden = true;
    }
  }
  var needTonnes = b.total * targetFrac;

  // --- pins -------------------------------------------------------------------------------
  var pinsIn = _plain(s.pins);
  var pinFrac = {};
  for (var pk in pinsIn) {
    if (b.catT[pk] === undefined) {
      pinNotes.push('Ignored pin on unknown category "' + pk + '".');
      continue;
    }
    var raw = Number(pinsIn[pk]);
    if (isNaN(raw)) { pinNotes.push('Ignored non-numeric pin on "' + pk + '".'); continue; }
    var frac = raw / 100.0;
    var cap = lv.ceil[pk] || 0;
    if (frac < 0) { frac = 0; pinNotes.push('Pin on "' + pk + '" raised to 0%.'); }
    if (frac > cap + EPS) {
      pinNotes.push('Pin on "' + pk + '" of ' + raw + '% exceeds its ' + _pct1(cap) +
                    '% ceiling on the ' + targetYear + ' horizon and was clamped.');
      frac = cap;
    }
    pinFrac[pk] = frac;
  }

  // --- split pinned vs free ---------------------------------------------------------------
  var pinnedTonnes = 0, free = [], freeCapacity = 0;
  for (var c in b.catT) {
    if (pinFrac[c] !== undefined) {
      pinnedTonnes += b.catT[c] * pinFrac[c];
      continue;
    }
    var cap2 = lv.ceil[c] || 0;
    if (cap2 <= EPS || b.catT[c] <= EPS) continue;     // nothing to give
    free.push({ id: c, tonnes: b.catT[c], ceil: cap2, weight: lv.weight[c] || MIN_WEIGHT });
    freeCapacity += b.catT[c] * cap2;
  }

  var remaining = needTonnes - pinnedTonnes;
  var alloc = {}, residual = 0;

  if (remaining <= EPS) {
    // Pins alone already meet or exceed the goal; free categories are asked for nothing.
    for (var f0 = 0; f0 < free.length; f0++) alloc[free[f0].id] = 0;
    remaining = 0;
  } else if (remaining > freeCapacity + EPS) {
    // Infeasible: push every free category to its ceiling and report the gap honestly.
    for (var f1 = 0; f1 < free.length; f1++) alloc[free[f1].id] = free[f1].ceil;
    residual = remaining - freeCapacity;
  } else if (strategy === 'cheapest_first') {
    var r1 = _cheapestFirst(free, lv.byCat, remaining);
    alloc = r1.alloc; residual = r1.residual;
  } else {
    // equal_pct uses uniform weights; effort_balanced uses the per-category effort weights.
    var fw = [];
    for (var f2 = 0; f2 < free.length; f2++) {
      fw.push({
        id: free[f2].id, tonnes: free[f2].tonnes, ceil: free[f2].ceil,
        weight: (strategy === 'effort_balanced') ? free[f2].weight : 1.0
      });
    }
    var r2 = _waterFill(fw, remaining);
    alloc = r2.alloc; residual = r2.residual;
  }

  // --- assemble per-category result -------------------------------------------------------
  var categories = [], achieved = 0, totalCost = 0, savings = 0, spend = 0;
  for (var c2 in b.catT) {
    var isPinned = pinFrac[c2] !== undefined;
    var cut = isPinned ? pinFrac[c2] : (alloc[c2] || 0);
    var catTonnes = b.catT[c2];
    var cutTonnes = catTonnes * cut;
    var dec = _decompose(cut, lv.byCat[c2] || [], catTonnes);

    achieved += cutTonnes;
    totalCost += dec.cost;
    if (dec.cost < 0) savings += -dec.cost; else spend += dec.cost;

    categories.push({
      id: c2,
      name: b.meta[c2] ? b.meta[c2].name : c2,
      baselineTonnes: _round1(catTonnes),
      pinned: isPinned,
      cutPct: _pct1(cut),
      cutTonnes: _round1(cutTonnes),
      residualTonnes: _round1(catTonnes - cutTonnes),
      ceilingPct: _pct1(lv.ceil[c2] || 0),
      headroomRemainingPct: _pct1(Math.max(0, (lv.ceil[c2] || 0) - cut)),
      atCeiling: (lv.ceil[c2] || 0) > EPS && cut >= (lv.ceil[c2] || 0) - EPS,
      costUsd: _round0(dec.cost),
      costPerTonne: cutTonnes > EPS ? _round0(dec.cost / cutTonnes) : 0,
      actions: dec.actions
    });
  }
  categories.sort(function (a, b2) { return b2.cutTonnes - a.cutTonnes; });

  var feasible = residual <= 1e-6;

  // --- infeasibility guidance -------------------------------------------------------------
  var infeasibility = null;
  if (!feasible) {
    var suggestions = [];
    var pinList = [];
    for (var pc in pinFrac) {
      pinList.push({
        id: pc, name: b.meta[pc] ? b.meta[pc].name : pc,
        pinPct: _pct1(pinFrac[pc]), ceilingPct: _pct1(lv.ceil[pc] || 0),
        releaseTonnes: b.catT[pc] * Math.max(0, (lv.ceil[pc] || 0) - pinFrac[pc])
      });
    }
    pinList.sort(function (a, b2) { return b2.releaseTonnes - a.releaseTonnes; });
    for (var pl = 0; pl < pinList.length && pl < 3; pl++) {
      if (pinList[pl].releaseTonnes <= EPS) continue;
      suggestions.push('Release the pin on ' + pinList[pl].name + ' (held at ' +
        pinList[pl].pinPct + '%, ceiling ' + pinList[pl].ceilingPct + '%) to recover up to ' +
        _round1(pinList[pl].releaseTonnes) + ' tCO2e.');
    }
    if (targetYear < 2040) {
      var farL = _levers(2040), extra = 0;
      for (var c4 in b.catT) extra += b.catT[c4] * ((farL.ceil[c4] || 0) - (lv.ceil[c4] || 0));
      if (extra > EPS) {
        suggestions.push('Structural levers excluded from a ' + targetYear + ' plan ' +
          '(helium recapture, supplier decarbonisation, chemistry redesign) would add about ' +
          _round1(extra) + ' tCO2e, but need capital and supplier lead time.');
      }
    }
    suggestions.push('Raise a feasibility ceiling: the plan is already at the ceiling in ' +
      'every unpinned category, so the only remaining moves are policy changes that lift a ' +
      'ceiling or a revised target.');
    infeasibility = {
      shortfallTonnes: _round1(residual),
      shortfallPctOfBaseline: _pct1(residual / b.total),
      maxAchievableTonnes: _round1(pinnedTonnes + freeCapacity),
      maxAchievablePct: _pct1((pinnedTonnes + freeCapacity) / b.total),
      message: 'This combination of pins cannot reach the ' + targetYear + ' target. The plan ' +
               'falls ' + _round1(residual) + ' tCO2e short even with every unpinned category ' +
               'cut to its maximum feasible level.',
      suggestions: suggestions
    };
  }

  var aimLabel = targetOverridden
    ? ('a ' + _pct1(targetFrac) + '% cut by ' + targetYear)
    : ('the ' + targetYear + ' target');
  var narrative = feasible
    ? ('Hitting ' + aimLabel + ' means cutting ' + _round1(needTonnes) +
       ' tCO2e from a ' + _round1(b.total) + ' tCO2e baseline. With the pins you set, the ' +
       'remaining ' + _round1(Math.max(0, needTonnes - pinnedTonnes)) + ' tCO2e is spread across ' +
       free.length + ' categories using the ' + strategy + ' strategy, at a net ' +
       (totalCost < 0 ? 'saving of $' + _round0(-totalCost) : 'cost of $' + _round0(totalCost)) + '.')
    : ('Reaching ' + aimLabel + ' is out of reach under these pins: ' + _round1(residual) +
       ' tCO2e short of the ' + _round1(needTonnes) + ' tCO2e required, even with every ' +
       'unpinned category at its ceiling.');

  return {
    targetYear: targetYear,
    strategy: strategy,
    baselineFiscalYear: fy,
    baselineTonnes: _round1(b.total),
    goal: {
      id: goal.id, name: goal.name,
      // The depth actually solved against, which is the published figure unless a
      // caller overrode it. `publishedReductionPct` keeps the official number
      // visible either way, so an overridden run can never be mistaken for the
      // university's real commitment.
      reductionPct: _pct1(targetFrac),
      publishedReductionPct: _pct1(goal.reductionPct),
      targetOverridden: targetOverridden,
      targetTonnes: _round1(b.total * (1 - targetFrac)),
      needTonnes: _round1(needTonnes),
      scope: goal.scope
    },
    feasible: feasible,
    achievedTonnes: _round1(achieved),
    achievedPct: _pct1(achieved / b.total),
    shortfallTonnes: _round1(residual),
    resultingTonnes: _round1(b.total - achieved),
    pinnedTonnes: _round1(pinnedTonnes),
    pinnedCategoryCount: _countKeys(pinFrac),
    freeCategoryCount: free.length,
    freeCapacityTonnes: _round1(freeCapacity),
    cost: {
      netUsd: _round0(totalCost),
      savingsUsd: _round0(savings),
      spendUsd: _round0(spend),
      avgCostPerTonne: achieved > EPS ? _round0(totalCost / achieved) : 0
    },
    categories: categories,
    pinNotes: pinNotes,
    infeasibility: infeasibility,
    narrative: narrative
  };
}

function savePlan(spec) {
  var s = _plain(spec);
  // Re-solve from the spec so a stored plan can never disagree with the solver.
  var solved = solve(s);

  var pinsIn = _plain(s.pins);
  var pinDesc = [];
  for (var pk in pinsIn) pinDesc.push(pk + '@' + pinsIn[pk] + '%');
  var autoName = solved.targetYear + ' plan (' + solved.strategy + ')' +
    (pinDesc.length > 0 ? ' with ' + pinDesc.join(', ') : ' unconstrained');

  var plan = ReductionPlan.make({
    id: s.id || ('plan_' + solved.targetYear + '_' + solved.strategy + '_' +
                 Math.floor(Math.random() * 1000000000)),
    name: s.name || autoName,
    targetYear: solved.targetYear,
    strategy: solved.strategy,
    baselineFiscalYear: solved.baselineFiscalYear,
    baselineTonnes: solved.baselineTonnes,
    needTonnes: solved.goal.needTonnes,
    achievedTonnes: solved.achievedTonnes,
    feasible: solved.feasible,
    shortfallTonnes: solved.shortfallTonnes,
    totalCostUsd: solved.cost.netUsd,
    pins: pinsIn,
    allocation: { categories: solved.categories, narrative: solved.narrative,
                  infeasibility: solved.infeasibility },
    createdBy: s.createdBy || null,
    notes: s.notes || null
  }).upsert();

  // Surface the headline verdict alongside the id so a caller can render a confirmation without
  // reaching into the nested solve result.
  return {
    planId: plan.id,
    name: plan.name,
    saved: true,
    targetYear: solved.targetYear,
    strategy: solved.strategy,
    feasible: solved.feasible,
    achievedTonnes: solved.achievedTonnes,
    needTonnes: solved.goal.needTonnes,
    shortfallTonnes: solved.shortfallTonnes,
    totalCostUsd: solved.cost.netUsd,
    plan: solved
  };
}
